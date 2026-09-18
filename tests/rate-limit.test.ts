/**
 * Rate Limiting Tests
 *
 * These tests run without Redis env vars set, so the limiter falls back
 * to in-memory mode. That's intentional — KV behavior is exercised in
 * production; here we verify the algorithm + headers + edge cases work the
 * same in both modes (they share the same buildHeaders helper and result
 * shape).
 *
 * Tests are async because the public API is now async, even though the
 * fallback path returns synchronously underneath.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { rateLimit, getClientIP } from '../lib/rate-limit';

// Force in-memory mode by unsetting Redis env vars (in case they leaked from .env)
beforeEach(() => {
  delete process.env.REDIS_URL;
});
afterEach(() => {
  delete process.env.REDIS_URL;
});

describe('Rate Limiter - Basic Enforcement', () => {
  const config = { limit: 3, windowMs: 1000 };

  it('allows requests within the limit', async () => {
    const key = `test-allow-${Date.now()}-${Math.random()}`;
    const r1 = await rateLimit(key, config);
    const r2 = await rateLimit(key, config);
    const r3 = await rateLimit(key, config);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
  });

  it('blocks requests exceeding the limit', async () => {
    const key = `test-block-${Date.now()}-${Math.random()}`;
    await rateLimit(key, config);
    await rateLimit(key, config);
    await rateLimit(key, config);
    const r4 = await rateLimit(key, config);

    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('returns correct remaining count', async () => {
    const key = `test-remaining-${Date.now()}-${Math.random()}`;
    const r1 = await rateLimit(key, config);
    const r2 = await rateLimit(key, config);

    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
  });
});

describe('Rate Limiter - Headers', () => {
  const config = { limit: 5, windowMs: 60000 };

  it('returns X-RateLimit-Limit header', async () => {
    const key = `test-headers-${Date.now()}-${Math.random()}`;
    const result = await rateLimit(key, config);
    expect(result.headers['X-RateLimit-Limit']).toBe('5');
  });

  it('returns X-RateLimit-Remaining header', async () => {
    const key = `test-headers-rem-${Date.now()}-${Math.random()}`;
    const result = await rateLimit(key, config);
    expect(result.headers['X-RateLimit-Remaining']).toBe('4');
  });

  it('returns X-RateLimit-Reset header', async () => {
    const key = `test-headers-reset-${Date.now()}-${Math.random()}`;
    const result = await rateLimit(key, config);
    expect(result.headers['X-RateLimit-Reset']).toBeDefined();
    const resetTime = parseInt(result.headers['X-RateLimit-Reset']);
    expect(resetTime).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns Retry-After when rate limited', async () => {
    const key = `test-retry-${Date.now()}-${Math.random()}`;
    const cfg = { limit: 1, windowMs: 60000 };
    await rateLimit(key, cfg);
    const blocked = await rateLimit(key, cfg);

    expect(blocked.allowed).toBe(false);
    expect(blocked.headers['Retry-After']).toBeDefined();
    expect(parseInt(blocked.headers['Retry-After'])).toBeGreaterThan(0);
  });
});

describe('Rate Limiter - IP Isolation', () => {
  it('tracks different IPs independently', async () => {
    const config = { limit: 1, windowMs: 60000 };
    const ip1 = `ip1-${Date.now()}-${Math.random()}`;
    const ip2 = `ip2-${Date.now()}-${Math.random()}`;

    const r1 = await rateLimit(ip1, config);
    const r2 = await rateLimit(ip2, config);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    // ip1 should now be blocked, ip2 should also be blocked
    expect((await rateLimit(ip1, config)).allowed).toBe(false);
    expect((await rateLimit(ip2, config)).allowed).toBe(false);
  });
});

describe('Rate Limiter - Window Expiry', () => {
  it('resets after window expires', async () => {
    const config = { limit: 1, windowMs: 100 }; // 100ms window
    const key = `test-expiry-${Date.now()}-${Math.random()}`;

    await rateLimit(key, config);
    expect((await rateLimit(key, config)).allowed).toBe(false);

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 150));

    expect((await rateLimit(key, config)).allowed).toBe(true);
  });
});

describe('IP Extraction', () => {
  function makeHeaders(obj: Record<string, string>): Headers {
    return new Headers(obj);
  }

  // Was "(first entry)", asserting the leftmost value — which is the entry a
  // client can forge. This test encoded the bypass as correct behaviour and
  // would have failed anyone fixing it. Corrected 2026-09-18: the last hop is
  // the only one our own proxy wrote (lib/rate-limit.ts getClientIP).
  it('extracts IP from X-Forwarded-For (last entry, the one our proxy wrote)', () => {
    const headers = makeHeaders({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' });
    expect(getClientIP(headers)).toBe('9.10.11.12');
  });

  it('extracts IP from cf-connecting-ip', () => {
    const headers = makeHeaders({ 'cf-connecting-ip': '1.2.3.4' });
    expect(getClientIP(headers)).toBe('1.2.3.4');
  });

  it('extracts IP from x-real-ip', () => {
    const headers = makeHeaders({ 'x-real-ip': '1.2.3.4' });
    expect(getClientIP(headers)).toBe('1.2.3.4');
  });

  it('returns unknown when no IP headers present', () => {
    const headers = makeHeaders({});
    expect(getClientIP(headers)).toBe('unknown');
  });

  it('prefers X-Forwarded-For over other headers', () => {
    const headers = makeHeaders({
      'x-forwarded-for': '1.1.1.1',
      'cf-connecting-ip': '2.2.2.2',
      'x-real-ip': '3.3.3.3',
    });
    expect(getClientIP(headers)).toBe('1.1.1.1');
  });
});

/**
 * getClientIP and the forged-header bypass (found and fixed 2026-09-18).
 *
 * This function buckets the rate limiter, so whatever it returns is the unit
 * of "per IP". Apache appends the real peer to X-Forwarded-For instead of
 * replacing it, so every entry but the last is client-controlled. Reading the
 * leftmost entry let anyone reset their own limit by rotating one header —
 * confirmed against the live host before the fix.
 */
describe('getClientIP cannot be steered by a forged header', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it('takes the last hop, which is the only one our own proxy wrote', async () => {
    const { getClientIP } = await import('../lib/rate-limit');
    // What Apache produces when the client sent a forged value.
    expect(getClientIP(h({ 'x-forwarded-for': '1.2.3.4, 203.0.113.7' }))).toBe('203.0.113.7');
    // A whole forged chain still cannot push the real peer out of last place.
    expect(getClientIP(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3, 203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('is unchanged for the ordinary single-hop case', async () => {
    const { getClientIP } = await import('../lib/rate-limit');
    expect(getClientIP(h({ 'x-forwarded-for': '203.0.113.7' }))).toBe('203.0.113.7');
  });

  it('two attackers rotating headers still share one bucket', async () => {
    const { getClientIP, getIpBucket } = await import('../lib/rate-limit');
    const a = getIpBucket(getClientIP(h({ 'x-forwarded-for': '9.9.9.9, 203.0.113.7' })));
    const b = getIpBucket(getClientIP(h({ 'x-forwarded-for': '8.8.8.8, 203.0.113.7' })));
    expect(a).toBe(b);
  });

  it('falls back only when no X-Forwarded-For is present at all', async () => {
    const { getClientIP } = await import('../lib/rate-limit');
    expect(getClientIP(h({ 'cf-connecting-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(getClientIP(h({}))).toBe('unknown');
  });
});
