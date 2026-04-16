/**
 * In-memory sliding window rate limiter for Vercel Edge/Serverless.
 *
 * For production at scale, swap this for @upstash/ratelimit + Upstash Redis.
 * This implementation is fine for low-to-medium traffic and single-instance deployments.
 *
 * Features:
 * - Sliding window (not fixed window) — smoother enforcement
 * - Per-IP tracking with automatic cleanup of expired entries
 * - Configurable limits per window
 * - Returns rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining, Retry-After)
 */

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Cleanup old entries every 60 seconds to prevent memory leaks
let lastCleanup = Date.now();
const CLEANUP_INTERVAL = 60_000;

function cleanup(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;

  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter(t => t > cutoff);
    if (entry.timestamps.length === 0) {
      store.delete(key);
    }
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
}

export function rateLimit(
  key: string,
  config: RateLimitConfig
): RateLimitResult {
  const now = Date.now();
  const { limit, windowMs } = config;
  const cutoff = now - windowMs;

  // Periodic cleanup
  cleanup(windowMs);

  // Get or create entry
  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Remove timestamps outside the current window
  entry.timestamps = entry.timestamps.filter(t => t > cutoff);

  const currentCount = entry.timestamps.length;

  if (currentCount >= limit) {
    // Rate limited
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = oldestInWindow + windowMs - now;
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds,
      headers: {
        'X-RateLimit-Limit': String(limit),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil((oldestInWindow + windowMs) / 1000)),
        'Retry-After': String(retryAfterSeconds),
      },
    };
  }

  // Allowed — record this request
  entry.timestamps.push(now);
  const remaining = limit - entry.timestamps.length;

  return {
    allowed: true,
    limit,
    remaining,
    retryAfterSeconds: 0,
    headers: {
      'X-RateLimit-Limit': String(limit),
      'X-RateLimit-Remaining': String(remaining),
      'X-RateLimit-Reset': String(Math.ceil((now + windowMs) / 1000)),
    },
  };
}

/**
 * Extract client IP from request headers.
 * Checks Vercel/Cloudflare/standard proxy headers.
 */
export function getClientIP(headers: Headers): string {
  // Vercel
  const xForwardedFor = headers.get('x-forwarded-for');
  if (xForwardedFor) {
    // Take the first IP (client IP) from the chain
    return xForwardedFor.split(',')[0].trim();
  }

  // Cloudflare
  const cfConnecting = headers.get('cf-connecting-ip');
  if (cfConnecting) return cfConnecting;

  // Vercel-specific
  const xRealIp = headers.get('x-real-ip');
  if (xRealIp) return xRealIp;

  return 'unknown';
}
