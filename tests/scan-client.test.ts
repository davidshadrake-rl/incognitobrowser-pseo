/**
 * lib/scan-client — the single browser-side path to the scanner API.
 *
 * Guards:
 *   - API base defaults to '' (same-origin) — never a hardcoded hostname
 *   - solveChallenge finds n with sha256(salt+n) === challenge and encodes
 *     the exact wire format the server's verifier expects
 *   - scanUrl performs challenge → solve → POST /scan-url WITH Authorization
 *     (the URL checker's unfurl used to skip the proof entirely)
 *   - a 403 from /challenge surfaces as an error (origin not allowlisted)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256 } from 'js-sha256';

// Build a solvable challenge deterministically (small search space).
function makeChallenge(answer = 137) {
  const salt = 'testsalt-' + Math.random().toString(16).slice(2);
  return {
    algorithm: 'SHA-256',
    salt,
    challenge: sha256(salt + answer),
    maxnumber: 1000,
    signature: 'deadbeef',
    expires: Math.floor(Date.now() / 1000) + 60,
    answer,
  };
}

async function load(env?: string) {
  vi.resetModules();
  if (env === undefined) delete process.env.NEXT_PUBLIC_SCAN_API;
  else process.env.NEXT_PUBLIC_SCAN_API = env;
  return import('../lib/scan-client');
}

const originalFetch = globalThis.fetch;
beforeEach(() => { delete process.env.NEXT_PUBLIC_SCAN_API; });
afterEach(() => { globalThis.fetch = originalFetch; vi.resetModules(); });

describe('SCAN_API_BASE', () => {
  it("defaults to '' (same-origin) — never a hardcoded hostname", async () => {
    const m = await load(undefined);
    expect(m.SCAN_API_BASE).toBe('');
    expect(m.SCAN_API_BASE).not.toMatch(/incognitobrowser\.io/);
  });
  it('honours an explicit NEXT_PUBLIC_SCAN_API (static export)', async () => {
    const m = await load('https://incognitobrowser-pseo.vercel.app');
    expect(m.SCAN_API_BASE).toBe('https://incognitobrowser-pseo.vercel.app');
  });
});

describe('solveChallenge', () => {
  it('finds the number and encodes the Altcha wire format', async () => {
    const { solveChallenge } = await load(undefined);
    const c = makeChallenge(137);
    const statuses: string[] = [];
    const auth = await solveChallenge(c, (s) => statuses.push(s));
    expect(auth.startsWith('Altcha ')).toBe(true);
    const decoded = JSON.parse(atob(auth.slice('Altcha '.length)));
    expect(decoded).toEqual({
      algorithm: 'SHA-256',
      salt: c.salt,
      number: 137,
      signature: 'deadbeef',
      expires: c.expires,
    });
    expect(sha256(c.salt + decoded.number)).toBe(c.challenge);
    expect(statuses).toContain('solving');
  });

  it('throws when the answer is outside maxnumber', async () => {
    const { solveChallenge } = await load(undefined);
    const c = { ...makeChallenge(5000), maxnumber: 10 };
    await expect(solveChallenge(c)).rejects.toThrow(/search space/);
  });
});

describe('scanUrl', () => {
  it('does challenge → solve → POST /scan-url with the proof in Authorization', async () => {
    const { scanUrl } = await load(undefined);
    const c = makeChallenge(42);
    const calls: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith('/challenge')) {
        return new Response(JSON.stringify({ ...c, answer: undefined }), { status: 200 });
      }
      if (url.endsWith('/scan-url')) {
        return new Response(JSON.stringify({ url: 'https://final.example/', cookies: [] }), { status: 200 });
      }
      throw new Error('unexpected ' + url);
    }) as unknown as typeof fetch;

    const statuses: string[] = [];
    const { res, data } = await scanUrl('https://bit.ly/abc', (s) => statuses.push(s));
    expect(res.ok).toBe(true);
    expect(data.url).toBe('https://final.example/');
    // same-origin: relative paths
    expect(calls[0].url).toBe('/challenge');
    expect(calls[1].url).toBe('/scan-url');
    const auth = (calls[1].init.headers as Record<string, string>).Authorization;
    expect(auth).toMatch(/^Altcha /);
    expect(JSON.parse(atob(auth.slice(7))).number).toBe(42);
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ url: 'https://bit.ly/abc' });
    expect(statuses).toEqual(['verifying', 'solving', 'scanning']);
  });

  it('surfaces a 403 from /challenge (origin not allowlisted) as an error', async () => {
    const { scanUrl } = await load(undefined);
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: 'Origin not allowed.' }), { status: 403 })) as unknown as typeof fetch;
    await expect(scanUrl('https://example.com')).rejects.toThrow(/403/);
  });

  it('returns a non-2xx body without throwing so callers can read redirectTo (shortener unfurl)', async () => {
    const { scanUrl } = await load(undefined);
    const c = makeChallenge(3);
    globalThis.fetch = (async (url: string) => {
      if (url.endsWith('/challenge')) return new Response(JSON.stringify(c), { status: 200 });
      return new Response(JSON.stringify({ error: 'Redirect', redirectTo: 'https://real-destination.example/' }), { status: 400 });
    }) as unknown as typeof fetch;
    const { res, data } = await scanUrl('https://t.co/xyz');
    expect(res.status).toBe(400);
    expect(data.redirectTo).toBe('https://real-destination.example/');
  });
});
