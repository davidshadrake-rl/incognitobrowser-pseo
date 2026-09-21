/**
 * The three tools whose input must never leave the browser — proved against a
 * RUNNING page, not against the source.
 *
 * tests/pro-client-only.test.ts and scripts/security/checks/pro-client-only.mjs
 * already assert, from source, that the cookie scanner's Paste and This Page
 * modes and the metadata viewer contain no transport. That is a real property
 * and it is already covered; it is also not the property the owner cares about.
 * "The file contains no fetch(" and "the running page opened no connection"
 * are different claims, and a bundler, an analytics wrapper, a third-party
 * script, a service worker or an <img> the component never wrote can put the
 * second one on the wire while the first stays true. For a box that invites a
 * live `Cookie:` header copied out of DevTools — session tokens, usually for
 * some OTHER company's site — the gap between those two claims is the entire
 * point of the tool.
 *
 * So this file watches the wire. Every outbound request the page makes is
 * recorded at the BrowserContext level (which also catches service workers and
 * requests a page makes as it unloads) plus at page level, including WebSocket
 * handshakes and frames, AND at the call site inside the page, where
 * sendBeacon, fetch, XHR and WebSocket.send are wrapped and called through.
 * The in-page half is not decoration: Playwright reports a
 * `navigator.sendBeacon(url, new Blob([...]))` request with NO post data, and
 * that is exactly how this app's own analytics send /api/event
 * (lib/track.ts:64) — so the first version of this file was searching those
 * bodies as empty strings and would have missed a leak sent the same way.
 *
 * A distinctive sentinel is planted in the tool's input and then looked for in
 * every request's URL, query string, headers and body — raw, percent-encoded
 * and base64 — with the body read as bytes, so an image posted as binary is
 * found just as a JSON field would be.
 *
 * The four tests:
 *   1. Paste mode           — the strictest one: the sentinel is never a cookie
 *                             on this origin, so NOTHING may carry it anywhere.
 *   2. This Page mode       — document.cookie, plus the page's HttpOnly claim.
 *   3. Metadata viewer      — a real JPEG, sentinel inside the bytes AND in the
 *                             file name; no multipart request may exist at all.
 *   4. THE CONTROL          — the scanner's "Scan a URL" mode, which SHOULD
 *                             reach /api/scan-url. Without it, a watcher that
 *                             silently recorded nothing would make tests 1-3
 *                             pass while proving nothing at all. It exercises
 *                             all four fields the detector reads — URL, header,
 *                             request body and sendBeacon Blob body — and is
 *                             the most important test in the file.
 *
 * PRODUCTION SAFETY: exactly ONE real scan happens in this file, in test 4,
 * against https://example.com. Tests 1-3 must make no server call by design,
 * so they fabricate nothing and intercept nothing — intercepting would hide
 * the very requests this file exists to see.
 *
 * Run:
 *   E2E_BASE_URL=https://206-189-186-34.nip.io npx playwright test e2e/pro-client-only.spec.ts
 */

import { test, expect, type Page, type BrowserContext, type Locator, type Request as PwRequest } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TOOL_PATHS, PRO_ENGINES } from './helpers';

// ─────────────────────────────────────────────────────────────────────────
// Where the Pro tools live
// ─────────────────────────────────────────────────────────────────────────
//
// e2e/helpers.ts owns TOOL_PATHS, so the paths are read from there rather than
// retyped. Its toolUrl() is not used for these two engines: it joins the Pro
// base to the FREE '/resources' prefix, and the Pro pages are served from
// '/resources-pro' (scripts/deploy.sh:145, scripts/droplet-htaccess.conf:61).
// '/resources/tools/ad-tracking/cookie-tracker-scanner/' is a hard 404 on the
// live box — verified — and a 404 would make every assertion below vacuous,
// which is why the fixture's status is asserted on every navigation.
const RAW_BASE = (process.env.E2E_PRO_BASE_URL || process.env.E2E_BASE_URL || 'https://206-189-186-34.nip.io')
  .replace(/\/+$/, '')
  .replace(/\/resources(?:-pro)?$/, '');
const SERVER_MODE = /localhost|127\.0\.0\.1/.test(RAW_BASE);
const HTTPS = RAW_BASE.startsWith('https://');

function proToolUrl(engine: 'cookie-analyzer' | 'metadata-viewer'): string {
  // Both are Pro engines; if that ever stops being true the URL below is wrong.
  expect(PRO_ENGINES.has(engine), `${engine} is expected to be a Pro engine`).toBe(true);
  const bare = TOOL_PATHS[engine].replace(/^\/resources/, '');
  return SERVER_MODE ? RAW_BASE + bare : `${RAW_BASE}/resources-pro${bare}`;
}

const ORIGIN = new URL(RAW_BASE).origin;
const HOSTNAME = new URL(RAW_BASE).hostname;

/** A fresh token per run, so a hit can only have come from this test's input. */
function sentinel(label: string): string {
  return `IBSENTINEL${label}${Math.random().toString(16).slice(2, 10)}${Date.now().toString(16)}`;
}

// ─────────────────────────────────────────────────────────────────────────
// The watcher
// ─────────────────────────────────────────────────────────────────────────

interface Seen {
  /** 'request' | 'websocket' | 'ws-frame' — how the bytes were about to leave. */
  kind: string;
  url: string;
  method: string;
  resourceType: string;
  /** Body as latin1 text, so raw binary is searchable byte-for-byte. */
  body: string;
  bodyBytes: number;
  headers: Record<string, string>;
}

class Wire {
  readonly seen: Seen[] = [];
  private readonly pending: Promise<void>[] = [];

  /**
   * Listens on the context AND the page. The context event also reports
   * requests from service workers and from a page that is unloading; the page
   * event is kept because it is the documented surface and costs nothing —
   * duplicates are harmless, a miss is not.
   */
  constructor(context: BrowserContext, page: Page) {
    const onRequest = (kind: string) => (req: PwRequest) => {
      // postDataBuffer() is synchronous and must be read now: after the request
      // completes Playwright can no longer produce it.
      let body = '';
      let bodyBytes = 0;
      try {
        const buf = req.postDataBuffer();
        if (buf) {
          bodyBytes = buf.length;
          body = buf.toString('latin1');
        }
      } catch {
        /* nothing to read */
      }
      const entry: Seen = {
        kind,
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        body,
        bodyBytes,
        headers: {},
      };
      this.seen.push(entry);
      // allHeaders() is async and includes the headers the browser itself adds
      // (Cookie, Content-Type). It can reject once the request is gone, so the
      // synchronous snapshot is the fallback rather than nothing.
      this.pending.push(
        req
          .allHeaders()
          .then((h) => {
            entry.headers = h;
          })
          .catch(() => {
            try {
              entry.headers = req.headers();
            } catch {
              entry.headers = {};
            }
          }),
      );
    };

    context.on('request', onRequest('request'));
    page.on('request', onRequest('request'));

    // A WebSocket handshake is not reported as a request, so it is watched
    // separately — URL and every frame the page sends.
    page.on('websocket', (ws) => {
      this.seen.push({
        kind: 'websocket',
        url: ws.url(),
        method: 'WS',
        resourceType: 'websocket',
        body: '',
        bodyBytes: 0,
        headers: {},
      });
      ws.on('framesent', (f) => {
        const payload = typeof f.payload === 'string' ? f.payload : Buffer.from(f.payload).toString('latin1');
        this.seen.push({
          kind: 'ws-frame',
          url: ws.url(),
          method: 'WS',
          resourceType: 'websocket',
          body: payload,
          bodyBytes: payload.length,
          headers: {},
        });
      });
    });
  }

  /**
   * Installs an in-page recorder, and must be called BEFORE the first
   * navigation (addInitScript runs ahead of the page's own scripts).
   *
   * THIS IS NOT BELT-AND-BRACES. The network layer alone is not enough, and the
   * first run of this file against the live box proved it: this app's analytics
   * (lib/track.ts:64) send /api/event with
   * `navigator.sendBeacon(url, new Blob([...]))`, and Playwright reports those
   * requests with NO post data at all — `postDataBuffer()` is null, so their
   * bodies were being "searched" as empty strings. A leak that left by the same
   * beacon this app already uses would have sailed past a green test. So each
   * transport is wrapped at the call site, where the payload still exists as
   * the caller passed it, and then called through untouched: this observes the
   * page, it does not change what it does.
   *
   * What the network layer still adds, and why both are kept: an <img>/pixel
   * beacon, a form post, a navigation and anything a script the page loaded
   * does with a transport it captured before this ran.
   */
  async arm(page: Page): Promise<void> {
    await page.addInitScript(() => {
      type Row = { kind: string; url: string; body: string };
      const W = window as unknown as Window & { __ibWireLog?: Row[] };
      const log: Row[] = [];
      W.__ibWireLog = log;
      const CAP = 4 * 1024 * 1024;
      const fromBytes = (u8: Uint8Array): string => {
        let s = '';
        const n = Math.min(u8.length, CAP);
        for (let i = 0; i < n; i += 8192) {
          s += String.fromCharCode(...Array.from(u8.subarray(i, Math.min(i + 8192, n))));
        }
        return s;
      };
      const rec = (kind: string, url: unknown, data: unknown): void => {
        const row: Row = { kind, url: String(url), body: '' };
        log.push(row);
        try {
          if (data == null) return;
          if (typeof data === 'string') {
            row.body = data;
          } else if (typeof Blob !== 'undefined' && data instanceof Blob) {
            // Async on purpose: the tests flush and wait before reading this.
            data.text().then((t) => {
              row.body = t;
            }).catch(() => {
              row.body = '[unreadable blob]';
            });
          } else if (data instanceof ArrayBuffer) {
            row.body = fromBytes(new Uint8Array(data));
          } else if (ArrayBuffer.isView(data)) {
            const v = data as ArrayBufferView;
            row.body = fromBytes(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
          } else if (typeof FormData !== 'undefined' && data instanceof FormData) {
            const parts: string[] = [];
            data.forEach((v, k) => {
              parts.push(`${k}=${typeof v === 'string' ? v : `[file:${(v as File).name}:${(v as File).size}]`}`);
            });
            row.body = parts.join('&');
          } else if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
            row.body = data.toString();
          } else {
            row.body = String(data);
          }
        } catch {
          row.body = '[unreadable]';
        }
      };

      const beacon = navigator.sendBeacon?.bind(navigator);
      if (beacon) {
        navigator.sendBeacon = function (url: string | URL, data?: BodyInit | null): boolean {
          rec('js-sendBeacon', url, data);
          return beacon(url, data);
        };
      }
      const realFetch = W.fetch;
      if (realFetch) {
        W.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
          try {
            const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
            rec('js-fetch', url, init?.body ?? null);
          } catch {
            /* never break the page */
          }
          return realFetch.call(this, input as RequestInfo, init);
        };
      }
      const xhrOpen = XMLHttpRequest.prototype.open;
      const xhrSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (this: XMLHttpRequest & { __ibUrl?: string }, ...args: unknown[]) {
        this.__ibUrl = String(args[1] ?? '');
        return (xhrOpen as (...a: unknown[]) => void).apply(this, args);
      } as typeof XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.send = function (this: XMLHttpRequest & { __ibUrl?: string }, body?: unknown) {
        rec('js-xhr', this.__ibUrl ?? '', body ?? null);
        return (xhrSend as (...a: unknown[]) => void).call(this, body);
      } as typeof XMLHttpRequest.prototype.send;
      const wsSend = window.WebSocket?.prototype?.send;
      if (wsSend) {
        window.WebSocket.prototype.send = function (this: WebSocket, data: unknown) {
          rec('js-websocket', this.url, data);
          return (wsSend as (...a: unknown[]) => void).call(this, data);
        } as typeof WebSocket.prototype.send;
      }
    });
  }

  /** Pull the in-page recorder's rows across. Must run while the page is still alive. */
  async harvest(page: Page): Promise<void> {
    const rows = await page
      .evaluate(() => (window as unknown as { __ibWireLog?: { kind: string; url: string; body: string }[] }).__ibWireLog ?? [])
      .catch(() => [] as { kind: string; url: string; body: string }[]);
    for (const r of rows) {
      const body = String(r.body ?? '');
      this.seen.push({
        kind: r.kind,
        url: r.url,
        method: 'JS',
        resourceType: 'js-call',
        body,
        bodyBytes: body.length,
        headers: {},
      });
    }
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending);
  }

  /** Requests aimed at the scanner API, in any of the shapes it is deployed as. */
  scannerCalls(): Seen[] {
    return this.seen.filter((s) => /\/(?:api\/)?(?:scan-url|challenge)(?:$|[?#])/.test(s.url));
  }

  multipart(): Seen[] {
    return this.seen.filter((s) => /multipart\/form-data/i.test(s.headers['content-type'] ?? ''));
  }

  /**
   * Every place this needle appears, as a human-readable list. Searches the URL
   * (path and query), every header and the body, in raw, percent-encoded and
   * base64 form — a leak that JSON-encodes, URL-encodes or base64s the value is
   * still a leak.
   *
   * `ignoreHeaders` exists for exactly one case: a cookie this test planted on
   * THIS origin is attached to this origin's own requests by the browser, not
   * by the tool. See test 2, which still checks that header on every
   * cross-origin request.
   */
  hits(needle: string, opts: { ignoreHeaders?: string[] } = {}): string[] {
    const forms = [needle, encodeURIComponent(needle), Buffer.from(needle, 'utf8').toString('base64')];
    const ignore = new Set((opts.ignoreHeaders ?? []).map((h) => h.toLowerCase()));
    const found: string[] = [];
    const has = (hay: string) => forms.some((f) => hay.includes(f));
    for (const s of this.seen) {
      const where: string[] = [];
      if (has(s.url)) where.push('url');
      if (has(s.body)) where.push(`body (${s.bodyBytes} bytes)`);
      for (const [k, v] of Object.entries(s.headers)) {
        if (ignore.has(k.toLowerCase())) continue;
        if (has(v)) where.push(`header ${k}`);
      }
      if (where.length) found.push(`${s.method} ${s.url} [${s.kind}] -> ${where.join(', ')}`);
    }
    return found;
  }
}

/**
 * Give anything deferred a chance to fire, then force the deferred paths that
 * exist: analytics libraries commonly hold a sendBeacon until visibilitychange
 * or pagehide, and "nothing left during the click" is not the same claim as
 * "nothing left". The DOM assertions run BEFORE this, because it ends on
 * about:blank — requests made while unloading are still recorded by the
 * context-level listener (their bodies are not, which is why the synthetic
 * pagehide above comes first: it runs those handlers while the document, and
 * the in-page recorder inside it, are still alive to be read).
 */
async function flushAndSettle(page: Page, wire: Wire): Promise<void> {
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    for (const ev of ['visibilitychange', 'freeze']) {
      try {
        document.dispatchEvent(new Event(ev));
      } catch {
        /* not every event type exists everywhere */
      }
    }
    for (const ev of ['pagehide', 'blur']) {
      try {
        window.dispatchEvent(new Event(ev));
      } catch {
        /* ignore */
      }
    }
  });
  await page.waitForTimeout(600);
  await wire.harvest(page);
  await page.goto('about:blank');
  await page.waitForTimeout(600);
  await wire.settle();
}

/** A 404 or a redirect would make every assertion in this file vacuous. */
async function openTool(page: Page, url: string): Promise<void> {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded' });
  expect(res, `no response for ${url}`).not.toBeNull();
  expect(res!.status(), `${url} must exist on this deployment`).toBeLessThan(400);
}

/**
 * These pages are a static export: the markup — buttons and all — is in the
 * HTML, and the click handlers only exist once React has hydrated. A click
 * that lands before that is swallowed silently, which looked exactly like "the
 * tool did nothing" the first time this file was run against the live box, and
 * would have turned every "no request was made" assertion into a tautology.
 *
 * React writes `__reactProps$…` onto each host node it takes over, so this
 * waits for the actual control under test to be live rather than sleeping or
 * retrying the click — retrying is not an option for the Scan button, which
 * costs a real request every time.
 */
async function waitForHydration(page: Page, target: Locator, what: string): Promise<void> {
  await expect(target.first(), `${what} is not in the page at all`).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(
      async () =>
        target
          .first()
          .evaluate((el) => Object.keys(el).some((k) => k.startsWith('__reactProps$')))
          .catch(() => false),
      { message: `${what} never hydrated — its click handler would never run`, timeout: 30_000 },
    )
    .toBe(true);
}

// ─────────────────────────────────────────────────────────────────────────
// 1. Paste mode — a pasted cookie string must reach no socket
// ─────────────────────────────────────────────────────────────────────────
test('paste mode: a pasted cookie string is categorised locally and never reaches the wire', async ({ page }) => {
  test.setTimeout(90_000);
  const secret = sentinel('PASTE');
  const wire = new Wire(page.context(), page);
  await wire.arm(page);

  await openTool(page, proToolUrl('cookie-analyzer'));

  const pasteTab = page.getByRole('button', { name: 'Paste', exact: true });
  await waitForHydration(page, pasteTab, 'the cookie scanner');
  await pasteTab.click();

  // The shape the tool's own placeholder asks for (components/tools/
  // CookieAnalyzerTool.tsx:601), with a session token added: this is what a
  // user copying a live `Cookie:` header out of DevTools actually pastes.
  const pasted = [
    `SENTINEL_SESSION_a1b2c3=supersecretvalue-${secret}`,
    `_ga=GA1.2.${secret}.1757000000`,
    `_fbp=fb.1.1757000000.${secret}`,
    'session=abc123',
  ].join('; ');

  await page.locator('textarea').first().fill(pasted);
  await page.getByRole('button', { name: 'Analyze Cookies' }).click();

  // It really ran: the result card, the four cookies, and the categories the
  // known-cookie table gives them (lib/scanner.ts:177 _ga analytics,
  // :181 _fbp tracking; "session" in a name -> functional,
  // CookieAnalyzerTool.tsx:95).
  await expect(page.getByText(/The pasted cookies score \d+\/100/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('code').filter({ hasText: 'SENTINEL_SESSION_a1b2c3' }).first()).toBeVisible();
  await expect(page.locator('code').filter({ hasText: /^_ga$/ }).first()).toBeVisible();
  await expect(page.locator('code').filter({ hasText: /^_fbp$/ }).first()).toBeVisible();
  await expect(page.getByText('tracking', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('analytics', { exact: true }).first()).toBeVisible();

  await flushAndSettle(page, wire);

  // The watcher saw the page load at all — a listener that never fired would
  // make every assertion below true and meaningless.
  expect(wire.seen.length, 'the request watcher recorded nothing at all').toBeGreaterThan(0);

  // Nothing this origin sent carries the pasted value. No exemption here: the
  // sentinel was never a cookie on this origin, so there is no browser
  // behaviour that could legitimately put it on the wire.
  expect(wire.hits(secret), 'the pasted cookie string left the browser').toEqual([]);
  expect(wire.hits('supersecretvalue'), 'the pasted cookie value left the browser').toEqual([]);
  expect(wire.hits('SENTINEL_SESSION_a1b2c3'), 'a pasted cookie NAME left the browser').toEqual([]);

  // And the scanner API was not called at all — not with the paste, not empty.
  expect(
    wire.scannerCalls().map((s) => `${s.method} ${s.url}`),
    'Paste mode called the scanner API',
  ).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────
// 2. This Page mode — document.cookie, and the HttpOnly claim the copy makes
// ─────────────────────────────────────────────────────────────────────────
test('this-page mode: document.cookie is read locally, HttpOnly cookies are excluded and said to be, and nothing is posted', async ({
  page,
  context,
}) => {
  test.setTimeout(90_000);
  const jsSecret = sentinel('THISPAGE');
  const httpOnlySecret = sentinel('HTTPONLY');
  const wire = new Wire(context, page);
  await wire.arm(page);

  // Planted before navigation so the page is served with it: a cookie the page
  // CANNOT read. The tool's copy promises these do not appear; a tool that
  // silently omitted them would look identical on screen, so the cookie is
  // asserted to be really there and really unreadable before the tool runs.
  await context.addCookies([
    {
      name: 'ib_e2e_httponly_probe',
      value: httpOnlySecret,
      domain: HOSTNAME,
      path: '/',
      httpOnly: true,
      secure: HTTPS,
      sameSite: 'Lax',
    },
  ]);

  await openTool(page, proToolUrl('cookie-analyzer'));

  const stored = (await context.cookies(ORIGIN)).find((c) => c.name === 'ib_e2e_httponly_probe');
  expect(stored, 'the HttpOnly probe cookie was not stored — the claim below would be vacuous').toBeTruthy();
  expect(stored!.httpOnly, 'the probe cookie must actually be HttpOnly').toBe(true);

  const thisPageTab = page.getByRole('button', { name: 'This Page', exact: true });
  await waitForHydration(page, thisPageTab, 'the cookie scanner');
  await thisPageTab.click();

  // The claim, in the page's own words, before anything runs
  // (CookieAnalyzerTool.tsx:587).
  await expect(page.getByText(/HttpOnly cookies are hidden from scripts/i).first()).toBeVisible();

  // A cookie this page's scripts CAN read, set the way a user's site would.
  await page.evaluate((v) => {
    document.cookie = `SENTINEL_JS_SESSION=${v}; path=/; SameSite=Lax`;
  }, jsSecret);

  const visibleToScripts = await page.evaluate(() => document.cookie);
  expect(visibleToScripts, 'the JS-readable probe cookie was not set').toContain('SENTINEL_JS_SESSION');
  expect(
    visibleToScripts,
    'the HttpOnly probe is readable from JS — the browser is not enforcing HttpOnly, so this test proves nothing',
  ).not.toContain(httpOnlySecret);

  await page.getByRole('button', { name: 'Scan Cookies' }).click();

  await expect(page.getByText(/This page scores \d+\/100/).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('code').filter({ hasText: 'SENTINEL_JS_SESSION' }).first()).toBeVisible();

  // The HttpOnly cookie is absent from the rendered result — name and value.
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  expect(body, 'an HttpOnly cookie was listed by a tool that reads document.cookie').not.toContain(httpOnlySecret);
  expect(body, 'the HttpOnly probe cookie name was listed').not.toContain('ib_e2e_httponly_probe');

  await flushAndSettle(page, wire);
  expect(wire.seen.length, 'the request watcher recorded nothing at all').toBeGreaterThan(0);

  // These sentinels ARE cookies on this origin now, so the browser attaches
  // them to this origin's own requests by itself. That is the browser, not the
  // tool, so the `cookie` request header is exempted here — and only here — and
  // the cross-origin check below closes the hole that exemption opens.
  expect(wire.hits(jsSecret, { ignoreHeaders: ['cookie'] }), "this page's cookies left the browser").toEqual([]);
  expect(wire.hits('SENTINEL_JS_SESSION', { ignoreHeaders: ['cookie'] }), 'a cookie NAME left the browser').toEqual([]);

  // Nothing off this origin may carry them anywhere — cookie header included.
  const offOrigin = wire.seen.filter((s) => !s.url.startsWith(ORIGIN) && /^https?:/.test(s.url));
  for (const s of offOrigin) {
    const hay = [s.url, s.body, ...Object.values(s.headers)].join(' | ');
    expect(hay, `${s.method} ${s.url} carried this page's cookies off-origin`).not.toContain(jsSecret);
    expect(hay, `${s.method} ${s.url} carried the HttpOnly cookie off-origin`).not.toContain(httpOnlySecret);
  }

  expect(
    wire.scannerCalls().map((s) => `${s.method} ${s.url}`),
    'This Page mode called the scanner API',
  ).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────
// 3. Metadata viewer — image bytes must not leave, and nothing may be uploaded
// ─────────────────────────────────────────────────────────────────────────
test('metadata viewer: a real image is read in the browser and no request carries its bytes or its name', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const inBytes = sentinel('IMAGEBYTES');
  const inName = sentinel('FILENAME');
  const wire = new Wire(page.context(), page);
  await wire.arm(page);

  // A real JPEG (the suite's own fixture) with a JPEG COM segment spliced in
  // after SOI. lib/exif.ts:1511 turns marker 0xFE into a "Comment" field, so
  // the sentinel is inside the image DATA and visible on screen only if the
  // bytes were really read here.
  const base = readFileSync(join(__dirname, 'fixtures', 'sample.jpg'));
  expect(base.subarray(0, 2).toString('hex'), 'fixture sample.jpg is not a JPEG').toBe('ffd8');
  const comment = Buffer.from(inBytes, 'latin1');
  const com = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from([((comment.length + 2) >> 8) & 0xff, (comment.length + 2) & 0xff]),
    comment,
  ]);
  const jpeg = Buffer.concat([base.subarray(0, 2), com, base.subarray(2)]);
  const fileName = `holiday-${inName}.jpg`;

  await openTool(page, proToolUrl('metadata-viewer'));

  const picker = page.locator('input[type="file"]');
  await waitForHydration(page, picker, 'the metadata viewer');

  // ONE file: picking several is the gated gesture (GATE_COPY
  // 'metadata-multi-file'); one photo at a time is free by design and is what
  // this test is about.
  await picker.first().setInputFiles({
    name: fileName,
    mimeType: 'image/jpeg',
    buffer: jpeg,
  });

  // It really read the file: the comment from inside the bytes, and the name.
  await expect(page.getByText(inBytes).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(fileName).first()).toBeVisible();
  await expect(page.getByText('The file itself').first()).toBeVisible();

  await flushAndSettle(page, wire);
  expect(wire.seen.length, 'the request watcher recorded nothing at all').toBeGreaterThan(0);

  expect(wire.hits(inBytes), 'bytes from inside the image left the browser').toEqual([]);
  expect(wire.hits(inName), 'the file name left the browser').toEqual([]);

  // Nothing was uploaded at all: no multipart request exists.
  expect(
    wire.multipart().map((s) => `${s.method} ${s.url}`),
    'the metadata viewer made a multipart/form-data request',
  ).toEqual([]);

  // And no request carries a run of the image's own bytes. Checked over a slice
  // from the middle of the compressed data, which no other source could hold.
  const slice = jpeg.subarray(Math.floor(jpeg.length / 2), Math.floor(jpeg.length / 2) + 48).toString('latin1');
  for (const s of wire.seen) {
    expect(s.body.includes(slice), `${s.method} ${s.url} carried raw image bytes`).toBe(false);
  }

  expect(
    wire.scannerCalls().map((s) => `${s.method} ${s.url}`),
    'the metadata viewer called the scanner API',
  ).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────
// 4. THE CONTROL — the watcher must see a request that really happens
// ─────────────────────────────────────────────────────────────────────────
//
// Everything above is an assertion that something was NOT seen. That is only
// worth anything if the watcher can see. This drives the ONE mode of this tool
// that is supposed to call the server, and requires the detector to find a
// planted value in each of the three places tests 1-3 search:
//
//   url    — a probe in the tool page's own query string
//   header — a probe in an extra request header on this page
//   body   — the URL typed into the scanner, which the tool JSON-encodes into
//            the POST /api/scan-url body
//   beacon — a sendBeacon Blob body, because Playwright reports NO post data
//            for those (this app's own /api/event uses exactly that, and the
//            first run of this file was silently blind to it). That beacon
//            goes to a fabricated host that page.route() answers, so it costs
//            the production box nothing.
//
// It is also the only place in this file that touches the production API:
// ONE scan of https://example.com, which is one /challenge and one /scan-url.
test('CONTROL: the watcher sees the one mode that does call the server — url, header, body and beacon all detected', async ({
  page,
}) => {
  test.setTimeout(120_000);

  const urlProbe = sentinel('URLFIELD');
  const headerProbe = sentinel('HEADERFIELD');
  const beaconProbe = sentinel('BEACONBODY');
  const wire = new Wire(page.context(), page);
  await wire.arm(page);

  // Answered locally: nothing leaves this machine for this host.
  await page.route('**://ib-e2e-probe.invalid/**', (route) => route.fulfill({ status: 204, body: '' }));

  await page.setExtraHTTPHeaders({ 'x-ib-e2e-probe': headerProbe });

  const toolUrl = `${proToolUrl('cookie-analyzer')}?ibprobe=${urlProbe}`;
  await openTool(page, toolUrl);

  // The Scan button costs a real request, so it is clicked exactly once and
  // only after the component is live — a click that lands before hydration is
  // dropped, and a retry loop here would be a second scan of a real site.
  const urlTab = page.getByRole('button', { name: 'Scan a URL', exact: true });
  await waitForHydration(page, urlTab, 'the cookie scanner');
  // "Scan a URL" is the default mode; click it anyway so this does not depend
  // on which mode happens to be selected on load.
  await urlTab.click();

  const scanTarget = 'https://example.com/';
  await page.locator('input[type="url"]').first().fill(scanTarget);
  await page.getByRole('button', { name: /^Scan$/ }).click();

  // The scan is allowed to succeed OR to be refused (origin allowlist, rate
  // limit): what is under test here is that the REQUEST was seen, so the wait
  // is for the request itself, not for a green result.
  const scanRequest = await page
    .waitForRequest((r) => /\/scan-url(?:$|[?#])/.test(r.url()) && r.method() === 'POST', { timeout: 90_000 })
    .catch(() => null);
  expect(scanRequest, 'the scanner never issued a POST to /scan-url — the control cannot run').not.toBeNull();

  // Let the response land so the page settles.
  await page.waitForTimeout(2_000);

  // The beacon probe: the same transport, and the same Blob body shape, that
  // lib/track.ts:64 uses for /api/event.
  await page.evaluate(
    ([url, payload]) => {
      navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }));
    },
    ['https://ib-e2e-probe.invalid/beacon', JSON.stringify({ probe: beaconProbe })] as const,
  );

  await flushAndSettle(page, wire);

  // (a) the watcher saw the scanner API being called at all
  const calls = wire.scannerCalls();
  expect(
    calls.map((s) => `${s.method} ${s.url}`).join(' | '),
    'the watcher recorded no scanner API call for a scan that demonstrably happened',
  ).toMatch(/scan-url/);

  // (b) BODY detection works — the typed URL is in the POST body, and the same
  //     detector that reported [] three times above finds it here.
  const bodyHits = wire.hits('example.com');
  expect(bodyHits.length, 'the detector could not find the scanned URL anywhere').toBeGreaterThan(0);
  expect(
    bodyHits.some((h) => h.includes('body (')),
    `the detector never matched inside a request BODY — tests 1-3 rely on that. Hits: ${bodyHits.join(' ; ')}`,
  ).toBe(true);

  // (c) URL detection works
  const urlHits = wire.hits(urlProbe);
  expect(urlHits.length, 'the detector never matched inside a request URL').toBeGreaterThan(0);
  expect(urlHits.some((h) => h.includes('-> url')), `URL hits were not in the url field: ${urlHits.join(' ; ')}`).toBe(
    true,
  );

  // (d) HEADER detection works
  const headerHits = wire.hits(headerProbe);
  expect(
    headerHits.some((h) => h.includes('header x-ib-e2e-probe')),
    `the detector never matched inside a request HEADER. Hits: ${headerHits.join(' ; ')}`,
  ).toBe(true);

  // (e) sendBeacon BODY detection works. This is the one the network layer
  //     alone gets wrong: Playwright reports the beacon request with no post
  //     data, so without the in-page recorder this assertion fails — which is
  //     precisely how a leak sent by beacon would have been missed above.
  const beaconHits = wire.hits(beaconProbe);
  expect(
    beaconHits.some((h) => h.includes('body (')),
    `a sendBeacon Blob body was not readable — tests 1-3 cannot see beacon payloads. Hits: ${beaconHits.join(' ; ')}`,
  ).toBe(true);
});
