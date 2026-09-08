/**
 * POST /dns-leak/result — read back what our nameserver saw for a test id.
 *
 * Body: { id }. Returns ONLY:
 *   { id, publicIp, resolvers: [{ ip, firstSeen, count, network }], observations, storage }
 * Query names are never echoed; the resolver list is aggregated per IP.
 *
 * `dnsleak:seen:<id>` is a Redis list of JSON { resolverIp, ts, qname }
 * appended by scripts/dnsleak-server.mjs. `dnsleak:test:<id>` holds the
 * public IP captured when the test started. Both expire after 600 s.
 *
 * Same conventions as /ip: POST only, origin gate, bucketed rate limit
 * (polling calls this up to 4x per test), CORS, Cache-Control: no-store.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIP, getIpBucket } from '@/lib/rate-limit';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';
import { isValidTestId, summarizeObservations, type ResolverSummary } from '@/lib/dns-leak';
import { readDnsLeakTest } from '@/lib/dns-leak-store';

// The browser polls up to 4 times per test; 20 starts/min × 4 = 80.
const RESULT_RATE_LIMIT_CONFIG = { limit: 100, windowMs: 60_000 };

const NO_STORE = { 'Cache-Control': 'no-store, private', Vary: 'Origin' };

export interface DnsLeakResultResponse {
  id: string;
  publicIp: string | null;
  resolvers: ResolverSummary[];
  observations: number;
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
  const rl = await rateLimit(`dnsleak-result:${bucket}`, RESULT_RATE_LIMIT_CONFIG);
  const headers = { ...cors, ...rl.headers };
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers });
  }

  let id: unknown;
  try {
    const body = (await request.json()) as { id?: unknown } | null;
    id = body?.id;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers });
  }
  if (!isValidTestId(id)) {
    return NextResponse.json({ error: 'Invalid test id.' }, { status: 400, headers });
  }

  const { record, observations, storage } = await readDnsLeakTest(id);

  const body: DnsLeakResultResponse = {
    id,
    publicIp: record?.publicIp ?? null,
    resolvers: summarizeObservations(observations),
    observations: observations.length,
    storage,
  };
  // Never log the body — resolver IPs + the visitor's public IP.
  return NextResponse.json(body, { headers });
}
