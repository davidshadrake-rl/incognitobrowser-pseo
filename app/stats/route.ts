/**
 * POST /stats { day?: 'YYYY-MM-DD' } — the day's counters, for the owner.
 *
 * POST, not GET: Next 16 with `output: 'export'` rejects GET route handlers
 * that are not force-static, and these counts are inherently dynamic. POST
 * handlers are silently excluded from the static export, which is what we
 * want — the droplet/WordPress build has no server, the server build serves
 * it. Same reasoning as /challenge.
 *
 * Protected by STATS_TOKEN (Authorization: Bearer …). Unset token → 404, so
 * the route does not exist for anyone until it is configured. Returns
 * aggregate counts only; there is nothing else to return.
 */
import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getRedisClient, rateLimit, getClientIP, getIpBucket, getRedisDiagnostic } from '@/lib/rate-limit';
import { dayOf } from '@/lib/event-schema';

export async function POST(request: NextRequest) {
  const token = process.env.STATS_TOKEN;
  const headers = { 'Cache-Control': 'no-store, private' };
  if (!token) return new NextResponse(null, { status: 404, headers });
  // Throttle first: a bearer check with no limit is a free brute-force target.
  const rl = await rateLimit(`stats:${getIpBucket(getClientIP(request.headers))}`, { limit: 10, windowMs: 60_000 });
  if (!rl.allowed) return NextResponse.json({ error: 'Too many requests' }, { status: 429, headers: { ...headers, ...rl.headers } });
  // Constant-time compare on equal-length buffers; `!==` short-circuits on the first differing byte.
  const auth = request.headers.get('authorization') || '';
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(auth);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });

  // Bound the body BEFORE buffering it, the same way /event does. The only
  // field here is an optional 'YYYY-MM-DD', but the read was unbounded, so a
  // 10 MB body was held in full and only then ignored. The Apache cap does not
  // cover it — that matches on the Content-Length header, and a chunked
  // request carries no length to match. Content-Length can lie as well, hence
  // the post-read check; 512 bytes is enormous for one date string.
  const MAX_BODY = 512;
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) {
    return NextResponse.json({ error: 'Body too large.' }, { status: 413, headers });
  }
  const text = await request.text();
  if (text.length > MAX_BODY) return NextResponse.json({ error: 'Body too large.' }, { status: 413, headers });
  let body: unknown = {};
  // An absent or unparseable body still means "today", as it always has —
  // callers post this route with no body at all.
  try { body = JSON.parse(text); } catch { /* empty body is fine */ }
  const day = (body as { day?: string })?.day || dayOf(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400, headers });
  /**
   * Whether the controls are actually ON right now, not whether the code that
   * implements them exists.
   *
   * getRedisDiagnostic() was exported and called from nowhere — dead code with
   * a docstring inviting someone to wire it up. That mattered more than it
   * looked: the proof-of-work single-use check is skipped when the Redis
   * client is null, and getRedisClient() returns null for ten seconds after
   * ANY Redis error. So the control can be off while every page still serves
   * and every test still passes, and nothing anywhere said so. This is the
   * read-out that would have shown it — status 'backoff' means the replay
   * check is currently refusing scans; 'disabled' means it is not enforcing.
   *
   * Behind STATS_TOKEN with the rest of this route: lastError can carry a
   * connection string, and in-flight counts are a load signal.
   */
  const runtime = { ...getRedisDiagnostic(), uptimeSec: Math.round(process.uptime()) };

  const redis = getRedisClient();
  if (!redis) return NextResponse.json({ day, counts: {}, storage: 'none', runtime }, { headers });

  // Hard ceiling on how much one call may collect. The loop SCANs a whole
  // day's keyspace and holds every key and count in memory to answer, so its
  // cost is set by however many keys exist — which is not a number this route
  // controls. eventKeys() bounds normal days to roughly 21,000, so 20,000 here
  // is a stop for an abnormal one, not a limit anyone meets. The response says
  // when it truncated rather than quietly returning a short answer.
  const MAX_KEYS = 20_000;
  const counts: Record<string, number> = {};
  let cursor = '0';
  let collected = 0;
  let truncated = false;
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `evt:${day}:*`, 'COUNT', 500);
    cursor = next;
    if (keys.length) {
      const room = MAX_KEYS - collected;
      const take = keys.length > room ? keys.slice(0, room) : keys;
      if (take.length) {
        const vals = await redis.mget(...take);
        take.forEach((k, i) => { counts[k.slice(`evt:${day}:`.length)] = Number(vals[i] || 0); });
        collected += take.length;
      }
      if (keys.length > room) { truncated = true; break; }
    }
  } while (cursor !== '0');
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  return NextResponse.json({ day, counts: sorted, storage: 'redis', runtime, ...(truncated ? { truncated: true, limit: MAX_KEYS } : {}) }, { headers });
}
