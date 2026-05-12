/**
 * API security tests — Altcha POW + Origin allowlist for /scan-url.
 *
 * Covers the three defense layers added in response to the security review:
 *   1. lib/altcha.ts — HMAC-signed POW challenge/response
 *   2. lib/origin.ts — env-configurable Origin allowlist
 *   3. /challenge endpoint — gating + rate limiting
 *
 * Each test runs in isolation. We set ALTCHA_HMAC_KEY at the top so all tests
 * have a valid signing secret.
 */

import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createHash } from 'node:crypto';

beforeAll(() => {
  process.env.ALTCHA_HMAC_KEY = 'test-secret-key-that-is-at-least-32-characters-long-for-real';
});

afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
});

function readFile(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf-8');
}

// --- Altcha challenge/response ---

describe('Altcha challenge generation', () => {
  it('createChallenge produces a verifiable challenge', async () => {
    const { createChallenge } = await import('../lib/altcha');
    const challenge = createChallenge(1000, 60);
    expect(challenge.algorithm).toBe('SHA-256');
    expect(challenge.salt).toMatch(/^[0-9a-f]+$/);
    expect(challenge.challenge).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.maxnumber).toBe(1000);
    expect(challenge.expires).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('different calls produce different salts (not deterministic)', async () => {
    const { createChallenge } = await import('../lib/altcha');
    const a = createChallenge();
    const b = createChallenge();
    expect(a.salt).not.toBe(b.salt);
    expect(a.challenge).not.toBe(b.challenge);
  });

  it('throws if ALTCHA_HMAC_KEY is missing', async () => {
    const saved = process.env.ALTCHA_HMAC_KEY;
    delete process.env.ALTCHA_HMAC_KEY;
    const { createChallenge } = await import('../lib/altcha');
    expect(() => createChallenge()).toThrow(/ALTCHA_HMAC_KEY/);
    process.env.ALTCHA_HMAC_KEY = saved;
  });

  it('throws if ALTCHA_HMAC_KEY is too short', async () => {
    const saved = process.env.ALTCHA_HMAC_KEY;
    process.env.ALTCHA_HMAC_KEY = 'too-short';
    const { createChallenge } = await import('../lib/altcha');
    expect(() => createChallenge()).toThrow(/too short/);
    process.env.ALTCHA_HMAC_KEY = saved;
  });
});

describe('Altcha solution verification', () => {
  it('verifies a valid solution', async () => {
    const { createChallenge, verifySolution } = await import('../lib/altcha');
    const challenge = createChallenge(100, 60);
    // Brute-force the secret number — it's bounded by maxnumber so this is fast
    let solvedNumber = -1;
    for (let n = 0; n <= challenge.maxnumber; n++) {
      const hash = createHash('sha256').update(challenge.salt + n).digest('hex');
      if (hash === challenge.challenge) { solvedNumber = n; break; }
    }
    expect(solvedNumber).toBeGreaterThanOrEqual(0);
    const result = verifySolution({
      algorithm: challenge.algorithm,
      salt: challenge.salt,
      number: solvedNumber,
      signature: challenge.signature,
      expires: challenge.expires,
    });
    expect(result.valid).toBe(true);
  });

  it('rejects a solution with the wrong (in-range) number', async () => {
    const { createChallenge, verifySolution } = await import('../lib/altcha');
    const challenge = createChallenge(100, 60);
    // A plausible number that's almost certainly not the right answer.
    // Sig will mismatch because hash(salt + 999999) won't equal challenge for
    // any maxnumber=100 puzzle.
    const result = verifySolution({
      algorithm: challenge.algorithm,
      salt: challenge.salt,
      number: 999_999,
      signature: challenge.signature,
      expires: challenge.expires,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('sig_mismatch');
  });

  it('rejects out-of-bound number values', async () => {
    const { createChallenge, verifySolution } = await import('../lib/altcha');
    const challenge = createChallenge(100, 60);
    const result = verifySolution({
      algorithm: challenge.algorithm,
      salt: challenge.salt,
      number: 999_999_999, // exceeds sanity ceiling
      signature: challenge.signature,
      expires: challenge.expires,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('bad_number');
  });

  it('rejects a tampered signature', async () => {
    const { createChallenge, verifySolution } = await import('../lib/altcha');
    const challenge = createChallenge(100, 60);
    const result = verifySolution({
      algorithm: challenge.algorithm,
      salt: challenge.salt,
      number: 0,
      signature: 'a'.repeat(64),
      expires: challenge.expires,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('sig_mismatch');
  });

  it('rejects expired solutions', async () => {
    const { createChallenge, verifySolution } = await import('../lib/altcha');
    const challenge = createChallenge(100, 60);
    const result = verifySolution({
      algorithm: challenge.algorithm,
      salt: challenge.salt,
      number: 0,
      signature: challenge.signature,
      expires: Math.floor(Date.now() / 1000) - 100, // 100 seconds ago
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expired');
  });

  it('rejects solutions with implausibly far-future expiry', async () => {
    const { createChallenge, verifySolution } = await import('../lib/altcha');
    const challenge = createChallenge(100, 60);
    const result = verifySolution({
      algorithm: challenge.algorithm,
      salt: challenge.salt,
      number: 0,
      signature: challenge.signature,
      expires: Math.floor(Date.now() / 1000) + 100_000,
    });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('expires_too_far');
  });

  it('rejects malformed solutions', async () => {
    const { verifySolution } = await import('../lib/altcha');
    expect(verifySolution(null).valid).toBe(false);
    expect(verifySolution('string').valid).toBe(false);
    expect(verifySolution({}).valid).toBe(false);
    expect(verifySolution({ algorithm: 'MD5' }).valid).toBe(false);
  });

  it('parses Altcha Authorization headers', async () => {
    const { parseAltchaAuthHeader } = await import('../lib/altcha');
    const valid = Buffer.from(
      JSON.stringify({ salt: 'abc', number: 5, signature: 'x'.repeat(64), expires: 0 }),
    ).toString('base64');
    const parsed = parseAltchaAuthHeader(`Altcha ${valid}`);
    expect(parsed).not.toBeNull();
    expect(parsed?.number).toBe(5);

    expect(parseAltchaAuthHeader(null)).toBeNull();
    expect(parseAltchaAuthHeader('Bearer xyz')).toBeNull();
    expect(parseAltchaAuthHeader('Altcha not-base64-json!!')).toBeNull();
  });
});

// --- Origin allowlist ---

describe('Origin allowlist', () => {
  it('reads ALLOWED_ORIGINS env var if set', async () => {
    process.env.ALLOWED_ORIGINS = 'https://a.example,https://b.example';
    const { _resetOriginCacheForTests, getAllowedOrigins, isOriginAllowed } =
      await import('../lib/origin');
    _resetOriginCacheForTests();
    expect(getAllowedOrigins()).toEqual(['https://a.example', 'https://b.example']);
    expect(isOriginAllowed('https://a.example')).toBe(true);
    expect(isOriginAllowed('https://evil.example')).toBe(false);
    expect(isOriginAllowed(null)).toBe(false);
  });

  it('falls back to default list when env var is unset', async () => {
    const { _resetOriginCacheForTests, getAllowedOrigins } = await import('../lib/origin');
    _resetOriginCacheForTests();
    const origins = getAllowedOrigins();
    expect(origins).toContain('https://incognitobrowser.io');
  });

  it('trims whitespace in env var values', async () => {
    process.env.ALLOWED_ORIGINS = '  https://a.example  ,  https://b.example  ';
    const { _resetOriginCacheForTests, getAllowedOrigins } = await import('../lib/origin');
    _resetOriginCacheForTests();
    const origins = getAllowedOrigins();
    expect(origins).toContain('https://a.example');
    expect(origins).toContain('https://b.example');
  });
});

describe('CORS headers', () => {
  it('mirrors allowed origin in ACAO', async () => {
    process.env.ALLOWED_ORIGINS = 'https://test.example';
    const { _resetOriginCacheForTests, corsHeadersFor } = await import('../lib/origin');
    _resetOriginCacheForTests();
    const headers = corsHeadersFor('https://test.example');
    expect(headers['Access-Control-Allow-Origin']).toBe('https://test.example');
  });

  it('omits ACAO for non-allowed origin', async () => {
    process.env.ALLOWED_ORIGINS = 'https://test.example';
    const { _resetOriginCacheForTests, corsHeadersFor } = await import('../lib/origin');
    _resetOriginCacheForTests();
    const headers = corsHeadersFor('https://evil.example');
    expect(headers['Access-Control-Allow-Origin']).toBeUndefined();
  });

  it('always sets security headers', async () => {
    const { corsHeadersFor } = await import('../lib/origin');
    const headers = corsHeadersFor(null);
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('DENY');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Vary']).toBe('Origin');
  });
});

// --- Source-level guarantees on the route handlers ---

describe('scan-url route enforces POW + origin', () => {
  const src = readFile('app/scan-url/route.ts');

  it('rejects non-allowed origins with 403', () => {
    expect(src).toMatch(/!isOriginAllowed\(origin\)/);
    expect(src).toContain("'Origin not allowed.'");
    expect(src).toMatch(/status:\s*403/);
  });

  it('parses Altcha header and verifies the solution', () => {
    expect(src).toContain('parseAltchaAuthHeader');
    expect(src).toContain('verifySolution');
    expect(src).toMatch(/!altchaResult\.valid/);
  });

  it('returns 401 for missing/invalid POW', () => {
    expect(src).toMatch(/Missing or invalid proof-of-work/);
    expect(src).toMatch(/status:\s*401/);
  });
});

describe('challenge endpoint exists with rate limit', () => {
  const src = readFile('app/challenge/route.ts');

  it('uses GET method', () => {
    expect(src).toMatch(/export async function GET/);
  });

  it('checks origin before issuing a challenge', () => {
    expect(src).toMatch(/!isOriginAllowed\(origin\)/);
  });

  it('rate limits per IP', () => {
    expect(src).toMatch(/rateLimit\(/);
    expect(src).toMatch(/challenge:/);
  });

  it('uses createChallenge from lib', () => {
    expect(src).toContain('createChallenge');
  });
});

describe('client wiring', () => {
  const src = readFile('components/tools/CookieAnalyzerTool.tsx');

  it('calls /challenge before /scan-url', () => {
    expect(src).toMatch(/\/challenge/);
    expect(src).toMatch(/solveAltchaChallenge/);
  });

  it('sends Authorization header with the scan request', () => {
    expect(src).toMatch(/Authorization:\s*authHeader/);
  });

  it('uses NEXT_PUBLIC_SCAN_API override when available', () => {
    expect(src).toContain('NEXT_PUBLIC_SCAN_API');
  });
});
