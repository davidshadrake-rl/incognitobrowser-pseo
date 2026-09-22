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
import { readCappedRequestText } from '@/lib/request-body';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';
import { isValidTestId, summarizeObservations, type ResolverSummary } from '@/lib/dns-leak';
import { readDnsLeakTest } from '@/lib/dns-leak-store';

// The browser polls up to 4 times per test; 20 starts/min × 4 = 80.
const RESULT_RATE_LIMIT_CONFIG = { limit: 100, windowMs: 60_000 };

const NO_STORE = { 'Cache-Control': 'no-store, private', Vary: 'Origin' };

// The whole body is { "id": "<12 chars>" }. 512 bytes is already far more
// than that needs; the number exists to stop a flood being buffered, not to
// discriminate between plausible bodies.
const MAX_BODY = 512;

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

  // Bound the body BEFORE buffering it. This route read the whole request into
  // memory to pull out a 12-character id, with no size check anywhere.
  //
  // The fix that followed — pre-check Content-Length, then read, then measure —
  // did not hold either, and the comment that used to sit here said the
  // post-read check "is the one that binds". It binds what is ACCEPTED, not
  // what is ALLOCATED, and a chunked request sends no Content-Length at all, so
  // the pre-check was skipped rather than triggered and the unbounded read ran.
  // Measured 2026-09-21: 300MB resident on a 448MB heap, one request, no
  // proof-of-work on this route. lib/request-body.ts has the detail.
  const capped = await readCappedRequestText(request, MAX_BODY);
  if (!capped.ok) {
    return NextResponse.json({ error: 'Body too large.' }, { status: 413, headers });
  }
  let id: unknown;
  try {
    const body = JSON.parse(capped.text) as { id?: unknown } | null;
    id = body?.id;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400, headers });
  }
  if (!isValidTestId(id)) {
    return NextResponse.json({ error: 'Invalid test id.' }, { status: 400, headers });
  }

  const { record, observations, storage } = await readDnsLeakTest(id);

  /**
   * The stored public IP goes back only to the network that started the test.
   *
   * This route used to return record.publicIp to anyone who presented the id,
   * which made it a cross-visitor read of an IP address on a privacy product.
   * Proven in-process, not argued: a request from 203.0.113.77 carrying an id
   * issued to 198.51.100.24 came back with publicIp "198.51.100.24".
   *
   * The id is not a secret that can carry this. It is 62 bits, so it cannot be
   * guessed — but the whole mechanism works by having the visitor's RESOLVER
   * look up <id>.dnsleak…, so every resolver in that chain sees it, which is
   * precisely the set of parties the tool exists to tell you about.
   *
   * Compared by /24 (or /64) bucket rather than exact address, the same way the
   * rate limiter groups callers: a visitor whose address rotates inside their
   * provider mid-test still sees their result, while an unrelated network gets
   * null. The resolver observations stay visible to anyone with the id — they
   * are about the resolvers, not about the visitor — and readDnsLeakTest still
   * reports whether the record existed, which the UI needs to tell "no queries
   * yet" apart from "expired".
   */
  const sameNetwork = record?.publicIp ? getIpBucket(record.publicIp) === bucket : false;

  const body: DnsLeakResultResponse = {
    id,
    publicIp: sameNetwork ? record!.publicIp : null,
    resolvers: summarizeObservations(observations),
    observations: observations.length,
    storage,
  };
  // Never log the body — resolver IPs + the visitor's public IP.
  return NextResponse.json(body, { headers });
}
