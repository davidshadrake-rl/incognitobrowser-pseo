/**
 * POST /event — first-party, cookieless counters.
 *
 * Accepts an allowlisted event (lib/event-schema), increments day-bucketed
 * Redis counters and drops the request. No IP, cookie or user id is stored;
 * the client IP is used only for the per-network rate limit, exactly like
 * every other route. Without REDIS_URL the event is acknowledged and
 * discarded (stored:false) so pages never wait on analytics.
 */
import { NextRequest, NextResponse } from 'next/server';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';
import { rateLimit, getClientIP, getIpBucket, getRedisClient } from '@/lib/rate-limit';
import { validateEvent, eventKeys, dayOf, EVENT_TTL_SECONDS } from '@/lib/event-schema';

const MAX_BODY = 2048;
const RATE = { limit: 120, windowMs: 60_000 };

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: { ...corsHeadersFor(origin, request.headers.get('host')), 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const headers: Record<string, string> = { ...corsHeadersFor(origin, host), 'Cache-Control': 'no-store, private' };

  if (!isOriginAllowed(origin, host)) {
    return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403, headers });
  }
  const rl = await rateLimit(`evt:${getIpBucket(getClientIP(request.headers))}`, RATE);
  Object.assign(headers, rl.headers);
  if (!rl.allowed) return NextResponse.json({ error: 'Too many events.' }, { status: 429, headers });

  // Check the declared length BEFORE buffering. Reading first and measuring
  // afterwards meant the whole body was already in memory by the time it was
  // judged too large, so the 2 KB cap bounded what was accepted but not what
  // was allocated — a flood of 10 MB bodies would each have been held in full
  // and only then refused. Content-Length can lie, so the post-read check
  // stays as the one that actually binds.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return NextResponse.json({ error: 'Body too large.' }, { status: 413, headers });
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'Body too large.' }, { status: 413, headers });
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400, headers }); }
  const v = validateEvent(parsed);
  if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400, headers });

  const redis = getRedisClient();
  if (!redis) return NextResponse.json({ ok: true, stored: false }, { status: 202, headers });
  try {
    const keys = eventKeys(dayOf(new Date()), v.value);
    const pipe = redis.pipeline();
    for (const k of keys) { pipe.incr(k); pipe.expire(k, EVENT_TTL_SECONDS); }
    await pipe.exec();
    return NextResponse.json({ ok: true, stored: true }, { status: 202, headers });
  } catch {
    return NextResponse.json({ ok: true, stored: false }, { status: 202, headers });
  }
}
