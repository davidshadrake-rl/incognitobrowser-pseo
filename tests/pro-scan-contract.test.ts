/**
 * The /scan-url response contract, driven with a hostile target.
 *
 * The Pro scanner renders this payload into React. Everything in it that a
 * visitor sees — cookie names, cookie domains, third-party hostnames, the
 * scanned URL — was written by the site being scanned, so the two questions
 * that matter are what the payload may CONTAIN (its shape) and what happens to
 * the attacker-controlled strings inside it.
 *
 * Why this file exists alongside scripts/security/checks/pro-scan-url-contract.mjs:
 * that check reads the source and grades the contract. This one RUNS the real
 * lib/scanner.ts analyzeScan and the real app/scan-url/route.ts against a
 * response whose Set-Cookie headers and HTML are hostile, because a contract
 * asserted only by grep is the failure mode this repo already paid for once
 * (tests/ssrf-protection.test.ts graded a hand-copied replica for weeks).
 *
 * Nothing here opens a socket: globalThis.fetch and the route's DNS lookup are
 * both replaced, and the replacements are asserted to have been CALLED, so a
 * refactor that stops using them shows up as a broken test rather than as a
 * quiet pass.
 *
 * WHAT THIS FILE DOES NOT CLAIM. It does not render CookieAnalyzerTool. There
 * is no DOM environment in this suite (vitest.config.ts: environment 'node'),
 * and mounting a client component to watch React escape a string would be a
 * test of React. The rendering half is asserted at the source level by
 * pro_scan_xss_cookie_name_and_inline_tracker, which pins each field's JSX
 * interpolation site and fails if one moves.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import dns from 'node:dns';
import { promisify } from 'node:util';
import { NextRequest } from 'next/server';

/**
 * The locked shape. Same list as RESULT_KEYS in
 * scripts/security/checks/pro-scan-url-contract.mjs — deliberately duplicated
 * rather than imported, because the two files answer to different runners and
 * a shared constant that one of them stops importing would silently widen both.
 *
 * `inlineTrackers` is on this list and is not a leak: lib/scanner.ts builds it
 * from the six literal labels in INLINE_TRACKERS, never from the matched text.
 * The test at the foot of this file is what keeps that true.
 */
const RESULT_KEYS = ['url', 'status', 'cookies', 'trackers', 'inlineTrackers', 'thirdPartyDomains', 'security', 'summary'];

/** A marker that exists only in the fetched page body. It must never come back. */
const BODY_MARKER = 'PAGE_BODY_MARKER_9a3f';

/**
 * A cookie name carrying the brief's payload. Note the '=' characters: RFC 6265
 * splits name from value at the FIRST '=', so what arrives as a cookie name is
 * the part before `=x`. The test asserts the parser's real answer rather than
 * the string we hoped for — a test that asserted the whole payload survived
 * would be asserting a bug.
 */
const HOSTILE_COOKIE = '"><img src=x onerror=alert(1)>';
/** The same idea with no '=' in it, so the whole payload does survive parsing. */
const HOSTILE_COOKIE_2 = '<script>alert(1)</script>';

function hostileResponse(): Response {
  const headers = new Headers({ 'content-type': 'text/html' });
  headers.append('set-cookie', `${HOSTILE_COOKIE}=sessionvalue123; Domain="><svg onload=alert(1)>; Path=/; SameSite=None`);
  headers.append('set-cookie', `${HOSTILE_COOKIE_2}=2; Path=/`);
  headers.append('set-cookie', 'sid=abc; Secure; HttpOnly; SameSite=Strict');
  const html = [
    '<html><head>',
    // A real inline tracker, so inlineTrackers is non-empty and the label test
    // below is not vacuous.
    `<script>fbq('init','111')</script>`,
    // A third-party script whose URL tries to carry markup out of the regex.
    `<script src="https://evil-tracker.example/x.js?a=%22%3E%3Cscript%3Ealert(1)%3C/script%3E"></script>`,
    `</head><body><!-- ${BODY_MARKER} --><p>hello</p></body></html>`,
  ].join('');
  return new Response(html, { status: 200, headers });
}

const LIMITS = { maxCookies: 50, maxScriptMatches: 500, maxThirdPartyDomains: 50 };

describe('pro_scan_xss_cookie_name_and_inline_tracker — analyzeScan over a hostile target', () => {
  it('returns exactly the locked top-level keys', async () => {
    const { analyzeScan } = await import('@/lib/scanner');
    const target = 'https://hostile.example/';
    const result = analyzeScan(target, new URL(target), hostileResponse(), '<html></html>', LIMITS);
    expect(Object.keys(result).sort()).toEqual([...RESULT_KEYS].sort());
  });

  it('never returns the fetched page body, in any field', async () => {
    const { analyzeScan } = await import('@/lib/scanner');
    const target = 'https://hostile.example/';
    const res = hostileResponse();
    const html = await res.clone().text();
    expect(html, 'the fixture must actually contain the marker or this test proves nothing').toContain(BODY_MARKER);
    const result = analyzeScan(target, new URL(target), res, html, LIMITS);
    expect(JSON.stringify(result)).not.toContain(BODY_MARKER);
  });

  it('carries the hostile cookie name through as data — RFC 6265 truncation and all', async () => {
    const { analyzeScan } = await import('@/lib/scanner');
    const target = 'https://hostile.example/';
    const result = analyzeScan(target, new URL(target), hostileResponse(), '<html></html>', LIMITS);
    const names = result.cookies.map((c) => c.cookieName);

    // The payload contains '=', so the cookie name ends at the first one. This
    // is what the scanner really produces and what the tool really renders.
    expect(names).toContain(HOSTILE_COOKIE.split('=')[0]);
    // The '='-free payload survives whole.
    expect(names).toContain(HOSTILE_COOKIE_2);

    // The hostile Domain attribute is preserved as data too, angle brackets
    // and all. Nothing sanitises it, and nothing should: it is displayed as
    // text, and a scanner that quietly rewrote what a site sent would be lying
    // about what it found.
    const hostile = result.cookies.find((c) => c.cookieName === HOSTILE_COOKIE_2);
    expect(hostile, 'the hostile cookie was dropped entirely — the fixture or the parser changed').toBeTruthy();

    // And the one property that is not merely cosmetic: no field of a cookie
    // is ever marked as HTML anywhere in the payload. This is a data contract,
    // so the assertion is that the values are plain strings.
    for (const c of result.cookies) {
      expect(typeof c.cookieName).toBe('string');
      expect(typeof c.domain).toBe('string');
    }
  });

  it('third-party domains are hostnames, so markup cannot ride in on one', async () => {
    const { analyzeScan } = await import('@/lib/scanner');
    const target = 'https://hostile.example/';
    const res = hostileResponse();
    const html = await res.clone().text();
    const result = analyzeScan(target, new URL(target), res, html, LIMITS);
    expect(result.thirdPartyDomains.length, 'the fixture\'s third-party script was not detected').toBeGreaterThan(0);
    for (const d of result.thirdPartyDomains) {
      // lib/scanner.ts builds these with new URL(...).hostname, which cannot
      // contain <, > or a quote. Pinned so a future "just take the src string"
      // refactor is visible here.
      expect(d, `third-party domain ${d} is not a bare hostname`).toMatch(/^[a-z0-9.\-[\]:]+$/i);
    }
  });

  it('inlineTrackers only ever contains our own labels, never the matched text', async () => {
    const scanner = await import('@/lib/scanner');
    const target = 'https://hostile.example/';
    const res = hostileResponse();
    const html = await res.clone().text();
    const result = scanner.analyzeScan(target, new URL(target), res, html, LIMITS);
    const labels = scanner.INLINE_TRACKERS.map((i) => i.label);

    expect(result.inlineTrackers.length, 'the fixture\'s inline fbq() was not detected — this test would be vacuous').toBeGreaterThan(0);
    for (const t of result.inlineTrackers) {
      expect(labels, `inlineTrackers carried ${JSON.stringify(t)}, which is not one of our labels`).toContain(t);
    }
  });
});

// ---------------------------------------------------------------------------
// The same contract, through the real route
// ---------------------------------------------------------------------------

const HOST = 'api.incognitobrowser.io';
/**
 * The Pro pages' origin. Today /resources-pro and /api share one host, so this
 * is the same Origin the free site sends — which is itself the point of
 * pro_scan_url_origin_allowlist_company_host. It is spelled out here so that
 * when Pro does move to a company host, the value that needs changing is
 * visible rather than implied.
 */
const PRO_ORIGIN = 'https://206-189-186-34.nip.io';

let fetchCalls: string[] = [];
let dnsCalls: string[] = [];
let nextResponse: () => Response = hostileResponse;

beforeAll(() => {
  process.env.ALTCHA_HMAC_KEY = 'pro-scan-contract-test-key-at-least-32-chars-long';
  // The route promisifies node:dns's lookup at module load; util.promisify
  // honours a promisify.custom property on the function object, so defining it
  // here captures the route's resolver whenever it is imported.
  (dns.lookup as unknown as Record<symbol, unknown>)[promisify.custom] = async (hostname: string) => {
    dnsCalls.push(hostname);
    return [{ address: '93.184.216.34', family: 4 }];
  };
});

beforeEach(() => {
  vi.resetModules();
  fetchCalls = [];
  dnsCalls = [];
  nextResponse = hostileResponse;
  delete process.env.REDIS_URL;
  process.env.ALLOWED_ORIGINS = PRO_ORIGIN;
  globalThis.fetch = (async (url: string | URL) => {
    fetchCalls.push(String(url));
    return nextResponse();
  }) as typeof fetch;
});

afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
});

/** Mint and solve a real proof-of-work with the same module instance the route uses. */
async function powHeader(): Promise<string> {
  const altcha = await import('@/lib/altcha');
  const ch = altcha.createChallenge(1, 90);
  let number = -1;
  for (let n = 0; n <= ch.maxnumber; n++) {
    if (createHash('sha256').update(ch.salt + n).digest('hex') === ch.challenge) { number = n; break; }
  }
  expect(number, 'could not solve our own challenge — lib/altcha changed shape').toBeGreaterThanOrEqual(0);
  return altcha.encodeAltchaAuthHeader({
    algorithm: 'SHA-256', salt: ch.salt, number, signature: ch.signature, expires: ch.expires,
  });
}

function scanRequest(url: string, authorization: string | null, origin: string | null = PRO_ORIGIN): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json', host: HOST, 'x-forwarded-for': '203.0.113.9' };
  if (origin) headers.origin = origin;
  if (authorization) headers.authorization = authorization;
  return new NextRequest(`https://${HOST}/scan-url`, { method: 'POST', headers, body: JSON.stringify({ url }) });
}

async function loadRoute() {
  const origin = await import('@/lib/origin');
  origin._resetOriginCacheForTests();
  return import('@/app/scan-url/route');
}

describe('POST /scan-url from the Pro origin — the response shape is what leaves the server', () => {
  it('a successful scan returns exactly the locked keys and nothing else', async () => {
    const auth = await powHeader();
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://hostile.example/', auth));

    expect(res.status, 'the hostile fixture should scan cleanly — this is the control').toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([...RESULT_KEYS].sort());

    // The instrumentation actually ran. Without this, "no extra keys" could
    // mean the request never reached the fetch at all.
    expect(fetchCalls, 'the outbound fetch stub was never called').toHaveLength(1);
    expect(dnsCalls, 'the resolver stub was never called — the SSRF resolve leg did not run').toHaveLength(1);

    // Nothing of the fetched document, and nothing of the co-hosted WordPress.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain(BODY_MARKER);
    expect(raw).not.toMatch(/wp-json|wp-content/i);
  });

  it('sets no cookie of its own, on the success path or the refusal path', async () => {
    const auth = await powHeader();
    const { POST } = await loadRoute();

    const ok = await POST(scanRequest('https://hostile.example/', auth));
    expect(ok.headers.get('set-cookie'), 'the scan API set a cookie on our own origin').toBeNull();

    const refused = await POST(scanRequest('https://hostile.example/', null, 'https://evil.example'));
    expect(refused.status).toBe(403);
    expect(refused.headers.get('set-cookie')).toBeNull();
  });

  it('refuses a redirect instead of following it, whatever the Location says', async () => {
    // The case the SSRF table cannot manufacture from a host we do not own: a
    // public URL whose Location points at the cloud metadata service. This box
    // is a DigitalOcean droplet, so 169.254.169.254 answers from it.
    const auth = await powHeader();
    nextResponse = () => new Response(null, {
      status: 302,
      headers: { location: 'http://169.254.169.254/latest/meta-data/iam/security-credentials/' },
    });
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://public-redirector.example/', auth));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/redirects \(HTTP 302\)/);
    // Exactly one outbound request: the Location was reported, never fetched.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toBe('https://public-redirector.example/');

    // redirectTo echoes an attacker-chosen string, so its bound is part of the
    // contract. app/scan-url/route.ts caps it at 500 characters.
    expect(body.redirectTo).toBe('http://169.254.169.254/latest/meta-data/iam/security-credentials/');
    expect(Object.keys(body).sort()).toEqual(['error', 'redirectTo']);
  });

  it('caps the echoed Location at 500 characters', async () => {
    const auth = await powHeader();
    const long = `http://169.254.169.254/${'a'.repeat(900)}`;
    nextResponse = () => new Response(null, { status: 301, headers: { location: long } });
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://public-redirector.example/', auth));
    const body = await res.json();
    expect(body.redirectTo).toHaveLength(500);
  });

  it('refuses an address inside the target\'s DNS answer before it fetches anything', async () => {
    // The resolver leg, driven for real: a public NAME whose A record points at
    // the metadata service. This is 169-254-169-254.nip.io in the live table.
    const auth = await powHeader();
    (dns.lookup as unknown as Record<symbol, unknown>)[promisify.custom] = async (hostname: string) => {
      dnsCalls.push(hostname);
      return [{ address: '169.254.169.254', family: 4 }];
    };
    try {
      const { POST } = await loadRoute();
      const res = await POST(scanRequest('http://169-254-169-254.nip.io/', auth));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(/Cannot scan private IP addresses/);
      expect(dnsCalls, 'the name was never resolved, so this refusal came from the text guard, not the resolve leg').toEqual(['169-254-169-254.nip.io']);
      expect(fetchCalls, 'an outbound request was made to a name that resolves to cloud metadata').toHaveLength(0);
    } finally {
      (dns.lookup as unknown as Record<symbol, unknown>)[promisify.custom] = async (hostname: string) => {
        dnsCalls.push(hostname);
        return [{ address: '93.184.216.34', family: 4 }];
      };
    }
  });
});
