/**
 * Audit group 2A-scan — the controls on POST /scan-url, driven rather than grepped.
 *
 * Every item in this group was already "covered" before this file existed, and
 * in most cases the cover was a string search over app/scan-url/route.ts. A
 * source guard fails loudly when a control is DELETED, which is worth having,
 * but it cannot tell you what the route actually answers, and this repo has
 * twice shipped a guard that matched its own explanatory comment. So the rule
 * here is: drive the real exported POST handler, assert the status, the body
 * and the side effects (did the resolver get asked? did a socket get opened?),
 * and make every fixture prove it is non-vacuous before it proves anything else.
 *
 * Two specific failures this file is written against:
 *
 *   1. A canary that could not fire. tests/pro-scan-contract.test.ts:247 asserts
 *      the response carries no `wp-json|wp-content`, against a fixture whose
 *      page is `<html><head>…fbq…</head><body>hello</body></html>`. There is no
 *      WordPress marker in it, so the assertion passes on an empty room. The
 *      S16 block below re-runs it against a page that is nothing but WordPress
 *      markers, and asserts the fixture contains them first.
 *
 *   2. A probe sized too politely to show the consequence. The S28 block does
 *      not ask "does a 429 ever appear"; it fires 50 concurrent scans from one
 *      /24 and asserts the exact composition of the answers, including how many
 *      sockets were opened — which is the number the owner actually asked about.
 *
 * Nothing here opens a socket or resolves a name for real: globalThis.fetch and
 * the route's promisified dns.lookup are both replaced, and the replacements are
 * asserted to have been called (or asserted NOT to have been, which for an SSRF
 * guard is the whole point).
 *
 * What this file does NOT claim. It does not test Apache, systemd, ufw or the
 * per-UID egress policy in scripts/droplet-egress-lockdown.sh. The DNS-rebinding
 * TOCTOU between the route's dns.lookup and fetch()'s own resolution is real,
 * known, documented in API-ON-DROPLET.md and pinned by
 * scripts/security/checks/iast-scan-url-outbound.mjs; it is closed at the kernel,
 * not here, and no test in this file can or does speak to it.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import dns from 'node:dns';
import { promisify } from 'node:util';
import { NextRequest } from 'next/server';
import { isPublicUnicastAddress } from '../lib/net-address';

const HOST = 'api.incognitobrowser.io';
/** The Pro pages' origin — same value as tests/pro-scan-contract.test.ts. */
const PRO_ORIGIN = 'https://206-189-186-34.nip.io';
/** example.com. A public unicast address the allowlist permits. */
const PUBLIC_ADDR = '93.184.216.34';
/** This droplet, the default sole member of BLOCKED_TARGET_HOSTS. */
const OWN_ADDR = '206.189.186.34';

type Answer = Array<{ address: string; family: number }>;

let fetchCalls: string[] = [];
let dnsCalls: string[] = [];
let resolver: (hostname: string) => Promise<Answer>;
let respond: (url: string, init?: RequestInit) => Response | Promise<Response>;

/**
 * The stand-in resolver. An address literal resolves to itself — which is what
 * a real resolver does with one, and it matters: it means a test that removes
 * the text guard still sees the address leg judge the same address, so a test
 * claiming to exercise the TEXT guard has to say so by asserting the resolver
 * was never asked, not by asserting the refusal.
 */
const defaultResolver = async (hostname: string): Promise<Answer> => {
  const bare = hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(bare)) return [{ address: bare, family: 4 }];
  if (bare.includes(':')) return [{ address: bare, family: 6 }];
  return [{ address: PUBLIC_ADDR, family: 4 }];
};

/** Tuning knobs this file sets per test. lib/tuning.ts reads them at module load. */
const TUNING_KEYS = [
  'FETCH_TIMEOUT_MS',
  'MAX_BODY_SIZE_MB',
  'BLOCKED_TARGET_HOSTS',
  'SCAN_RATE_LIMIT',
  'MAX_IN_FLIGHT_SCANS',
  'MAX_IN_FLIGHT_PER_BUCKET',
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  process.env.ALTCHA_HMAC_KEY = 'audit-2a-scan-test-key-at-least-32-characters-long';
  for (const k of TUNING_KEYS) savedEnv[k] = process.env[k];
  // The route promisifies node:dns's lookup at module load; util.promisify
  // honours promisify.custom on the function object, so this captures the
  // route's resolver however many times the module is re-imported.
  (dns.lookup as unknown as Record<symbol, unknown>)[promisify.custom] = async (hostname: string) => {
    dnsCalls.push(hostname);
    return resolver(hostname);
  };
});

afterAll(() => {
  delete (dns.lookup as unknown as Record<symbol, unknown>)[promisify.custom];
});

beforeEach(() => {
  vi.resetModules();
  fetchCalls = [];
  dnsCalls = [];
  resolver = defaultResolver;
  respond = () => plainResponse();
  delete process.env.REDIS_URL;
  process.env.ALLOWED_ORIGINS = PRO_ORIGIN;
  for (const k of TUNING_KEYS) delete process.env[k];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    fetchCalls.push(String(url));
    return respond(String(url), init);
  }) as typeof fetch;
});

afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
  for (const k of TUNING_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k] as string;
  }
});

/**
 * Load a fresh route module, so whatever tuning env the test just set is the
 * tuning the route runs with. Call it ONCE per test: two calls make two
 * modules, and the in-flight counters live in module scope.
 */
async function loadRoute() {
  vi.resetModules();
  const origin = await import('@/lib/origin');
  origin._resetOriginCacheForTests();
  return import('@/app/scan-url/route');
}

/** Mint and solve a real proof-of-work. maxnumber 1 makes the search trivial. */
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

function scanRequest(url: string, authorization: string, ip = '203.0.113.9'): NextRequest {
  return new NextRequest(`https://${HOST}/scan-url`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: HOST,
      origin: PRO_ORIGIN,
      'x-forwarded-for': ip,
      authorization,
    },
    body: JSON.stringify({ url }),
  });
}

function plainResponse(html = '<html><body>hello</body></html>', headers: Record<string, string> = {}): Response {
  return new Response(html, { status: 200, headers: { 'content-type': 'text/html', ...headers } });
}

/** Poll until `cond` holds. Returns whether it did, rather than throwing, so a
 *  test that fails this way still gets to release its blocked fetches. */
async function waitUntil(cond: () => boolean, ms = 3000): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (cond()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return cond();
}

// ---------------------------------------------------------------------------
// S6 — "Reject non-http(s) schemes"
// ---------------------------------------------------------------------------

/**
 * The audit recorded this claim as CONTRADICTED: `new URL(url.startsWith('http')
 * ? url : \`https://${url}\`)` renames a foreign scheme into a single-label
 * HOSTNAME rather than rejecting it, so file:///etc/passwd became
 * https://file:///etc/passwd, hostname "file", and "file" went to the resolver.
 * On a host with a DNS search suffix — which is what a corporate host is —
 * "file" resolves to file.<corp-suffix>, an internal machine.
 *
 * The route has since been fixed (the scheme is matched and rejected BEFORE the
 * convenience rewrite), and tests/hardening.test.ts:62-80 pins that fix by
 * comparing string offsets in the source. What was missing is anyone asking the
 * route what it answers. These tests do, and they assert the consequence the
 * finding was actually about: the resolver is never asked for "file".
 */
describe('S6 — a foreign scheme is refused, not renamed into a hostname', () => {
  it('refuses file:, gopher:, dict:, ftp:, javascript: and data: without resolving anything', async () => {
    const auth = await powHeader();
    const { POST } = await loadRoute();

    const cases: Array<[string, string]> = [
      ['file:///etc/passwd', 'the case in the finding — used to become hostname "file"'],
      ['gopher://x/1', 'gopher is an SSRF classic because it can speak other protocols'],
      ['dict://x:11211/', 'dict reaches memcached'],
      ['ftp://internal.corp.example/', 'ftp'],
      ['javascript:alert(1)', 'not a network scheme at all'],
      ['data:text/html,<script>alert(1)</script>', 'same'],
      ['httpfoo://example.com/', 'startsWith("http") matched this, which is how the old test passed'],
      ['FILE:///etc/passwd', 'the scheme match is case-insensitive on both sides'],
    ];

    for (const [url, why] of cases) {
      fetchCalls = [];
      dnsCalls = [];
      const res = await POST(scanRequest(url, auth));
      const body = await res.json();
      expect(res.status, `${url} (${why}) was not refused`).toBe(400);
      expect(body.error, `${url} was refused for the wrong reason — it reached a later guard`)
        .toMatch(/Only HTTP\/HTTPS URLs are supported/);
      // The consequence, not the status code. A single-label hostname reaching
      // dns.lookup is the entire finding.
      expect(dnsCalls, `${url} was sent to the resolver as ${JSON.stringify(dnsCalls)}`).toEqual([]);
      expect(fetchCalls, `${url} opened an outbound request`).toEqual([]);
    }
  });

  it('still accepts a bare hostname, which is why the rewrite exists at all', async () => {
    // Without this control the block above would pass if the route refused
    // everything, and a scanner that refuses everything is not a scanner.
    const auth = await powHeader();
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('example.com', auth));

    expect(res.status, 'a typed bare hostname no longer scans').toBe(200);
    expect(dnsCalls).toEqual(['example.com']);
    expect(fetchCalls).toEqual(['https://example.com/']);
  });
});

// ---------------------------------------------------------------------------
// S7 — "Reject decimal-encoded IPs"
// ---------------------------------------------------------------------------

/**
 * The property holds, but nothing offline ever asserted it: the only executable
 * assertions about these spellings are in scripts/security/checks/
 * pro-scan-url-contract.mjs, which fires them at the LIVE API, and
 * tests/ssrf-resolve.test.ts:28, which asserts the opposite — that the text
 * guard PASSES them.
 *
 * It is worth being precise about what does the work here, because the finding
 * was not: the guard's own parsing never sees "2130706433". WHATWG URL parsing
 * normalises the decimal, hex and short forms to 127.0.0.1 before
 * isBlockedHostname is asked anything. That is why each case asserts the
 * normalisation it depends on, and asserts the resolver was never reached.
 */
describe('S7 — decimal, hex and short-form spellings of a private address', () => {
  it('refuses every spelling of 127.0.0.1 before the resolver is asked', async () => {
    const auth = await powHeader();
    const { POST } = await loadRoute();

    const cases: Array<[string, string]> = [
      ['http://2130706433/', 'decimal'],
      ['http://0x7f000001/', 'hex, whole address'],
      ['http://0x7f.0.0.1/', 'hex octet'],
      ['http://017700000001/', 'octal'],
      ['http://127.0.1/', 'short form — three parts, not four'],
    ];

    for (const [url, label] of cases) {
      fetchCalls = [];
      dnsCalls = [];
      // The mechanism, pinned: this is URL normalisation, not the guard.
      expect(new URL(url).hostname, `${label}: URL parsing no longer normalises this`).toBe('127.0.0.1');

      const res = await POST(scanRequest(url, auth));
      const body = await res.json();
      expect(res.status, `${url} (${label}) was not refused`).toBe(400);
      expect(body.error).toMatch(/Cannot scan private IP addresses/);
      expect(dnsCalls, `${url} (${label}) reached the resolver — the text guard did not fire`).toEqual([]);
      expect(fetchCalls, `${url} (${label}) opened an outbound request`).toEqual([]);
    }
  });

  it('refuses an IPv4-mapped loopback that only the ADDRESS allowlist can catch', async () => {
    // `https://[::ffff:127.0.0.1]/` is loopback, and isBlockedHostname says
    // allowed — route.ts's own comment records that the control which stopped
    // it was a bracket, i.e. that dns.lookup happened to fail on the bracketed
    // string. Here the resolver answers, so the only thing left standing is
    // isPublicUnicastAddress on the resolved address.
    const auth = await powHeader();
    resolver = async () => [{ address: '::ffff:127.0.0.1', family: 6 }];
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://mapped.example/', auth));
    const body = await res.json();

    expect(isPublicUnicastAddress('::ffff:127.0.0.1'), 'the allowlist stopped refusing mapped loopback').toBe(false);
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Cannot scan private IP addresses/);
    expect(dnsCalls, 'the resolve leg never ran, so this refusal proves nothing about it').toEqual(['mapped.example']);
    expect(fetchCalls, 'an outbound request was made to a name answering IPv4-mapped loopback').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S11 — "Cap time"
// ---------------------------------------------------------------------------

/**
 * tests/hardening.test.ts:39-51 asserts that clearTimeout sits after
 * readCappedText by comparing indexOf offsets in the file. Nothing anywhere
 * watched the deadline fire.
 *
 * The slow-BODY case is the one that matters and the one route.ts:396-402 says
 * the byte cap cannot catch: a target that answers its headers instantly and
 * then dribbles forever holds a scan slot, a socket and an Apache worker, and
 * the cap never fires because the bytes never arrive. To exercise it the stub
 * has to do what undici does — error the body stream when the signal aborts —
 * because the route's half of that contract is "keep the timer armed across the
 * read", and that is the half under test.
 */
describe('S11 — the fetch deadline fires, and it covers the body as well as the headers', () => {
  it('aborts a target that never answers, and says how long it waited', async () => {
    process.env.FETCH_TIMEOUT_MS = '600';
    const auth = await powHeader();
    respond = (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
        expect(signal, 'the outbound fetch was issued with no AbortSignal at all').toBeTruthy();
        signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
        );
      });
    const { POST } = await loadRoute();

    const started = Date.now();
    const res = await POST(scanRequest('https://slow-headers.example/', auth));
    const elapsed = Date.now() - started;
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/Request timed out \(1s\)/);
    expect(elapsed, 'the handler returned before the deadline could have fired').toBeGreaterThanOrEqual(500);
    expect(elapsed, 'the handler took far longer than the deadline it reports').toBeLessThan(5000);
  }, 15_000);

  it('cuts off a target that sends headers instantly and then stops sending body', async () => {
    process.env.FETCH_TIMEOUT_MS = '600';
    const auth = await powHeader();
    let abortedDuringBody = false;
    respond = (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal as AbortSignal | undefined;
      const enc = new TextEncoder();
      let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
      let sentFirst = false;
      const stream = new ReadableStream<Uint8Array>({
        start(c) { ctrl = c; },
        pull(c) {
          if (!sentFirst) { sentFirst = true; c.enqueue(enc.encode('<html><body>')); return; }
          // The rest of the page never comes. This read never settles.
          return new Promise<void>(() => {});
        },
        cancel() { /* an errored stream is never cancelled — see the assertion below */ },
      });
      signal?.addEventListener('abort', () => {
        // The fixture records that the abort arrived AFTER the headers were
        // handed over, i.e. while readCappedText was reading. What undici does
        // to a body stream when the fetch signal aborts.
        abortedDuringBody = true;
        try { ctrl?.error(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })); } catch { /* already errored */ }
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/html' } });
    };
    const { POST } = await loadRoute();

    const started = Date.now();
    const res = await POST(scanRequest('https://slow-body.example/', auth));
    const elapsed = Date.now() - started;
    const body = await res.json();

    expect(fetchCalls, 'the fixture never got as far as the fetch').toEqual(['https://slow-body.example/']);
    expect(res.status).toBe(502);
    // The distinct message matters: it is the only way to tell "headers never
    // came" from "the page never finished", and only the second one proves the
    // timer was still armed during readCappedText.
    expect(body.error).toMatch(/started responding but never finished sending the page/);
    expect(elapsed, 'the read was cut off before the deadline — by something else').toBeGreaterThanOrEqual(500);
    // The assertion this test exists for. The headers were already delivered
    // when the abort arrived, so the timer was still armed during the body
    // read. If clearTimeout ever moves back to the moment the headers land,
    // this never becomes true and the test hangs until its own timeout.
    expect(abortedDuringBody, 'the deadline never fired while the body was being read').toBe(true);
  }, 8_000);

  it('does not fire on a target that answers in time', async () => {
    // The control. Without it, a route that 502'd unconditionally would pass
    // both tests above.
    process.env.FETCH_TIMEOUT_MS = '600';
    const auth = await powHeader();
    respond = async () => { await new Promise((r) => setTimeout(r, 20)); return plainResponse(); };
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://fast.example/', auth));
    expect(res.status).toBe(200);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// S12 — "Cap body size"
// ---------------------------------------------------------------------------

/**
 * `grep -rn readCappedText` over the repo shows it is never invoked from a
 * test. tests/resource-bounds.test.ts:34-37 is titled "readCappedText cancels
 * the stream once the cap is hit" and its whole body is a substring match for
 * `reader.cancel()` in a concatenation of two source files — it would pass if
 * that call sat in an unreachable branch, or in a comment.
 *
 * So: feed the real function a stream bigger than the cap, and separately feed
 * the real ROUTE a page bigger than the cap, and look at what comes back.
 */
describe('S12 — readCappedText stops reading at the cap and drops the rest', () => {
  function countingStream(chunks: string[], seen: { pulls: number; cancelled: boolean }): ReadableStream<Uint8Array> {
    const enc = new TextEncoder();
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(c) {
        seen.pulls++;
        if (i >= chunks.length) { c.close(); return; }
        c.enqueue(enc.encode(chunks[i++]));
      },
      cancel() { seen.cancelled = true; },
    });
  }

  it('truncates at maxBytes, cancels the stream, and stops pulling', async () => {
    const { readCappedText } = await import('@/lib/scanner');
    const seen = { pulls: 0, cancelled: false };
    const CHUNK = 64 * 1024;
    const CAP = 100_000;
    // 16 chunks of 64KB = 1MB against a 100KB cap. The marker sits in the last
    // chunk, so if it comes back, the cap did nothing.
    const chunks = Array.from({ length: 16 }, (_, i) => (i === 15 ? 'TAIL_MARKER_5f2a'.padEnd(CHUNK, 'z') : 'a'.repeat(CHUNK)));
    const res = new Response(countingStream(chunks, seen), { status: 200 });

    const text = await readCappedText(res, CAP);

    expect(text.length, 'the body was not truncated at the cap').toBe(CAP);
    expect(text).not.toContain('TAIL_MARKER_5f2a');
    expect(seen.cancelled, 'reader.cancel() never reached the underlying source').toBe(true);
    // 100_000 / 65_536 = 2 chunks, so at most three pulls including the one
    // that delivered the chunk which crossed the cap.
    expect(seen.pulls, `the reader kept pulling past the cap (${seen.pulls} pulls)`).toBeLessThanOrEqual(3);
  });

  it('returns the whole body when it fits — the cap is a cap, not a truncation', async () => {
    const { readCappedText } = await import('@/lib/scanner');
    const seen = { pulls: 0, cancelled: false };
    const res = new Response(countingStream(['<html>', 'small', '</html>'], seen), { status: 200 });
    const text = await readCappedText(res, 100_000);
    expect(text).toBe('<html>small</html>');
    expect(seen.cancelled, 'a body that fits should be read to completion, not cancelled').toBe(false);
  });

  it('the route analyses only the capped prefix of a huge page', async () => {
    // MAX_BODY_SIZE_MB=1, and a page whose inline Facebook pixel sits past the
    // 1MB mark. If the cap binds, the scanner cannot see it.
    process.env.MAX_BODY_SIZE_MB = '1';
    const auth = await powHeader();
    const seen = { pulls: 0, cancelled: false };
    respond = () =>
      new Response(
        countingStream(['<html><body>' + 'x'.repeat(1_200_000), `<script>fbq('init','111')</script>`], seen),
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://huge.example/', auth));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.inlineTrackers, 'content past the 1MB cap was analysed').toEqual([]);
    expect(seen.cancelled, 'the oversized body stream was not cancelled by the route').toBe(true);
  }, 15_000);

  it('...and sees the same pixel when it sits inside the cap', async () => {
    // The pair that makes the previous test mean something: identical fixture,
    // marker moved before the cap.
    process.env.MAX_BODY_SIZE_MB = '1';
    const auth = await powHeader();
    const seen = { pulls: 0, cancelled: false };
    respond = () =>
      new Response(
        countingStream([`<html><body><script>fbq('init','111')</script>` + 'x'.repeat(1_200_000), '</body></html>'], seen),
        { status: 200, headers: { 'content-type': 'text/html' } },
      );
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://huge.example/', auth));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.inlineTrackers, 'the fixture pixel was not detected even inside the cap').toContain('Facebook Pixel (inline)');
  }, 15_000);
});

// ---------------------------------------------------------------------------
// S13 — the response shape, all the way down
// ---------------------------------------------------------------------------

/**
 * The TOP level is genuinely locked, in three places. Nothing locks anything
 * below it: the interface parser in pro-scan-url-contract.mjs matches
 * `^ {2}(\w+)\??:` so it never sees a nested key, and no test asserts that
 * `security` has exactly four fields, that `summary` has exactly seven, or what
 * a cookie element may carry.
 *
 * A note on the finding's arithmetic, since being precise about it is the point:
 * it says the locked set has "NINE keys, not eight". It has eight — url, status,
 * cookies, trackers, inlineTrackers, thirdPartyDomains, security, summary. The
 * substance is right though: `inlineTrackers` is in the response and is not in
 * the owner's list of what the response may contain.
 */
describe('S13 — the nested shape of a scan result is locked too', () => {
  const TOP = ['url', 'status', 'cookies', 'trackers', 'inlineTrackers', 'thirdPartyDomains', 'security', 'summary'];
  const SECURITY = ['hasCSP', 'hasHSTS', 'hasPermPolicy', 'isHTTPS'];
  const SUMMARY = ['analyticsCookies', 'functionalCookies', 'highRiskItems', 'thirdPartyScripts', 'totalCookies', 'totalTrackers', 'trackingCookies'];
  const COOKIE = ['category', 'cookieName', 'description', 'domain', 'expires', 'httpOnly', 'maxAge', 'name', 'path', 'raw', 'risk', 'sameSite', 'secure'];

  function cookieResponse(): Response {
    const headers = new Headers({ 'content-type': 'text/html' });
    headers.append('set-cookie', '_ga=GA1.2.987654321.1700000000; Domain=.tracked.example; Path=/; Max-Age=63072000');
    headers.append('set-cookie', 'sid=abc; Secure; HttpOnly; SameSite=Strict');
    return new Response(`<html><head><script src="https://cdn.other.example/t.js"></script></head><body>x</body></html>`, { status: 200, headers });
  }

  it('locks security, summary and every cookie element, through the real route', async () => {
    const auth = await powHeader();
    respond = () => cookieResponse();
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://tracked.example/', auth));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual([...TOP].sort());
    expect(Object.keys(body.security).sort(), 'the security block grew or lost a field').toEqual(SECURITY);
    expect(Object.keys(body.summary).sort(), 'the summary block grew or lost a field').toEqual(SUMMARY);

    expect(body.cookies.length, 'the fixture cookies were dropped — this test would be vacuous').toBe(2);
    for (const c of body.cookies) {
      expect(Object.keys(c).sort(), `cookie ${c.cookieName} does not have the locked element shape`).toEqual(COOKIE);
    }
    // thirdPartyDomains is a flat list of hostnames, not objects.
    for (const d of body.thirdPartyDomains) expect(typeof d).toBe('string');
    for (const t of body.inlineTrackers) expect(typeof t).toBe('string');
  });

  it('caps the raw Set-Cookie line it echoes back', async () => {
    // `raw` carries the target's Set-Cookie line INCLUDING its value, which is
    // the one field of the element shape that is not a label of our own making.
    // The bound on it is therefore part of the contract, not a detail.
    const auth = await powHeader();
    const huge = `bloat=${'v'.repeat(5000)}; Path=/`;
    respond = () => {
      const headers = new Headers({ 'content-type': 'text/html' });
      headers.append('set-cookie', huge);
      return new Response('<html></html>', { status: 200, headers });
    };
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://bloat.example/', auth));
    const body = await res.json();

    expect(body.cookies).toHaveLength(1);
    expect(body.cookies[0].raw.length, 'a 5KB Set-Cookie line came back whole').toBe(203);
    expect(body.cookies[0].raw.endsWith('...')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// S16 — "No WordPress JSON in the response"
// ---------------------------------------------------------------------------

/**
 * The existing vitest assertion for this cannot fail: it greps the response for
 * `wp-json|wp-content` after scanning a fixture that contains neither string.
 * That is precisely the failure this repo has already paid for once — an
 * assertion whose fixture cannot produce the thing being asserted about.
 *
 * Two separate properties are involved and the old test conflated them:
 *   (a) the response never echoes the FETCHED PAGE, whatever is in it;
 *   (b) our own co-hosted WordPress is not reachable as a scan target at all,
 *       which is BLOCKED_TARGET_HOSTS' job, not the response shape's.
 */
describe('S16 — the scanned page never comes back, and our own WordPress is not a target', () => {
  const WP_MARKERS = /wp-json|wp-content/i;

  it('a page that is nothing but WordPress markers produces a response with none of them', async () => {
    const auth = await powHeader();
    const wpPage = [
      '<html><head>',
      '<link rel="https://api.w.org/" href="https://wp.example/wp-json/" />',
      '<link rel="stylesheet" href="https://wp.example/wp-content/themes/twentytwentyfour/style.css" />',
      '<script src="https://wp.example/wp-content/plugins/contact-form-7/index.js"></script>',
      '</head><body><!-- wp-content wp-json wp-content --></body></html>',
    ].join('');
    // Non-vacuity first: the old canary failed exactly here.
    expect(wpPage, 'the fixture has no WordPress markers, so this test proves nothing').toMatch(WP_MARKERS);
    expect(wpPage.match(/wp-content/gi) ?? [], 'the fixture is too thin to be a WordPress page').toHaveLength(4);
    expect(wpPage.match(/wp-json/gi) ?? []).toHaveLength(2);

    respond = () => {
      const headers = new Headers({ 'content-type': 'text/html' });
      headers.append('set-cookie', 'wordpress_test_cookie=WP+Cookie+check; Path=/');
      return new Response(wpPage, { status: 200, headers });
    };
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://wp.example/', auth));
    const raw = JSON.stringify(await res.json());

    expect(res.status).toBe(200);
    expect(raw, 'the response carries content from the fetched page').not.toMatch(WP_MARKERS);
    // The cookie NAME is the scanned site's and is supposed to come back; this
    // is here so the assertion above is understood as "no page content", not
    // "no mention of WordPress".
    expect(raw).toContain('wordpress_test_cookie');
  });

  it('refuses this droplet by name, without asking the resolver', async () => {
    const auth = await powHeader();
    const { POST } = await loadRoute();
    const res = await POST(scanRequest(`https://${OWN_ADDR}/`, auth));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Cannot scan private IP addresses/);
    expect(dnsCalls, 'the text leg did not fire').toEqual([]);
    expect(fetchCalls, 'the scanner scanned the box it runs on').toEqual([]);
  });

  it('refuses a public NAME that resolves to this droplet — the only guard left is BLOCKED_TARGET_HOSTS', async () => {
    // This is the case the private-range allowlist cannot catch, and it is how
    // the co-hosted WordPress would actually be reached: a name we do not own,
    // pointing at our own public address. isPublicUnicastAddress ALLOWS that
    // address, as it must.
    const auth = await powHeader();
    resolver = async () => [{ address: OWN_ADDR, family: 4 }];
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://points-at-us.example/', auth));
    const body = await res.json();

    expect(isPublicUnicastAddress(OWN_ADDR), 'our own address is public unicast — that is the premise').toBe(true);
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/Cannot scan private IP addresses/);
    expect(dnsCalls, 'the resolve leg never ran').toEqual(['points-at-us.example']);
    expect(fetchCalls, 'the scanner fetched its own droplet via a third-party name').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// S19 — "429 after 10 requests"
// ---------------------------------------------------------------------------

/**
 * The only route-level evidence was scripts/security-smoke.mjs:186-191 — twelve
 * rapid POSTs asserting `s429 >= 1`. That passes if the limit is 1, or 9, or if
 * an earlier section of the smoke had already spent part of the bucket. The
 * boundary is the claim, so the boundary is what gets asserted: request 10 is
 * served, request 11 is the first refusal.
 */
describe('S19 — the tenth scan is served and the eleventh is refused', () => {
  it('drives the real handler eleven times and finds the boundary exactly where the claim puts it', async () => {
    const auth = await powHeader();
    const { POST } = await loadRoute();
    const ip = '198.51.100.7';

    const statuses: number[] = [];
    const remaining: Array<string | null> = [];
    for (let i = 0; i < 11; i++) {
      const res = await POST(scanRequest('https://example.com/', auth, ip));
      statuses.push(res.status);
      remaining.push(res.headers.get('X-RateLimit-Remaining'));
      if (res.status !== 429) await res.json();
    }

    expect(statuses.slice(0, 10), `the first ten scans were not all served: ${statuses.join(',')}`)
      .toEqual(Array(10).fill(200));
    expect(statuses[10], 'the eleventh scan was not refused').toBe(429);
    expect(remaining[9], 'the tenth response did not report the bucket as spent').toBe('0');

    // And the refusal carries what a client needs to back off with.
    const last = await POST(scanRequest('https://example.com/', auth, ip));
    expect(last.status).toBe(429);
    expect(last.headers.get('X-RateLimit-Limit')).toBe('10');
    expect(Number(last.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await last.json()).error).toMatch(/Too many requests/);

    // Ten scans, ten sockets — the refusals cost nothing outbound.
    expect(fetchCalls, `${fetchCalls.length} outbound requests for ten served scans`).toHaveLength(10);
  }, 15_000);
});

// ---------------------------------------------------------------------------
// S22 — "https://example.com returns 200 with HTTPS flags true"
// ---------------------------------------------------------------------------

/**
 * The 200 half is asserted live and in e2e. The FLAGS half was asserted
 * nowhere: `grep -rn 'isHTTPS|hasHSTS|hasCSP|hasPermPolicy' tests/ scripts/
 * e2e/` finds only fixtures for the grading functions and a stubbed e2e body.
 * The Pro result panel renders these four as the visitor-facing verdict.
 */
describe('S22 — the security flags come from the response that was really fetched', () => {
  it('reports all four true for an https target that sends the three headers', async () => {
    const auth = await powHeader();
    respond = () =>
      plainResponse('<html><body>secure</body></html>', {
        'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
        'content-security-policy': "default-src 'self'",
        'permissions-policy': 'geolocation=(), camera=()',
      });
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://example.com/', auth));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.security).toEqual({ isHTTPS: true, hasHSTS: true, hasCSP: true, hasPermPolicy: true });
    expect(fetchCalls, 'the flags came from somewhere other than a fetched response').toEqual(['https://example.com/']);
  });

  it('reports all four false for a plain-http target that sends none of them', async () => {
    // The pair. Without it, `security: {isHTTPS: true, ...}` hard-coded in the
    // scanner would pass the test above.
    const auth = await powHeader();
    respond = () => plainResponse();
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('http://plain.example/', auth));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.security).toEqual({ isHTTPS: false, hasHSTS: false, hasCSP: false, hasPermPolicy: false });
  });
});

// ---------------------------------------------------------------------------
// S27 — "A company intranet hostname is denied once the box sits on the corp net"
// ---------------------------------------------------------------------------

/**
 * `grep -rni 'intranet|corp net|corporate network'` over tests/, e2e/ and
 * scripts/security/checks/ returns one prose paragraph and nothing executable.
 *
 * The case that matters is NOT a corp host in RFC 1918 space — the address
 * allowlist covers that, iast-probe drives it every commit, and on the droplet
 * the kernel now refuses those packets outright. It is a corp host on a
 * PUBLICLY ROUTABLE address, which lib/net-address.ts:22-27 says plainly it
 * allows and must. The only mechanism that can deny it is BLOCKED_TARGET_HOSTS,
 * and until now no test had ever set that knob to anything.
 */
describe('S27 — a corporate target on public address space', () => {
  const CORP_ADDR = '20.30.40.50';      // public unicast, pretend it is corp
  const NEIGHBOUR = '20.30.40.51';      // the machine next to it, not listed
  const CORP_RANGE = '20.30.40.0/24';   // the estate both of them sit in
  const OUTSIDE = '20.30.41.1';         // one address past the estate's edge

  it('BLOCKED_TARGET_HOSTS denies a corp NAME and a corp ADDRESS the allowlist would pass', async () => {
    process.env.BLOCKED_TARGET_HOSTS = `intranet.corp.example,${CORP_ADDR}`;
    const auth = await powHeader();
    const { POST } = await loadRoute();

    // The premise: nothing else in the stack objects to this address.
    expect(isPublicUnicastAddress(CORP_ADDR), 'the address allowlist would refuse this on its own').toBe(true);

    // (a) by name, before the resolver is asked
    const byName = await POST(scanRequest('https://intranet.corp.example/', auth));
    expect(byName.status, 'a configured corp hostname was not refused').toBe(400);
    expect((await byName.json()).error).toMatch(/Cannot scan private IP addresses/);
    expect(dnsCalls).toEqual([]);
    expect(fetchCalls).toEqual([]);

    // (b) by resolved address, for a name the operator never listed — this is
    // the split-horizon / vanity-DNS case, and the address leg is what catches it
    dnsCalls = [];
    resolver = async () => [{ address: CORP_ADDR, family: 4 }];
    const byAddress = await POST(scanRequest('https://wiki.example/', auth));
    expect(byAddress.status, 'a name resolving to a configured corp address was not refused').toBe(400);
    expect(dnsCalls, 'the resolve leg never ran').toEqual(['wiki.example']);
    expect(fetchCalls, 'an outbound request reached the corp address').toEqual([]);
  }, 15_000);

  it('a bare address is still exact: the machine next to it is fetched', async () => {
    // Kept from the pre-CIDR version of this file, where it was the
    // characterisation "the knob is exact-match, which a deployment has to
    // know". It is still true of the LITERAL form and still worth knowing —
    // an operator who lists one host has listed one host. What changed is the
    // next test: there is now a way to say the range.
    process.env.BLOCKED_TARGET_HOSTS = CORP_ADDR;
    const auth = await powHeader();
    resolver = async () => [{ address: NEIGHBOUR, family: 4 }];
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('https://wiki.example/', auth));

    expect(res.status).toBe(200);
    expect(fetchCalls).toEqual(['https://wiki.example/']);
  }, 15_000);

  it('given the RANGE, the machine next to it is refused too — on both legs — and the one past the edge is not', async () => {
    // Until 2026-09-22 this test asserted the opposite, with the message "if
    // this is now 400, CIDR support landed — update this test and the
    // finding". BLOCKED_TARGET_HOSTS was an exact-match Set, a corp estate is
    // a range, and there was no way to say so: 20.30.40.50 refused,
    // 20.30.40.51 fetched, both public unicast. Now the knob takes a CIDR and
    // lib/net-address.ts judges it at both legs of this route. The control
    // at the end is what keeps this from passing on a compile error that
    // refuses everything.
    process.env.BLOCKED_TARGET_HOSTS = CORP_RANGE;
    const auth = await powHeader();
    const { POST } = await loadRoute();
    for (const ip of [NEIGHBOUR, OUTSIDE]) {
      expect(isPublicUnicastAddress(ip), `${ip}: the address allowlist would refuse this on its own`).toBe(true);
    }

    // (a) the address leg: a name the operator never listed, resolving to
    // the machine beside the one the audit found fetched.
    resolver = async () => [{ address: NEIGHBOUR, family: 4 }];
    const byAddress = await POST(scanRequest('https://wiki.example/', auth));
    expect(byAddress.status, 'a name resolving INTO the configured corp range was not refused').toBe(400);
    expect((await byAddress.json()).error).toMatch(/Cannot scan private IP addresses/);
    expect(dnsCalls, 'the resolve leg never ran').toEqual(['wiki.example']);
    expect(fetchCalls, 'an outbound request reached a machine the range covers').toEqual([]);

    // (b) the text leg: the same machine typed as a literal, refused before
    // the resolver is asked — a literal inside a range is judged as text.
    dnsCalls = [];
    const byText = await POST(scanRequest(`https://${NEIGHBOUR}/`, auth));
    expect(byText.status, 'an address literal inside the configured range was not refused').toBe(400);
    expect(dnsCalls, 'the text leg did not judge the literal against the range').toEqual([]);
    expect(fetchCalls).toEqual([]);

    // (c) the control: one address past the /24's edge is a scan target.
    resolver = async () => [{ address: OUTSIDE, family: 4 }];
    const outside = await POST(scanRequest('https://public.example/', auth));
    expect(outside.status, 'the range refused an address it does not contain').toBe(200);
    expect(fetchCalls).toEqual(['https://public.example/']);
  }, 15_000);

  it('a malformed range is dropped loudly and on its own; the entry beside it still holds', async () => {
    // What a typo does is silent by nature — nothing in the request path can
    // tell an operator their /33 was thrown away — so the throw-away is
    // announced when the route module loads, and the valid entry next to it
    // keeps working. The bad entry must not be read as a hostname either:
    // that would look configured and match nothing.
    process.env.BLOCKED_TARGET_HOSTS = `20.30.40.0/33,${CORP_ADDR}`;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const auth = await powHeader();
      const { POST } = await loadRoute();
      const said = warn.mock.calls.map((c) => String(c[0])).filter((m) => m.includes('"20.30.40.0/33"'));
      expect(said, 'the malformed entry was dropped without a word').toHaveLength(1);
      expect(said[0]).toMatch(/BLOCKED_TARGET_HOSTS/);

      resolver = async () => [{ address: CORP_ADDR, family: 4 }];
      const listed = await POST(scanRequest('https://wiki.example/', auth));
      expect(listed.status, 'the valid entry beside the typo stopped working').toBe(400);
      expect(fetchCalls).toEqual([]);

      resolver = async () => [{ address: NEIGHBOUR, family: 4 }];
      const beside = await POST(scanRequest('https://wiki2.example/', auth));
      expect(beside.status, 'the malformed /33 was read as a range after all').toBe(200);
      expect(fetchCalls).toEqual(['https://wiki2.example/']);
    } finally {
      warn.mockRestore();
    }
  }, 15_000);

  it('a single-label hostname still reaches the resolver, which is where a search suffix bites', async () => {
    // The other half of S6's mechanism, and the reason S27 is about corporate
    // hosts specifically: "intranet" is a legal thing to type, so it is
    // resolved. On a host with `search corp.example` it becomes
    // intranet.corp.example. Everything then depends on what that answers —
    // private space is refused (asserted here), public space is not (above).
    // Rewritten 2026-09-22 when the route started refusing single-label names
    // outright. The old version asserted the label WAS handed to the resolver
    // and only then refused on the private answer — which left the public
    // answer (intranet.corp.example on public space) fetchable. Now the name
    // never reaches dns.lookup at all, so the search suffix has nothing to bite.
    const auth = await powHeader();
    resolver = async () => { throw new Error('the resolver must not be consulted for a single-label name'); };
    const { POST } = await loadRoute();
    const res = await POST(scanRequest('intranet', auth));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/full website address/i);
    expect(dnsCalls, 'a single-label name reached the resolver').toEqual([]);
    expect(fetchCalls).toEqual([]);
    // A bracketed IPv6 literal has no dot either and must still be judged by
    // address, not refused as a label.
    resolver = async () => [{ address: '::1', family: 6 }];
    const v6 = await POST(scanRequest('https://[::1]/', await powHeader()));
    expect(v6.status).toBe(400);
    expect((await v6.json()).error).not.toMatch(/full website address/i);
  });
});

// ---------------------------------------------------------------------------
// S28 — "50 parallel scans of example.com from one IP"
// ---------------------------------------------------------------------------

/**
 * Nothing anywhere issued concurrent scans: `grep -rn 'Promise.all|
 * Promise.allSettled' tests/ scripts/security/ e2e/` finds three hits and none
 * of them is a scan. The nearest thing was twelve SEQUENTIAL POSTs.
 *
 * The item's own arithmetic was off, and the correction is the interesting part.
 * With SCAN_RATE_LIMIT=10 and MAX_IN_FLIGHT_PER_BUCKET=2, fifty parallel scans
 * from one /24 do not produce fifty outbound fetches and do not produce a
 * uniform 429. They produce TWO sockets, eight 503s and forty 429s. That is the
 * number the owner's question — "does it open 50 outbound fetches?" — was really
 * about, so it is asserted exactly rather than as an inequality.
 */
describe('S28 — fifty concurrent scans from one network', () => {
  /** A fetch that blocks until released, so "in flight" means in flight. */
  function blockingFetch() {
    const pending: Array<(r: Response) => void> = [];
    globalThis.fetch = (async (url: string | URL) => {
      fetchCalls.push(String(url));
      return new Promise<Response>((resolve) => pending.push(resolve));
    }) as typeof fetch;
    return {
      release() {
        for (const resolve of pending.splice(0)) resolve(plainResponse());
      },
    };
  }

  it('opens two sockets, refuses eight for the bucket and rate-limits the other forty', async () => {
    const auth = await powHeader();
    const { POST } = await loadRoute();
    const { MAX_IN_FLIGHT_PER_BUCKET, SCAN_RATE_LIMIT } = await import('@/lib/tuning');
    const gate = blockingFetch();

    let settled = 0;
    const statuses: number[] = new Array(50).fill(0);
    const errors: string[] = new Array(50).fill('');
    const flight = Array.from({ length: 50 }, (_, i) =>
      POST(scanRequest('https://example.com/', auth, '203.0.113.9')).then(async (res) => {
        statuses[i] = res.status;
        errors[i] = (await res.json()).error ?? '';
        settled++;
        return res;
      }),
    );

    // Everything except the two holding sockets should be done almost at once.
    const quiet = await waitUntil(() => settled === 48 && fetchCalls.length === MAX_IN_FLIGHT_PER_BUCKET);
    gate.release();
    await Promise.all(flight);

    expect(quiet, `48 refusals and ${MAX_IN_FLIGHT_PER_BUCKET} sockets expected; saw ${settled} settled and ${fetchCalls.length} sockets`).toBe(true);

    const count = (s: number) => statuses.filter((x) => x === s).length;
    expect(fetchCalls, `${fetchCalls.length} outbound requests from one /24 — the ceiling did not hold`)
      .toHaveLength(MAX_IN_FLIGHT_PER_BUCKET);
    expect(count(429), 'the rate limiter did not refuse the expected forty').toBe(50 - SCAN_RATE_LIMIT);
    expect(count(503), 'the per-bucket in-flight ceiling did not refuse the expected eight')
      .toBe(SCAN_RATE_LIMIT - MAX_IN_FLIGHT_PER_BUCKET);
    expect(count(200)).toBe(MAX_IN_FLIGHT_PER_BUCKET);
    expect(errors.filter((e) => /Too many scans running from your network/.test(e)))
      .toHaveLength(SCAN_RATE_LIMIT - MAX_IN_FLIGHT_PER_BUCKET);
  }, 20_000);

  it('the global ceiling holds when the callers are on twenty-five different networks', async () => {
    // One bucket cannot exceed two, so a flood spreads itself out. Twenty-five
    // distinct /24s each get their own rate-limit budget, and the only thing
    // left standing is MAX_IN_FLIGHT_SCANS.
    const auth = await powHeader();
    const { POST } = await loadRoute();
    const { MAX_IN_FLIGHT_SCANS } = await import('@/lib/tuning');
    const gate = blockingFetch();

    let settled = 0;
    const statuses: number[] = new Array(25).fill(0);
    const errors: string[] = new Array(25).fill('');
    const flight = Array.from({ length: 25 }, (_, i) =>
      POST(scanRequest('https://example.com/', auth, `172.20.${i}.9`)).then(async (res) => {
        statuses[i] = res.status;
        errors[i] = (await res.json()).error ?? '';
        settled++;
        return res;
      }),
    );

    const quiet = await waitUntil(() => settled === 25 - MAX_IN_FLIGHT_SCANS && fetchCalls.length === MAX_IN_FLIGHT_SCANS);
    gate.release();
    await Promise.all(flight);

    expect(quiet, `expected ${MAX_IN_FLIGHT_SCANS} sockets and ${25 - MAX_IN_FLIGHT_SCANS} refusals; saw ${fetchCalls.length} and ${settled}`).toBe(true);
    expect(fetchCalls, 'more scans ran at once than the global ceiling allows').toHaveLength(MAX_IN_FLIGHT_SCANS);
    expect(statuses.filter((s) => s === 503)).toHaveLength(25 - MAX_IN_FLIGHT_SCANS);
    expect(errors.filter((e) => /Too many scans running right now/.test(e))).toHaveLength(25 - MAX_IN_FLIGHT_SCANS);
  }, 20_000);

  it('releases the slot when a scan finishes, so the ceiling is a ceiling and not a fuse', async () => {
    // The release path at route.ts:422-429. If it leaked, the numbers above
    // would still pass and the service would degrade to permanently refusing
    // the busiest networks — a caller-sized denial of service built out of the
    // control that was supposed to prevent one.
    const auth = await powHeader();
    const { POST } = await loadRoute();
    const gate = blockingFetch();
    const ip = '192.0.2.44';

    const held = [POST(scanRequest('https://example.com/', auth, ip)), POST(scanRequest('https://example.com/', auth, ip))];
    expect(await waitUntil(() => fetchCalls.length === 2), 'the two slots never filled').toBe(true);

    const refused = await POST(scanRequest('https://example.com/', auth, ip));
    expect(refused.status, 'the third concurrent scan from this network was not refused').toBe(503);
    expect((await refused.json()).error).toMatch(/Too many scans running from your network/);

    gate.release();
    for (const res of await Promise.all(held)) expect(res.status).toBe(200);

    // Slots free again. Back to an ordinary fetch so this one can complete.
    globalThis.fetch = (async (url: string | URL) => { fetchCalls.push(String(url)); return plainResponse(); }) as typeof fetch;
    const after = await POST(scanRequest('https://example.com/', auth, ip));
    expect(after.status, 'the slots were never given back — the in-flight counter leaks').toBe(200);
  }, 20_000);
});
