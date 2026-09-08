/**
 * POST /stats { day?: 'YYYY-MM-DD' } — the day's counters, for the owner.
 *
 * POST, not GET: Next 16 with `output: 'export'` rejects GET route handlers
 * that are not force-static, and these counts are inherently dynamic. POST
 * handlers are silently excluded from the static export, which is what we
 * want — the droplet/WordPress build has no server, the Vercel build serves
 * it. Same reasoning as /challenge.
 *
 * Protected by STATS_TOKEN (Authorization: Bearer …). Unset token → 404, so
 * the route does not exist for anyone until it is configured. Returns
 * aggregate counts only; there is nothing else to return.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/rate-limit';
import { dayOf } from '@/lib/event-schema';

export async function POST(request: NextRequest) {
  const token = process.env.STATS_TOKEN;
  const headers = { 'Cache-Control': 'no-store, private' };
  if (!token) return new NextResponse(null, { status: 404, headers });
  const auth = request.headers.get('authorization') || '';
  if (auth !== `Bearer ${token}`) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });

  let body: unknown = {};
  try { body = await request.json(); } catch { /* empty body is fine */ }
  const day = (body as { day?: string })?.day || dayOf(new Date());
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return NextResponse.json({ error: 'day must be YYYY-MM-DD' }, { status: 400, headers });
  const redis = getRedisClient();
  if (!redis) return NextResponse.json({ day, counts: {}, storage: 'none' }, { headers });

  const counts: Record<string, number> = {};
  let cursor = '0';
  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', `evt:${day}:*`, 'COUNT', 500);
    cursor = next;
    if (keys.length) {
      const vals = await redis.mget(...keys);
      keys.forEach((k, i) => { counts[k.slice(`evt:${day}:`.length)] = Number(vals[i] || 0); });
    }
  } while (cursor !== '0');
  const sorted = Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
  return NextResponse.json({ day, counts: sorted, storage: 'redis' }, { headers });
}
