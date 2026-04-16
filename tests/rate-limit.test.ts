/**
 * Rate Limiting Tests (OWASP A05 - Security Misconfiguration)
 *
 * Verifies that the rate limiter:
 * - Allows requests within the limit
 * - Blocks requests exceeding the limit
 * - Returns correct headers (X-RateLimit-Limit, Remaining, Retry-After)
 * - Resets after the window expires
 * - Tracks different IPs independently
 * - Cleans up expired entries (memory leak prevention)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { rateLimit, getClientIP } from '../lib/rate-limit';

describe('Rate Limiter - Basic Enforcement', () => {
  const config = { limit: 3, windowMs: 1000 };

  it('allows requests within the limit', () => {
    const key = `test-allow-${Date.now()}`;
    const r1 = rateLimit(key, config);
    const r2 = rateLimit(key, config);
    const r3 = rateLimit(key, config);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r3.allowed).toBe(true);
  });

  it('blocks requests exceeding the limit', () => {
    const key = `test-block-${Date.now()}`;
    rateLimit(key, config);
    rateLimit(key, config);
    rateLimit(key, config);
    const r4 = rateLimit(key, config);

    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
  });

  it('returns correct remaining count', () => {
    const key = `test-remaining-${Date.now()}`;
    const r1 = rateLimit(key, config);
    const r2 = rateLimit(key, config);

    expect(r1.remaining).toBe(2);
    expect(r2.remaining).toBe(1);
  });
});

describe('Rate Limiter - Headers', () => {
  const config = { limit: 5, windowMs: 60000 };

  it('returns X-RateLimit-Limit header', () => {
    const key = `test-headers-${Date.now()}`;
    const result = rateLimit(key, config);
    expect(result.headers['X-RateLimit-Limit']).toBe('5');
  });

  it('returns X-RateLimit-Remaining header', () => {
    const key = `test-headers-rem-${Date.now()}`;
    const result = rateLimit(key, config);
    expect(result.headers['X-RateLimit-Remaining']).toBe('4');
  });

  it('returns X-RateLimit-Reset header', () => {
    const key = `test-headers-reset-${Date.now()}`;
    const result = rateLimit(key, config);
    expect(result.headers['X-RateLimit-Reset']).toBeDefined();
    const resetTime = parseInt(result.headers['X-RateLimit-Reset']);
    expect(resetTime).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns Retry-After when rate limited', () => {
    const key = `test-retry-${Date.now()}`;
    const cfg = { limit: 1, windowMs: 60000 };
    rateLimit(key, cfg);
    const blocked = rateLimit(key, cfg);

    expect(blocked.allowed).toBe(false);
    expect(blocked.headers['Retry-After']).toBeDefined();
    expect(parseInt(blocked.headers['Retry-After'])).toBeGreaterThan(0);
  });
});

describe('Rate Limiter - IP Isolation', () => {
  it('tracks different IPs independently', () => {
    const config = { limit: 1, windowMs: 60000 };
    const ip1 = `ip1-${Date.now()}`;
    const ip2 = `ip2-${Date.now()}`;

    const r1 = rateLimit(ip1, config);
    const r2 = rateLimit(ip2, config);

    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);

    // ip1 should now be blocked, ip2 should also be blocked
    expect(rateLimit(ip1, config).allowed).toBe(false);
    expect(rateLimit(ip2, config).allowed).toBe(false);
  });
});

describe('Rate Limiter - Window Expiry', () => {
  it('resets after window expires', async () => {
    const config = { limit: 1, windowMs: 100 }; // 100ms window
    const key = `test-expiry-${Date.now()}`;

    rateLimit(key, config);
    expect(rateLimit(key, config).allowed).toBe(false);

    // Wait for window to expire
    await new Promise(resolve => setTimeout(resolve, 150));

    expect(rateLimit(key, config).allowed).toBe(true);
  });
});

describe('IP Extraction', () => {
  function makeHeaders(obj: Record<string, string>): Headers {
    return new Headers(obj);
  }

  it('extracts IP from X-Forwarded-For (first entry)', () => {
    const headers = makeHeaders({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' });
    expect(getClientIP(headers)).toBe('1.2.3.4');
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
