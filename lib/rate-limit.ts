/**
 * Distributed sliding-window rate limiter.
 *
 * Defaults to Redis (via `REDIS_URL` env var) when configured. Falls back to a
 * single-process in-memory Map for local development or environments where
 * Redis isn't available.
 *
 * Why this matters:
 *   The previous in-memory implementation was leaky under concurrent load on
 *   Vercel's multi-instance runtime — verified empirically. 30 parallel
 *   requests from one IP got 0/30 rate-limited because Vercel scaled fresh
 *   instances, each starting with a fresh counter. Distributed Redis makes
 *   the counter shared across all instances, so the limit is enforced
 *   globally regardless of how many functions are warm.
 *
 * Why ioredis (vs @vercel/kv):
 *   The new "Vercel Redis" marketplace product exposes only `REDIS_URL`
 *   (RESP protocol), not the REST API that `@vercel/kv` requires. `ioredis`
 *   speaks the Redis protocol directly. Bonus: this is provider-agnostic —
 *   any standard Redis (Upstash, Render, AWS ElastiCache, self-hosted) works
 *   without code changes.
 *
 * Algorithm:
 *   For each request, maintain a sorted set keyed by `rl:<key>` where:
 *     - score = timestamp (ms)
 *     - member = `<timestamp>:<random>` (unique to avoid burst collisions)
 *
 *   On each call we MULTI/EXEC:
 *     1. Remove members older than the window (ZREMRANGEBYSCORE)
 *     2. Add the current request (ZADD)
 *     3. Count remaining members (ZCARD)
 *     4. Set TTL on the whole key (EXPIRE) — Redis evicts idle keys
 *
 *   One MULTI transaction = atomic + single network round trip.
 *
 * Serverless connection management:
 *   ioredis maintains a TCP connection. In serverless, each function instance
 *   reuses its own client across warm invocations. `lazyConnect: true` defers
 *   the connection until first command, avoiding cold-start overhead when an
 *   instance never hits Redis. `maxRetriesPerRequest: 2` caps the time we'll
 *   wait on an unhealthy Redis before failing open to in-memory mode.
 *
 * Failure modes:
 *   - Redis unreachable / slow: fail open to in-memory + log. Tradeoff: brief
 *     leak windows during Redis outages; Vercel observability will alert on
 *     the elevated error rate. Better than denying service to legit users.
 */

import Redis from 'ioredis';

// In-memory fallback for local dev / no-Redis environments
interface RateLimitEntry {
  timestamps: number[];
}
const memStore = new Map<string, RateLimitEntry>();
let lastMemCleanup = Date.now();
const MEM_CLEANUP_INTERVAL = 60_000;

// Singleton client per function instance. Lazy: only connects on first use.
let _client: Redis | null = null;
let _clientFailedAt: number | null = null;
let _lastClientError: string | null = null;
const CLIENT_RETRY_DELAY_MS = 10_000; // After a failure, wait 10s before retrying Redis

/** Diagnostic info surfaced via response headers. Remove once Redis is verified. */
export function getRedisDiagnostic(): {
  redisUrlSet: boolean;
  lastError: string | null;
  hasClient: boolean;
} {
  return {
    redisUrlSet: Boolean(process.env.REDIS_URL),
    lastError: _lastClientError,
    hasClient: _client !== null,
  };
}

function getClient(): Redis | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  // Backoff: don't hammer Redis if it just failed
  if (_clientFailedAt && Date.now() - _clientFailedAt < CLIENT_RETRY_DELAY_MS) {
    return null;
  }

  if (_client) return _client;
  try {
    _client = new Redis(url, {
      // lazyConnect=true means the connection is deferred until first command.
      // enableOfflineQueue=true (default) means commands fired before the TCP
      // handshake completes get queued and flushed once the connection is
      // ready. This is the right combo for serverless: no overhead on cold
      // starts that never use Redis, but commands work transparently on
      // first use without us needing to await an explicit connect().
      lazyConnect: true,
      enableOfflineQueue: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 3000,
      // Critical for serverless: don't keep reconnecting forever
      retryStrategy: (times) => (times > 2 ? null : Math.min(times * 200, 1000)),
    });
    _client.on('error', (err: Error) => {
      // Mark failed; let the next request decide whether to retry or fall back
      _clientFailedAt = Date.now();
      _lastClientError = err.message.slice(0, 200);
    });
    return _client;
  } catch (err) {
    _clientFailedAt = Date.now();
    _lastClientError = err instanceof Error ? err.message.slice(0, 200) : 'unknown';
    return null;
  }
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
  /** Which backend served this request — `redis` or `memory`. Surfaced as a
   *  response header so curl can show it without log archaeology. */
  backend: 'redis' | 'memory';
}

function buildHeaders(
  allowed: boolean,
  limit: number,
  remaining: number,
  resetUnixSeconds: number,
  retryAfterSeconds: number,
  backend: 'redis' | 'memory',
): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(limit),
    'X-RateLimit-Remaining': String(Math.max(0, remaining)),
    'X-RateLimit-Reset': String(resetUnixSeconds),
    // Debug header: tells curl which backend served this request. Remove once
    // the Redis path is verified working in prod.
    'X-RateLimit-Backend': backend,
  };
  if (!allowed) headers['Retry-After'] = String(retryAfterSeconds);
  return headers;
}

/**
 * Redis-backed fixed-window rate limiter using atomic INCR.
 *
 * Why fixed window (instead of sliding-window sorted set):
 *   Sorted-set zadd+zcard in a MULTI is theoretically atomic but I observed
 *   under concurrent load that 30 parallel requests reported only ~5 distinct
 *   counts (1–5), not 1–30 as expected. Whether it's pipeline race, member
 *   string collision under V8 cold-start timing, or something else, INCR
 *   sidesteps the entire question — it's a single command, atomic by
 *   definition.
 *
 * Tradeoff: fixed window allows up to 2x burst at window boundaries (limit
 * requests in the last 100ms of window N + limit requests in the first 100ms
 * of window N+1 = 2×limit in ~200ms). For our use case, acceptable. The PoW
 * provides the per-request cost defense regardless.
 *
 * Window IDs:
 *   windowId = floor(now / windowMs)
 *   Key = `rl:<userKey>:<windowId>`
 *   Each window has its own key with TTL = windowMs, so old windows expire on
 *   their own.
 */
async function rateLimitRedis(
  client: Redis,
  key: string,
  { limit, windowMs }: RateLimitConfig,
): Promise<RateLimitResult> {
  const now = Date.now();
  const windowSeconds = Math.ceil(windowMs / 1000);
  const windowId = Math.floor(now / windowMs);
  const fullKey = `rl:${key}:${windowId}`;
  // When this window ends, in unix seconds
  const windowEndUnix = Math.ceil(((windowId + 1) * windowMs) / 1000);

  try {
    // INCR is atomic — no race possible.
    // EXPIRE sets TTL so the key auto-evicts after the window.
    // Pipeline them in one round trip (separate transactions OK since
    // EXPIRE is idempotent — calling it on every request is fine).
    const pipe = client.pipeline();
    pipe.incr(fullKey);
    pipe.expire(fullKey, windowSeconds);
    const results = await pipe.exec();
    if (!results) throw new Error('pipeline exec returned null');
    const incrEntry = results[0];
    if (incrEntry[0]) throw incrEntry[0];
    const count = Number(incrEntry[1] ?? 0);

    if (count > limit) {
      const retryAfterMs = windowEndUnix * 1000 - now;
      const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds,
        backend: 'redis',
        headers: buildHeaders(false, limit, 0, windowEndUnix, retryAfterSeconds, 'redis'),
      };
    }

    const remaining = Math.max(0, limit - count);
    return {
      allowed: true,
      limit,
      remaining,
      retryAfterSeconds: 0,
      backend: 'redis',
      headers: buildHeaders(true, limit, remaining, windowEndUnix, 0, 'redis'),
    };
  } catch (err) {
    // Redis outage: fall back to in-memory + log. Fail open so we don't deny legit users.
    const msg = err instanceof Error ? err.message : 'unknown';
    _lastClientError = msg.slice(0, 200);
    console.error(`[rate-limit] Redis unavailable, falling back to in-memory: ${msg}`);
    _clientFailedAt = Date.now();
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
      backend: 'memory',
      headers: buildHeaders(
        false,
        limit,
        0,
        Math.ceil((oldestInWindow + windowMs) / 1000),
        retryAfterSeconds,
        'memory',
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
    backend: 'memory',
    headers: buildHeaders(true, limit, remaining, Math.ceil((now + windowMs) / 1000), 0, 'memory'),
  };
}

/**
 * Main entry point. Async because Redis is async.
 * Falls through to in-memory if REDIS_URL isn't configured (e.g. local dev).
 */
export async function rateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const client = getClient();
  if (client) {
    return rateLimitRedis(client, key, config);
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
