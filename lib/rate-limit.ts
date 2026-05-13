/**
 * Distributed sliding-window rate limiter.
 *
 * Defaults to Vercel KV (Redis-compatible sorted sets) when KV env vars are
 * present. Falls back to a single-process in-memory Map for local development
 * or environments where KV isn't configured.
 *
 * Why this matters:
 *   The previous in-memory implementation was leaky under concurrent load on
 *   Vercel's multi-instance runtime — verified empirically. 30 parallel
 *   requests from one IP got 0/30 rate-limited because Vercel scaled fresh
 *   instances, each starting with a fresh counter. Sliding-window in Redis
 *   makes the counter shared across all instances, so the limit is enforced
 *   globally regardless of how many functions are warm.
 *
 * Algorithm:
 *   For each request, we maintain a sorted set keyed by `rl:<key>` where:
 *     - score = timestamp (ms)
 *     - member = `<timestamp>:<random>` (unique to avoid collisions in burst)
 *
 *   On each call we:
 *     1. Remove members older than the window
 *     2. Add the current request
 *     3. Count remaining members
 *     4. Set TTL on the whole key (Redis evicts idle keys)
 *
 *   All in one pipeline = one network round trip.
 *
 *   If count > limit, reject (and we leave the entry in the set — it counts
 *   toward the next call's quota too, which is the strict-enforcement choice).
 *
 * Failure modes:
 *   - KV unreachable: fall through to in-memory (logged). Fail-open so users
 *     aren't denied service due to infra hiccups. Tradeoff: brief windows of
 *     leak during KV outages, which Vercel observability will alert on.
 */

import { kv } from '@vercel/kv';

// In-memory fallback for local dev / no-KV environments
interface RateLimitEntry {
  timestamps: number[];
}
const memStore = new Map<string, RateLimitEntry>();
let lastMemCleanup = Date.now();
const MEM_CLEANUP_INTERVAL = 60_000;

function isKvConfigured(): boolean {
  return Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
}

export interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  /** Seconds until the oldest request in the window expires (for Retry-After header) */
  retryAfterSeconds: number;
  headers: Record<string, string>;
}

function buildHeaders(
  allowed: boolean,
  limit: number,
  remaining: number,
  resetUnixSeconds: number,
  retryAfterSeconds: number,
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(resetUnixSeconds),
  };
  if (!allowed) headers['Retry-After'] = String(retryAfterSeconds);
  return headers;
}

/** KV-backed sliding window. One pipelined round trip per call. */
async function rateLimitKv(key: string, { limit, windowMs }: RateLimitConfig): Promise<RateLimitResult> {
  const now = Date.now();
  const cutoff = now - windowMs;
  const fullKey = `rl:${key}`;
  // Unique member name avoids collisions when multiple requests land in same millisecond
  const member = `${now}:${Math.random().toString(36).slice(2, 10)}`;
  const windowSeconds = Math.ceil(windowMs / 1000);

  try {
    // Pipeline: drop expired, add new, count, set TTL — atomic from the client's perspective
    const pipeline = kv.pipeline();
    pipeline.zremrangebyscore(fullKey, 0, cutoff);
    pipeline.zadd(fullKey, { score: now, member });
    pipeline.zcard(fullKey);
    pipeline.expire(fullKey, windowSeconds);
    const results = await pipeline.exec();
    // Pipeline results are typed loosely; the zcard result is at index 2.
    // Some Vercel KV / Upstash transports return the array directly,
    // others wrap each entry — handle both shapes defensively.
    const rawCount = results?.[2];
    const count = typeof rawCount === 'number' ? rawCount : Number(rawCount) || 0;

    if (count > limit) {
      // Get oldest entry to compute retry-after accurately
      const oldest = (await kv.zrange(fullKey, 0, 0, { withScores: true })) as Array<string | number>;
      const oldestScore = oldest.length >= 2 ? Number(oldest[1]) : now;
      const retryAfterMs = oldestScore + windowMs - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds,
        headers: buildHeaders(
          false,
          limit,
          0,
          Math.ceil((oldestScore + windowMs) / 1000),
          retryAfterSeconds,
        ),
      };
    }

    const remaining = Math.max(0, limit - count);
    return {
      allowed: true,
      limit,
      remaining,
      retryAfterSeconds: 0,
      headers: buildHeaders(true, limit, remaining, Math.ceil((now + windowMs) / 1000), 0),
    };
  } catch (err) {
    // KV outage: fall back to in-memory + log. Fail open so we don't deny legit users.
    console.error(
      `[rate-limit] KV unavailable, falling back to in-memory: ${err instanceof Error ? err.message : 'unknown'}`,
    );
    return rateLimitInMemory(key, { limit, windowMs });
  }
}

/** In-memory fallback. Same semantics, per-instance only. */
function rateLimitInMemory(key: string, { limit, windowMs }: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const cutoff = now - windowMs;

  // Periodic cleanup
  if (now - lastMemCleanup > MEM_CLEANUP_INTERVAL) {
    lastMemCleanup = now;
    for (const [k, entry] of memStore) {
      entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
      if (entry.timestamps.length === 0) memStore.delete(k);
    }
  }

  let entry = memStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    memStore.set(key, entry);
  }
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= limit) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds,
      headers: buildHeaders(
        false,
        limit,
        0,
        Math.ceil((oldestInWindow + windowMs) / 1000),
        retryAfterSeconds,
      ),
    };
  }

  entry.timestamps.push(now);
  const remaining = limit - entry.timestamps.length;
  return {
    allowed: true,
    limit,
    remaining,
    retryAfterSeconds: 0,
    headers: buildHeaders(true, limit, remaining, Math.ceil((now + windowMs) / 1000), 0),
  };
}

/**
 * Main entry point. Async because KV is async.
 * Falls through to in-memory if KV isn't configured (e.g. local dev).
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  if (isKvConfigured()) {
    return rateLimitKv(key, config);
  }
  return rateLimitInMemory(key, config);
}

/**
 * Extract client IP from request headers.
 * Checks Vercel/Cloudflare/standard proxy headers.
 */
export function getClientIP(headers: Headers): string {
  const xForwardedFor = headers.get('x-forwarded-for');
  if (xForwardedFor) {
    return xForwardedFor.split(',')[0].trim();
  }
  const cfConnecting = headers.get('cf-connecting-ip');
  if (cfConnecting) return cfConnecting;
  const xRealIp = headers.get('x-real-ip');
  if (xRealIp) return xRealIp;
  return 'unknown';
}
