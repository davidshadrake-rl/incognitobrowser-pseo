/**
 * The cookie scanner, rendered with hostile data, in a real browser.
 *
 * WHAT THIS ADDS. The repo already asserts, from the SOURCE, that no component
 * hands scan data to dangerouslySetInnerHTML (tests/xss-protection.test.ts,
 * scripts/security/checks/sast-dynamic-code-sinks.mjs) and that the Paste and
 * This Page modes make no server call (tests/pro-client-only.test.ts,
 * scripts/security/checks/pro-client-only.mjs). Source analysis cannot say what
 * a RUNNING page does with a hostile value: a title=, an href, a stray
 * innerHTML in a dependency, or tomorrow's refactor are all outside a grep's
 * reach. This spec renders the payloads in e2e/fixtures/xss-payloads.json in
 * Chromium and reads the DOM that came out.
 *
 * WHERE THE DATA COMES FROM. Three places, and every one of them is attacker-
 * controlled in normal use:
 *   - /api/scan-url's response. Its cookie names, domains, descriptions,
 *     tracker names, inline-tracker strings, third-party domains and echoed
 *     URL are all copied from the SCANNED SITE, which chose them. The whole
 *     point of the tool is to be pointed at a site the user distrusts.
 *   - the Paste box. A cookie string the visitor pastes, usually another
 *     company's.
 *   - document.cookie, in This Page mode.
 *
 * NO REAL SCANS. The live box runs the team's WordPress and MySQL on 2 vCPU
 * and the API allows 10 scans/min per /24. Both /api/challenge and
 * /api/scan-url are fulfilled by page.route(): the challenge is a locally
 * crafted puzzle (maxnumber 100, so the client's solver finds it instantly)
 * and the scan body is the fixture. Nothing in this file touches the scanner,
 * so nothing here can trip a rate limit or be flaky on the droplet's load.
 * The Paste and This Page tests need no interception at all — those modes are
 * client-side by design, and each asserts that no /scan-url or /challenge
 * request happened, which is that design observed rather than read.
 *
 * WHAT COUNTS AS A PASS. For every payload, all three:
 *   1. window.__xss is undefined — nothing the payload carried ran.
 *   2. the DOM holds no script, event-handler attribute or <img src=x> that
 *      the payload introduced.
 *   3. the payload is STILL READABLE as text. Escaping is the fix; dropping
 *      the value is not. This tool is an audit — an auditor who cannot see the
 *      hostile cookie name cannot report it. Checking for the literal angle
 *      brackets is also what separates "escaped" from "injected as markup":
 *      had the string become real markup, the element's textContent would hold
 *      the tag's inner text and not `<script>` or `<img`.
 *
 * Run:
 *   E2E_BASE_URL=https://206-189-186-34.nip.io npx playwright test e2e/pro-xss.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const BASE = (process.env.E2E_BASE_URL || 'https://206-189-186-34.nip.io').replace(/\/$/, '');
const PRO = `${BASE}/resources-pro`;
const FIX = path.join(__dirname, 'fixtures');

interface Payload {
  sink: string;
  value: string;
  /** Substrings that must still be readable in the result after rendering. */
  expect: string[];
  note?: string;
  /** This Page only: the cookie name to pair the payload value with. */
  name?: string;
}

interface Fixture {
  marker: string;
  flagFunction: string;
  scan: Record<string, Payload>;
  paste: Record<string, Payload>;
  thisPage: Record<string, Payload>;
}

const F: Fixture = JSON.parse(fs.readFileSync(path.join(FIX, 'xss-payloads.json'), 'utf-8'));
const S = F.scan;

/** The fixture carries $comment keys for reviewers; they are not payloads. */
const payloads = (m: Record<string, Payload>): Array<[string, Payload]> =>
  Object.entries(m).filter(([k]) => !k.startsWith('$'));

/**
 * The cookie scanner's page. Read from the generated fixture rather than
 * hardcoded, so it follows the catalog (and so it cannot drift the way
 * tool-pages.json once did — see tests/e2e-fixtures.test.ts).
 */
const TOOL_PAGES: Array<{ site: 'free' | 'pro'; path: string; engine: string }> =
  JSON.parse(fs.readFileSync(path.join(FIX, 'tool-pages.json'), 'utf-8'));
const COOKIE_TOOL = `${PRO}${TOOL_PAGES.find((t) => t.site === 'pro' && t.engine === 'cookie-analyzer')!.path}/`;

// ─────────────────────────────────────────────────────────────────────────
// The stubbed scanner
// ─────────────────────────────────────────────────────────────────────────

/**
 * A proof-of-work challenge this process made up. lib/scan-client solveChallenge
 * brute-forces sha256(salt + n) against `challenge`, so a small maxnumber makes
 * the solve instant. `signature` is never checked by anyone: the /scan-url that
 * would verify it is intercepted too.
 */
const POW_SALT = 'e2e-pro-xss';
const POW_NUMBER = 7;
const CHALLENGE = {
  algorithm: 'SHA-256',
  salt: POW_SALT,
  challenge: createHash('sha256').update(`${POW_SALT}${POW_NUMBER}`).digest('hex'),
  maxnumber: 100,
  signature: 'stubbed-never-verified',
  expires: Math.floor(Date.now() / 1000) + 3600,
};

/** A /api/scan-url body shaped like lib/scanner's, with every renderable string replaced by a payload. */
function hostileScanBody() {
  return {
    url: S.url.value,
    status: 200,
    cookies: [
      {
        cookieName: S.cookieName.value,
        name: S.cookieName.value,
        category: 'tracking',
        risk: 'high',
        description: S.cookieDescription.value,
        raw: `${S.cookieName.value}=1; Domain=${S.cookieDomain.value}`,
        secure: false,
        httpOnly: false,
        sameSite: S.cookieSameSite.value,
        domain: S.cookieDomain.value,
        path: '/',
        maxAge: null,
        expires: null,
      },
      {
        cookieName: 'sessionid',
        name: 'sessionid',
        category: 'functional',
        risk: 'low',
        description: 'Keeps you signed in.',
        raw: 'sessionid=1',
        secure: true,
        httpOnly: true,
        sameSite: 'Lax',
        domain: 'xss.example',
        path: '/',
        maxAge: null,
        expires: null,
      },
    ],
    trackers: [
      {
        name: S.trackerName.value,
        category: S.trackerCategory.value,
        risk: 'high',
        description: S.trackerDescription.value,
      },
    ],
    inlineTrackers: [S.inlineTracker.value],
    thirdPartyDomains: [S.thirdPartyDomain.value],
    security: { isHTTPS: true, hasCSP: false, hasPermPolicy: false, hasHSTS: false },
    summary: {
      totalCookies: 2,
      trackingCookies: 1,
      analyticsCookies: 0,
      functionalCookies: 1,
      totalTrackers: 1,
      thirdPartyScripts: 1,
      highRiskItems: 1,
    },
  };
}

/** Counts of the scanner calls this page made, and a promise-free way to assert the stub was really used. */
interface ScannerCalls { challenge: number; scan: number }

async function stubScanner(page: Page, body: unknown): Promise<ScannerCalls> {
  const calls: ScannerCalls = { challenge: 0, scan: 0 };
  await page.route('**/challenge', async (route) => {
    calls.challenge += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CHALLENGE) });
  });
  await page.route('**/scan-url', async (route) => {
    calls.scan += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return calls;
}

/** Records every scanner request the page makes, for the modes that must make none. */
function watchScanner(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (r) => {
    if (/\/(challenge|scan-url)(\?|$)/.test(new URL(r.url()).pathname)) seen.push(`${r.method()} ${r.url()}`);
  });
  return seen;
}

// ─────────────────────────────────────────────────────────────────────────
// Reading the page back
// ─────────────────────────────────────────────────────────────────────────

/**
 * `__xssFlag()` exists so a payload can set the marker without an `=` sign.
 * Cookie names cannot carry one: document.cookie and parseCookieList both cut
 * the name at the first `=`, so `<script>window.__xss=1</script>` would arrive
 * truncated and a passing test would prove nothing about the untruncated one.
 */
const INIT_FLAG = `window.__xssFlag = function () { window.__xss = 1; };`;

interface DomAudit {
  flag: unknown;
  scripts: string[];
  handlers: string[];
  injected: string[];
}

/** Everything that would only exist if a payload had been parsed as markup rather than escaped. */
async function auditDom(page: Page): Promise<DomAudit> {
  return page.evaluate(() => {
    const HANDLERS = ['onerror', 'onload', 'onmouseover', 'onclick', 'onfocus', 'ontoggle', 'onanimationstart'];
    const all = Array.from(document.querySelectorAll('*'));
    return {
      flag: (window as unknown as Record<string, unknown>).__xss ?? null,
      scripts: Array.from(document.querySelectorAll('script'))
        .map((s) => s.textContent ?? '')
        .filter((t) => t.includes('__xss'))
        .map((t) => t.slice(0, 160)),
      handlers: all.flatMap((el) =>
        HANDLERS.filter((a) => (el.getAttribute(a) ?? '').includes('__xss')).map(
          (a) => `<${el.tagName.toLowerCase()} ${a}="${el.getAttribute(a)}">`,
        ),
      ),
      injected: [
        ...Array.from(document.querySelectorAll('img')).filter((i) => i.getAttribute('src') === 'x').map(() => 'img[src=x]'),
        ...all.filter((el) => el.tagName.toLowerCase() === 'svg' && HANDLERS.some((a) => el.hasAttribute(a))).map(() => 'svg[on…]'),
        ...Array.from(document.querySelectorAll('b, i, textarea')).filter((el) => (el.getAttribute('onmouseover') ?? '') !== '').map((el) => `${el.tagName.toLowerCase()}[onmouseover]`),
      ],
    };
  });
}

/**
 * The text a visitor can read inside <main>, with <script>/<style> removed so a
 * payload can never be "found" in the page's own JavaScript. textContent, not
 * innerText: it is exact, and it is what distinguishes an escaped `<script>…`
 * (present verbatim) from an injected one (absent, because the tag became a node).
 */
function readableText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const main = document.querySelector('main') ?? document.body;
    const clone = main.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script, style, template, noscript').forEach((n) => n.remove());
    return clone.textContent ?? '';
  });
}

/** The three assertions every payload has to satisfy. */
async function expectEscapedAndVisible(page: Page, label: string, expectText: string[]) {
  const dom = await auditDom(page);
  expect(dom.flag, `${label}: a payload executed and set window.__xss`).toBeNull();
  expect(dom.scripts, `${label}: the payload introduced a <script>`).toEqual([]);
  expect(dom.handlers, `${label}: the payload introduced an inline event handler`).toEqual([]);
  expect(dom.injected, `${label}: the payload became a real element`).toEqual([]);

  const text = await readableText(page);
  for (const wanted of expectText) {
    expect(
      text.includes(wanted),
      `${label}: "${wanted}" is not readable in the result — escaping is the fix, dropping it hides the finding from the auditor`,
    ).toBe(true);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 1. The scan response — every field the result panel renders
// ─────────────────────────────────────────────────────────────────────────

test('scan response: hostile cookie/tracker/domain/url fields render as text, not markup', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(INIT_FLAG);
  const calls = await stubScanner(page, hostileScanBody());

  await page.goto(COOKIE_TOOL);
  await page.locator('input[type="url"], input[type="text"]').first().fill(S.url.value);
  await page.getByRole('button', { name: 'Scan', exact: true }).click();

  // "Total Cookies" only renders from a completed scan (see e2e/tools.spec.ts).
  await expect(page.getByText('Total Cookies', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  expect(calls.scan, 'the stubbed /scan-url was never called — the panel came from somewhere else').toBeGreaterThan(0);
  // If the challenge had escaped the stub, this spec would be putting real load
  // on the droplet's 30/min limit; that is worth failing over, not shrugging at.
  expect(calls.challenge, '/challenge escaped the stub and hit the live API').toBeGreaterThan(0);

  for (const [id, p] of payloads(S)) {
    await expectEscapedAndVisible(page, `scan.${id} (${p.sink})`, p.expect);
  }
});

test('scan response: the hostile URL reaches the headline as text and never becomes a link', async ({ page }) => {
  test.setTimeout(60_000);
  await page.addInitScript(INIT_FLAG);
  const calls = await stubScanner(page, hostileScanBody());

  await page.goto(COOKIE_TOOL);
  await page.locator('input[type="url"], input[type="text"]').first().fill(S.url.value);
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await expect(page.getByText('Total Cookies', { exact: true }).first()).toBeVisible({ timeout: 30_000 });
  expect(calls.scan, 'the stubbed /scan-url was never called').toBeGreaterThan(0);
  expect(calls.challenge, '/challenge escaped the stub and hit the live API').toBeGreaterThan(0);

  // urlScanReport() takes new URL(url).hostname for the result card's headline.
  await expect(page.locator('[data-result-card]').first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/xss\.example scores \d+\/100/).first()).toBeVisible();

  // Nothing from the payload may end up somewhere a browser would execute or
  // navigate: an href/src, or a title/alt attribute rendered from scan data.
  const escapes = await page.evaluate(() => {
    const bad = (v: string | null) => !!v && (v.includes('__xss') || /^\s*javascript:/i.test(v));
    return Array.from(document.querySelectorAll('*')).flatMap((el) =>
      ['href', 'src', 'title', 'alt', 'style', 'formaction'].filter((a) => bad(el.getAttribute(a))).map((a) => `<${el.tagName.toLowerCase()} ${a}="${el.getAttribute(a)}">`),
    );
  });
  expect(escapes, 'scan data reached an attribute a browser acts on').toEqual([]);

  await expectEscapedAndVisible(page, 'scan.url', S.url.expect);
});

// ─────────────────────────────────────────────────────────────────────────
// 2. Paste mode — the visitor's own input, no server involved
// ─────────────────────────────────────────────────────────────────────────

for (const [id, p] of payloads(F.paste)) {
  test(`paste mode: ${id} is parsed and shown as text`, async ({ page }) => {
    await page.addInitScript(INIT_FLAG);
    const scannerRequests = watchScanner(page);

    await page.goto(COOKIE_TOOL);
    await page.getByRole('button', { name: 'Paste', exact: true }).click();
    await page.locator('textarea').first().fill(p.value);
    await page.getByRole('button', { name: 'Analyze Cookies', exact: true }).click();

    await expect(page.locator('[data-console="cookie-analyzer"]').first()).toBeVisible({ timeout: 15_000 });
    await expectEscapedAndVisible(page, `paste.${id} (${p.sink})`, p.expect);

    // The pasted string is somebody's live session cookies. It must not have
    // left the browser — asserted here as observed traffic, not read from source.
    expect(scannerRequests, 'pasted cookies reached the scanner API').toEqual([]);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 3. This Page mode — a hostile first-party cookie, read with document.cookie
// ─────────────────────────────────────────────────────────────────────────

test('this page mode: a cookie whose name and value are markup renders as text', async ({ page }) => {
  await page.addInitScript(INIT_FLAG);
  const scannerRequests = watchScanner(page);

  await page.goto(COOKIE_TOOL);

  const name = F.thisPage.cookieName;
  const value = F.thisPage.cookieValue;
  const written = await page.evaluate(
    ([nameOnly, valueName, valuePayload]) => {
      document.cookie = `${nameOnly}=set; path=/`;
      document.cookie = `${valueName}=${valuePayload}; path=/`;
      return document.cookie;
    },
    [name.value, value.name ?? 'ib_xss_probe', value.value] as const,
  );
  // Chromium normalises some cookie strings. If it dropped a payload the test
  // would be checking nothing, so the write is verified before it is read back.
  expect(written, 'Chromium did not keep the hostile cookie name').toContain(name.value);
  expect(written, 'Chromium did not keep the hostile cookie value').toContain(value.value);

  await page.getByRole('button', { name: 'This Page', exact: true }).click();
  await page.getByRole('button', { name: 'Scan Cookies', exact: true }).click();

  await expect(page.locator('[data-console="cookie-analyzer"]').first()).toBeVisible({ timeout: 15_000 });
  await expectEscapedAndVisible(page, `thisPage (${name.sink} / ${value.sink})`, [...name.expect, ...value.expect]);

  expect(scannerRequests, 'document.cookie reached the scanner API').toEqual([]);
});
