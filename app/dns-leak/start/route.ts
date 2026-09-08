/**
 * POST /dns-leak/start — begin a DNS leak test.
 *
 * Creates a random 12-char test id, records { createdAt, publicIp } under
 * `dnsleak:test:<id>` (EXPIRE 600) and returns the unique hostnames the
 * browser must resolve. Our authoritative nameserver for the zone
 * (scripts/dnsleak-server.mjs) records whichever resolver asks for them;
 * /dns-leak/result reads those observations back.
 *
 * publicIp is derived exactly as /ip derives it (buildIpResponse) — first
 * x-forwarded-for hop, loopback placeholder when no proxy headers exist.
 *
 * Same conventions as /ip and /challenge: POST only (static export skips
 * it), origin gate, /24-bucketed rate limit, CORS headers, and
 * Cache-Control: no-store — the body is tied to one visitor.
 *
 * If Redis is not configured the id is still returned so the browser can run
 * the probes; the result route then reports storage:'none' and the UI shows
 * an honest "backend not configured" state instead of a verdict.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIP, getIpBucket } from '@/lib/rate-limit';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';
import { buildIpResponse } from '@/app/ip/route';
import { DNSLEAK_ZONE, HOSTNAMES_PER_TEST, TEST_TTL_SECONDS, buildHostnames, generateTestId } from '@/lib/dns-leak';
import { createDnsLeakTest } from '@/lib/dns-leak-store';

// Each start writes one small key and triggers ~6 DNS lookups from the
// visitor's own resolver — no amplification, but no reason to allow scripting.
const START_RATE_LIMIT_CONFIG = { limit: 20, windowMs: 60_000 };

const NO_STORE = { 'Cache-Control': 'no-store, private', Vary: 'Origin' };

export interface DnsLeakStartResponse {
  id: string;
  zone: string;
  hostnames: string[];
  ttlSeconds: number;
  storage: 'redis' | 'none';
}

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeadersFor(origin, request.headers.get('host')),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const cors = { ...corsHeadersFor(origin, host), ...NO_STORE };

  if (!isOriginAllowed(origin, host)) {
    return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403, headers: cors });
  }

  const bucket = getIpBucket(getClientIP(request.headers));
  const rl = await rateLimit(`dnsleak:${bucket}`, START_RATE_LIMIT_CONFIG);
  const headers = { ...cors, ...rl.headers };
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers });
  }

  const ipInfo = buildIpResponse(request.headers);
  const publicIp = ipInfo.local ? null : ipInfo.ip;

  let id: string;
  try {
    id = generateTestId();
  } catch (err) {
    console.error(`[dns-leak] id generation failed: ${err instanceof Error ? err.message : 'unknown'}`);
    return NextResponse.json({ error: 'Test service is unavailable. Try again later.' }, { status: 503, headers });
  }

  const storage = await createDnsLeakTest(id, publicIp);

  const body: DnsLeakStartResponse = {
    id,
    zone: DNSLEAK_ZONE,
    hostnames: buildHostnames(id, DNSLEAK_ZONE, HOSTNAMES_PER_TEST),
    ttlSeconds: TEST_TTL_SECONDS,
    storage,
  };
  // Never log the body — it is keyed to the visitor's IP.
  return NextResponse.json(body, { headers });
}
