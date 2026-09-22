/**
 * The Pro CSV export, watched from a real browser: the third clause of the
 * audit's V2 finding, the one tests/audit-3-csv.test.ts cannot reach.
 *
 * That file lifts the shipped downloadCsv body out of
 * components/tools/CookieAnalyzerTool.tsx and runs it against a stub DOM, so
 * it proves what NAME and what BYTES the function hands the browser. It says
 * nothing about the two joins on either side of the function, and until this
 * spec nothing did:
 *
 *   - in front of it, the gate. useUpgradeGate's guard runs the export only
 *     when lib/in-app.ts inAppPro() finds <html data-ib-pro>, and since
 *     2026-09-19 the boot script sets that mark only when the app's own
 *     bridge object (window.IncognitoBrowserApp) or its user agent backs the
 *     URL's claim up. The unit harness grants no Pro mark on purpose (its own
 *     comment says so) and tests/pro-entitlement.test.ts:179-188 feeds the
 *     gate its own lambda, so no test joined bootInApp -> data-ib-pro ->
 *     guardExport -> downloadCsv.
 *   - behind it, the browser. A stub anchor's click() counts to one and
 *     stops. It does not show that Chromium begins a download, that the
 *     anchor's download attribute becomes the suggested filename, or that
 *     the file on disk is the blob's text.
 *
 * So this scans a real site from a real Pro tool page the way a subscriber
 * in the app would, clicks Export CSV, waits for the browser's own download
 * event, reads the saved file back and grades it against what the page
 * itself lists. The CONTROLS make the same visit without the bridge object,
 * once as a plain visitor and once carrying the sessionStorage flags a
 * shared `?inapp=1&pro=1` link leaves behind, and must get the upgrade
 * overlay and no file. Without them, a gate that opened AND downloaded, or a
 * Pro detection that stopped requiring the bridge, would leave the Pro case
 * green.
 *
 * What this does not grade: hostile input. https://example.com sets no
 * cookies and loads no scripts, so the file is a header row and the
 * formula-injection and shape checks below run over that row alone; the
 * hostile fixtures live in tests/audit-3-csv.test.ts. What the checks prove
 * here is the join: the file the browser saved is the page's result, named
 * after the host that was scanned, with nothing in it the page did not show.
 *
 * PRODUCTION SAFETY: each test performs exactly one real scan, of
 * https://example.com. The API allows ten scans a minute per network
 * (lib/tuning.ts SCAN_RATE_LIMIT), so runs of this file spaced closer than
 * that see a 429 as a missing result card. The Pro pages are only built on
 * the Pro deployment:
 *   E2E_BASE_URL=https://206-189-186-34.nip.io npx playwright test e2e/cookie-csv-export.spec.ts
 * or, fully local, touching no server but this machine's (the scan API is a
 * route handler in this repo and a page is always allowed to call its own
 * origin):
 *   ALTCHA_HMAC_KEY=<32+ random chars> NEXT_PUBLIC_TIER=pro npx next dev -p 3141
 *   E2E_BASE_URL=http://localhost:3141 npx playwright test e2e/cookie-csv-export.spec.ts
 */
import { test, expect, type Download, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Where the Pro tools live, in the shape e2e/pro-client-only.spec.ts uses:
// the static deploys serve Pro pages under /resources-pro; a local `next dev`
// (server mode, no basePath) serves them at the root.
const RAW_BASE = (process.env.E2E_PRO_BASE_URL || process.env.E2E_BASE_URL || 'https://206-189-186-34.nip.io')
  .replace(/\/+$/, '')
  .replace(/\/resources(?:-pro)?$/, '');
const SERVER_MODE = /localhost|127\.0\.0\.1/.test(RAW_BASE);

// The page comes from the generated fixture (scripts/gen-e2e-tool-pages.mjs,
// held to the source of truth by tests/e2e-fixtures.test.ts), never from a
// path typed here: a hand-typed Pro path is how three URLs went 404 for a
// week and read as broken inputs.
const TOOL_PAGES: Array<{ site: 'free' | 'pro'; path: string; engine: string }> =
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tool-pages.json'), 'utf-8'));
const TOOL_PAGE = TOOL_PAGES.find((t) => t.site === 'pro' && t.engine === 'cookie-analyzer');
if (!TOOL_PAGE) throw new Error('e2e/fixtures/tool-pages.json lists no Pro cookie-analyzer page');
const TOOL_URL = `${RAW_BASE}${SERVER_MODE ? '' : '/resources-pro'}${TOOL_PAGE.path}/`;

const SCAN_TARGET = 'https://example.com';

const CARD = '[data-result-card]';
const OVERLAY = '.ug-panel[data-upgrade-gate]';
const EXPORT_BUTTON = { name: 'Export CSV', exact: true } as const;

/**
 * The ten columns as literals. tests/audit-3-csv.test.ts pins the same list
 * for the same reason: compared against the constant that produced them, any
 * ten names in any order would pass.
 */
const HEADER = ['Type', 'Name', 'Category', 'Risk', 'Third-Party', 'Secure', 'HttpOnly', 'SameSite', 'Domain', 'Description'];
const ROW_TYPES = ['cookie', 'tracker', 'third-party-script'];

/** What Excel, Sheets and LibreOffice evaluate the moment a cell is opened. */
const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * RFC 4180 split, deliberately not imported from the component: a parser
 * taken from the code that writes the file would cancel out a matched pair of
 * bugs and this spec would prove nothing about the bytes.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** Get a result the way GATE_RUN['cookie-csv-export'] in e2e/cta-visibility.spec.ts does. */
async function scan(page: Page) {
  await page.locator('input[type="url"], input[type="text"]').first().fill(SCAN_TARGET);
  await page.getByRole('button', { name: 'Scan', exact: true }).click();
  await page.locator(CARD).first().waitFor({ state: 'attached', timeout: 30_000 });
}

/**
 * What the result page shows: the names in each list, section by section,
 * the number on its "Total Cookies" tile, and whether it says there was
 * nothing to list. Read from the rendered DOM, not from the API response, so
 * the file is graded against what a visitor saw.
 */
function listedOnPage(page: Page) {
  return page.evaluate(() => {
    const section = (re: RegExp) =>
      [...document.querySelectorAll('h3')].find((h) => re.test(h.textContent?.trim() ?? ''))?.parentElement ?? null;
    const texts = (root: Element | null, selector: string) =>
      root ? [...root.querySelectorAll(selector)].map((e) => e.textContent?.trim() ?? '') : [];
    const divs = [...document.querySelectorAll('div')];
    const totalLabel = divs.find((d) => d.textContent?.trim() === 'Total Cookies');
    const total = totalLabel?.previousElementSibling?.textContent?.trim();
    return {
      cookies: texts(section(/^Cookies \(\d+\)$/), 'code'),
      trackers: texts(section(/^Tracking Scripts Detected \(\d+\)$/), 'div.font-medium'),
      thirdParty: texts(section(/^Third-Party Script Domains \(\d+\)$/), 'span.font-mono'),
      totalCookies: total === undefined ? null : Number(total),
      saysNone: divs.some((d) => d.textContent?.trim() === 'No cookies or known trackers'),
    };
  });
}

test.describe('Export CSV on the Pro cookie scanner', () => {
  // One scan at a time. The scan API allows two scans in flight per /24
  // (lib/tuning.ts MAX_IN_FLIGHT_PER_BUCKET, app/scan-url/route.ts), so the
  // three tests here started together from one address get one 503, "Too
  // many scans running from your network right now", and a page with no
  // result card: a timeout that reads like a broken tool. Seen on the first
  // run of this file. 'default' runs the group in order in one worker
  // without 'serial' mode's skip-the-rest-after-a-failure.
  test.describe.configure({ mode: 'default' });

  test('a Pro subscriber inside the app: Export CSV saves a clean CSV named after the scanned host', async ({ page }) => {
    test.setTimeout(90_000);
    // How the app really says so (lib/in-app.ts): the bridge object, not a
    // URL flag. Copied from the gate test in e2e/cta-visibility.spec.ts.
    await page.addInitScript(() => {
      try { sessionStorage.setItem('ib-inapp', '1'); sessionStorage.setItem('ib-pro', '1'); } catch { /* storage blocked */ }
      // The bridge object, not a URL flag: the note on cta-visibility's card test says why.
      (window as unknown as { IncognitoBrowserApp?: unknown }).IncognitoBrowserApp = {};
    });
    await page.goto(TOOL_URL);
    await expect(page.locator('html')).toHaveAttribute('data-ib-pro', '');
    await scan(page);
    const listed = await listedOnPage(page);

    // Every download this page begins, so the count can be asserted too: the
    // event resolves the first one and would hide a second.
    const downloads: Download[] = [];
    page.on('download', (d) => downloads.push(d));
    const began = page.waitForEvent('download', { timeout: 10_000 }).catch(() => null);
    await page.getByRole('button', EXPORT_BUTTON).click();
    const download = await began;
    const overlayOpen = (await page.locator(OVERLAY).count()) > 0;
    if (!download) throw new Error(`no download began within 10s of Export CSV (upgrade overlay open: ${overlayOpen})`);
    expect(overlayOpen, 'a subscriber gets the file, not the ask').toBe(false);

    // The name the browser offers is the shipped sanitiser's output for the
    // scanned host. A literal, so a change to the naming scheme is a
    // decision, and the two properties the finding asked for on their own.
    const name = download.suggestedFilename();
    expect(name).toBe('example.com-cookie-scan.csv');
    expect(name.startsWith('example.com'), `named after the scanned host: ${name}`).toBe(true);
    expect(name).toMatch(/\.csv$/);

    // The bytes on disk, through an independent parser.
    const text = fs.readFileSync(await download.path(), 'utf-8');
    const rows = parseCsv(text);
    expect(rows[0]).toEqual(HEADER);
    for (const row of rows) {
      expect(row, JSON.stringify(row)).toHaveLength(HEADER.length);
      for (const cell of row) {
        expect(FORMULA_START.test(cell), `evaluated on open: ${JSON.stringify(cell)}`).toBe(false);
      }
    }
    // One logical row per physical line: no bare CR, no quoted newline.
    expect(text).not.toContain('\r');
    expect(text.split('\n')).toHaveLength(rows.length);

    // The file is the page's result and nothing else: every row is one of the
    // three kinds, and the names in each kind are the names the page listed,
    // in the page's order. The cookie count is also held to the number the
    // page's own tile states, so a file with no cookie rows agrees with a
    // page that said there were none rather than with an empty list.
    const names = (type: string) => rows.slice(1).filter((r) => r[0] === type).map((r) => r[1]);
    expect(rows.slice(1).map((r) => r[0]).filter((t) => !ROW_TYPES.includes(t))).toEqual([]);
    expect(names('cookie')).toEqual(listed.cookies);
    expect(names('tracker')).toEqual(listed.trackers);
    expect(names('third-party-script')).toEqual(listed.thirdParty);
    expect(listed.totalCookies, 'the page rendered its Total Cookies tile').not.toBeNull();
    expect(names('cookie')).toHaveLength(listed.totalCookies ?? -1);
    if (listed.saysNone) {
      expect(names('cookie')).toEqual([]);
      expect(names('tracker')).toEqual([]);
    }

    expect(downloads).toHaveLength(1);
  });

  // The same visit without the bridge object. The second variant carries the
  // two sessionStorage flags a shared `?inapp=1&pro=1` link used to leave
  // behind, which until 2026-09-19 were enough on their own.
  const CONTROLS: Array<{ label: string; init?: () => void }> = [
    { label: 'a plain visitor' },
    {
      label: 'the sessionStorage flags without the bridge',
      init: () => {
        try { sessionStorage.setItem('ib-inapp', '1'); sessionStorage.setItem('ib-pro', '1'); } catch { /* storage blocked */ }
      },
    },
  ];
  for (const control of CONTROLS) {
    test(`CONTROL, ${control.label}: Export CSV opens the upgrade overlay and saves nothing`, async ({ page }) => {
      test.setTimeout(90_000);
      if (control.init) await page.addInitScript(control.init);
      await page.goto(TOOL_URL);
      expect(await page.locator('html').getAttribute('data-ib-pro')).toBeNull();
      await scan(page);

      const downloads: Download[] = [];
      page.on('download', (d) => downloads.push(d));
      await page.getByRole('button', EXPORT_BUTTON).click();
      const overlay = page.locator(OVERLAY);
      await overlay.first().waitFor({ state: 'attached', timeout: 5_000 });
      await expect(overlay).toHaveAttribute('data-upgrade-gate', 'cookie-csv-export');
      // The event fires as soon as the browser begins a download. A gate that
      // opened AND downloaded is the bug this control exists to catch, so a
      // download is given a moment to show itself before none is claimed.
      await page.waitForTimeout(1_500);
      expect(downloads.map((d) => d.suggestedFilename())).toEqual([]);
    });
  }
});
