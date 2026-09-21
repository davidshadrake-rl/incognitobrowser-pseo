/**
 * Every tool page, every time — the cheap half of the tool suite.
 *
 * THE GAP THIS CLOSES. e2e/cta-visibility.spec.ts filters to one page per
 * engine unless ALL=1:
 *
 *   .filter((t) => process.env.ALL === '1' || (!seen.has(t.engine) && seen.add(t.engine)))
 *
 * so 34 of the 51 pages in e2e/fixtures/tool-pages.json never run. browser-privacy
 * has 11 topic skins and cookie-analyzer 5; they are the same engine wrapped in
 * different niche copy by app/tools/[niche]/[slug]/client.tsx. A skin that
 * diverges — wrong tier, stale build, missing control, an upgrade CTA pointing
 * somewhere nobody declared — is invisible to a one-per-engine run. This
 * already cost four releases once: a stale fixture filed three url-analyzer
 * pages as Pro, the spec asked for Pro URLs that 404, and the timeout read as a
 * broken product (scripts/gen-e2e-tool-pages.mjs's header tells that story).
 *
 * WHAT THIS IS NOT. It never runs a tool. No scan, no audit, no upload, no
 * quiz. That is cta-visibility's job and it is the slow, rate-limit-hungry
 * part: the live box serves the team's WordPress and MySQL on 2 vCPU behind
 * 10 scans/min per /24. This spec asserts STRUCTURE, so it is safe to run on
 * every commit with no flag.
 *
 * Network it causes, deliberately:
 *   - one HTML GET per page (the navigation) plus one status-only GET of the
 *     same path on the OTHER tier;
 *   - nothing else. POST /api/event (lib/track.ts analytics) is aborted so a CI
 *     run does not write bot traffic into the day-bucketed counters, and
 *     whats-my-ip's POST /api/ip — the one engine that calls the API on page
 *     load, with no click — is fulfilled from a fabricated response.
 *
 * Run:
 *   E2E_BASE_URL=https://206-189-186-34.nip.io npx playwright test e2e/tool-skins.spec.ts
 */
import { test, expect, type Locator, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = (process.env.E2E_BASE_URL || 'https://206-189-186-34.nip.io').replace(/\/$/, '');
const SITE = { free: `${BASE}/resources`, pro: `${BASE}/resources-pro` } as const;

type Site = keyof typeof SITE;
interface ToolPage { site: Site; path: string; engine: string }

/**
 * GENERATED, never hand-edited (scripts/gen-e2e-tool-pages.mjs, guarded by
 * tests/e2e-fixtures.test.ts). Parametrising from it is the point: a new niche
 * shell for an existing engine becomes a new case here with no edit at all.
 */
const PAGES: ToolPage[] = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'tool-pages.json'), 'utf-8'),
);

/** Which deployment a page lives on, taken from the fixture's own `site` — which the generator derives from lib/tiers.ts PRO_ENGINES. Nothing is restated here. */
const PRO_ENGINES = new Set(PAGES.filter((p) => p.site === 'pro').map((p) => p.engine));

const pageUrl = (site: Site, p: string) => `${SITE[site]}${p}/`;
const otherSite = (site: Site): Site => (site === 'pro' ? 'free' : 'pro');

/** app/tools/[niche]/[slug]/client.tsx wraps the engine in `<div id="tool">`. Every control below is scoped to it, so page copy cannot satisfy a control assertion. */
const TOOL = '#tool';

/**
 * The one control that proves each engine mounted and rendered its input
 * surface. Read out of the components, not guessed:
 *
 *   ad-blocker-test        AdBlockerTestTool.tsx:267   'Run Ad-Blocker Test' (becomes 'Run Again' only after a run)
 *   browser-privacy        BrowserPrivacyTool.tsx:452  'Run Privacy Audit'
 *   cookie-analyzer        CookieAnalyzerTool.tsx:500  role=group aria-label="What to scan"
 *   dns-leak-test          DnsLeakTestTool.tsx:359     'Run DNS leak test (VPN off)'
 *   email-pixel-detector   EmailPixelDetectorTool.tsx:228 'Analyze email'
 *   hash-generator         HashGeneratorTool.tsx:204   role=group aria-label="What to hash"
 *   link-unwrapper         LinkUnwrapperTool.tsx:127   input[type=url]
 *   metadata-viewer        MetadataViewerTool.tsx:240  input[type=file]
 *   password-generator     PasswordGeneratorTool.tsx:254 role=group aria-label="What to generate"
 *   password-strength      PasswordStrengthTool.tsx:344 input[type=password]
 *   permission-checker     PermissionCheckerTool.tsx:277 'Check permissions' (becomes 'Check again' after a run)
 *   privacy-quiz           PrivacyQuizTool.tsx:373     the option buttons, which carry aria-pressed
 *   screenshot-leak-checker ScreenshotLeakCheckerTool.tsx:290 input[type=file]
 *   text-encryption        TextEncryptionTool.tsx:248  role=group aria-label="Encrypt or decrypt"
 *   url-analyzer           URLAnalyzerTool.tsx:361     input[type=url]
 *   useragent-analyzer     UserAgentAnalyzerTool.tsx:231 the "Analyze a different user agent" checkbox
 *   whats-my-ip            WhatsMyIpTool.tsx:357       the 'Refresh' action on the finished console
 *
 * The last two answer on page load and render only a role=status placeholder
 * until they have (the server render). Their control therefore also proves the
 * component hydrated — for whats-my-ip against the stubbed /ip below.
 *
 * The two Web Crypto tools need no special case on HTTP: SecureContextRequired
 * renders a banner ABOVE the tool (HashGeneratorTool.tsx:201,
 * TextEncryptionTool.tsx:244) and the tool still renders its mode group.
 */
interface Control { what: string; find: (p: Page) => Locator }
const CONTROL: Record<string, Control> = {
  'ad-blocker-test': { what: 'the "Run Ad-Blocker Test" button', find: (p) => p.locator(TOOL).getByRole('button', { name: 'Run Ad-Blocker Test' }) },
  'browser-privacy': { what: 'the "Run Privacy Audit" button', find: (p) => p.locator(TOOL).getByRole('button', { name: 'Run Privacy Audit' }) },
  'cookie-analyzer': { what: 'the "What to scan" mode group', find: (p) => p.locator(`${TOOL} [role="group"][aria-label="What to scan"]`) },
  'dns-leak-test': { what: 'the "Run DNS leak test (VPN off)" button', find: (p) => p.locator(TOOL).getByRole('button', { name: 'Run DNS leak test (VPN off)' }) },
  'email-pixel-detector': { what: 'the "Analyze email" button', find: (p) => p.locator(TOOL).getByRole('button', { name: 'Analyze email', exact: true }) },
  'hash-generator': { what: 'the "What to hash" mode group', find: (p) => p.locator(`${TOOL} [role="group"][aria-label="What to hash"]`) },
  'link-unwrapper': { what: 'the link input', find: (p) => p.locator(`${TOOL} input[type="url"]`) },
  'metadata-viewer': { what: 'the photo picker', find: (p) => p.locator(`${TOOL} input[type="file"]`) },
  'password-generator': { what: 'the "What to generate" mode group', find: (p) => p.locator(`${TOOL} [role="group"][aria-label="What to generate"]`) },
  'password-strength': { what: 'the password field', find: (p) => p.locator(`${TOOL} input[type="password"]`) },
  'permission-checker': { what: 'the "Check permissions" button', find: (p) => p.locator(TOOL).getByRole('button', { name: 'Check permissions' }) },
  'privacy-quiz': { what: 'the first question\'s answer buttons', find: (p) => p.locator(`${TOOL} button[aria-pressed]`) },
  'screenshot-leak-checker': { what: 'the screenshot picker', find: (p) => p.locator(`${TOOL} input[type="file"]`) },
  'text-encryption': { what: 'the "Encrypt or decrypt" mode group', find: (p) => p.locator(`${TOOL} [role="group"][aria-label="Encrypt or decrypt"]`) },
  'url-analyzer': { what: 'the URL input', find: (p) => p.locator(`${TOOL} input[type="url"]`) },
  'useragent-analyzer': { what: 'the "Analyze a different user agent" checkbox', find: (p) => p.locator(`${TOOL} input[type="checkbox"]`) },
  'whats-my-ip': { what: 'the "Refresh" action on the finished console', find: (p) => p.locator(TOOL).getByRole('button', { name: 'Refresh' }) },
};

/**
 * WhatsMyIpTool.tsx:302 calls POST {NEXT_PUBLIC_SCAN_API}/ip on mount — no
 * click, so simply opening the page hits the API. scripts/deploy.sh:110 builds
 * the droplet with NEXT_PUBLIC_SCAN_API=/api, so that is same-origin POST
 * /api/ip, proxied to the Node service that also answers /api/scan-url. The
 * route pattern's leading wildcard crosses path segments, so it catches the
 * call wherever the base points; verified against the live droplet on
 * 2026-09-21 — the route
 * fired once and the page rendered the stub address, so nothing reached the
 * service. Fifty-one page loads a commit is not load this spec should add to a
 * 2 vCPU box that also serves WordPress. The shape is IpLookup
 * (WhatsMyIpTool.tsx:196); 203.0.113.7 is TEST-NET-3, from RFC 5737.
 */
const IP_STUB = { ip: '203.0.113.7', version: 'v4', local: false, city: 'Test City', region: null, country: 'GB', timezone: null };

/** The two destinations an upgrade CTA may have with nobody declaring anything — mirrors sanctioned() in scripts/security/checks/compliance-upgrade-cta.mjs. */
function sanctioned(href: string): true | string {
  if (/^https:\/\/play\.google\.com\/store\/apps\/details\?/.test(href)) {
    return /[?&]referrer=/.test(href) ? true : 'play.google.com without a referrer= (install attribution is lost)';
  }
  if (href === 'incognitobrowser://upgrade') return true;
  return 'not Google Play and not incognitobrowser://upgrade';
}

/**
 * The declared departures, read from the file a person edits — not restated
 * here. An entry without an owner, a reason, or with an end date in the past
 * fails exactly as an undeclared host does; that is the whole mechanism
 * (scripts/security/data/compliance-exceptions.json's own header says so).
 */
interface UpgradeException { host?: string; owner?: string; reason?: string; expires?: string }
const DECLARED: Map<string, UpgradeException> = new Map(
  (JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'scripts', 'security', 'data', 'compliance-exceptions.json'), 'utf-8'),
  ).upgradeDestinations as UpgradeException[] ?? []).map((d) => [String(d.host).toLowerCase(), d]),
);

/** Why this href is not allowed here, or null when it is. */
function upgradeProblem(href: string): string | null {
  const verdict = sanctioned(href);
  if (verdict === true) return null;
  let host = '(relative or unparseable)';
  try { host = new URL(href).host.toLowerCase(); } catch { /* keep the placeholder */ }
  const entry = DECLARED.get(host);
  if (!entry) return `${verdict}, and ${host} is not declared in scripts/security/data/compliance-exceptions.json → upgradeDestinations`;
  if (!entry.owner || !entry.reason) return `${host} is declared but the entry has no owner or no reason`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.expires))) return `${host} is declared but "expires" is not an ISO date (YYYY-MM-DD): ${entry.expires}`;
  const today = new Date().toISOString().slice(0, 10);
  if (String(entry.expires) < today) return `the exception for ${host} expired on ${entry.expires} (today is ${today})`;
  return null;
}

/** Every /_next/static asset the page references, with the site prefix taken off so the two deployments compare. */
function staticAssets(html: string, site: Site): string[] {
  const prefix = site === 'pro' ? '/resources-pro' : '/resources';
  const found = html.match(/\/(?:resources|resources-pro)?\/?_next\/static\/[^"']+/g) ?? [];
  return [...new Set(found.map((u) => u.replace(prefix, '')))].sort();
}

// ─────────────────────────────────────────────────────────────────────────
// A guard against a silently shrinking run: 0 findings over 0 pages is not a pass.
// ─────────────────────────────────────────────────────────────────────────
test.describe('coverage', () => {
  test('every engine in the fixture has a declared control, and every declared control is in the fixture', () => {
    const inFixture = new Set(PAGES.map((p) => p.engine));
    expect(PAGES.length, 'the generated fixture is not empty').toBeGreaterThan(0);
    expect([...inFixture].filter((e) => !CONTROL[e]).sort(), 'engines with no control declared in this spec — add one, do not let the page go unchecked').toEqual([]);
    expect(Object.keys(CONTROL).filter((e) => !inFixture.has(e)).sort(), 'controls declared for engines the fixture no longer lists — stale, and each one is a test that can never run').toEqual([]);
    console.log(`[tool-skins] ${PAGES.length} pages across ${inFixture.size} engines; ${PAGES.filter((p) => p.site === 'pro').length} on the Pro deployment`);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// One test per page, grouped by engine so a failure names the skin.
// ─────────────────────────────────────────────────────────────────────────
for (const engine of [...new Set(PAGES.map((p) => p.engine))].sort()) {
  const skins = PAGES.filter((p) => p.engine === engine);

  test.describe(engine, () => {
    for (const row of skins) {
      test(`${row.site}${row.path}`, async ({ page, request }) => {
        const control = CONTROL[engine];
        expect(control, `no control declared for engine ${engine}`).toBeTruthy();

        // Analytics must not learn about CI (lib/track.ts is silent on failure by design).
        await page.route('**/event', (route) => route.abort());
        if (engine === 'whats-my-ip') {
          await page.route('**/ip', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(IP_STUB) }));
        }

        // 1. The status the tier implies. lib/tiers.ts engineVisibleInThisTier is
        //    symmetric: a build renders its own tier's engines and no others, so
        //    the page is 200 where the fixture says it lives and 404 on the other
        //    deployment. The 404 is the DESIGNED answer, not a failure — and
        //    asserting both is what catches the fixture drifting away from
        //    lib/tiers.ts, which is the bug that cost four releases.
        const own = pageUrl(row.site, row.path);
        const away = pageUrl(otherSite(row.site), row.path);
        // ?inapp=1&pro=1 is the app's own handshake (lib/in-app.ts). See step 2.
        const res = await page.goto(`${own}?inapp=1&pro=1`, { waitUntil: 'domcontentloaded' });
        expect(res?.status(), `${own} is a ${row.site} page and must be built on the ${row.site} deployment`).toBe(200);
        const acrossTier = await request.get(away, { failOnStatusCode: false });
        expect(acrossTier.status(), `${away}: ${engine} is a ${row.site} engine, so this page must NOT exist on the ${otherSite(row.site)} deployment`).toBe(404);

        // 2. The in-app boot script is on the page and running. It is what marks a
        //    page inside the WebView (lib/in-app.ts bootInApp, rendered first in
        //    <body> by app/layout.tsx:62), and it is minified in the export, so
        //    what it DOES is the only honest way to look for it:
        //      - ?inapp=1 marks <html data-inapp="param">;
        //      - both parameters are taken back out of the address bar, so a link
        //        the visitor copies never carries them;
        //      - ?pro=1 alone still marks NOTHING. data-ib-pro needs
        //        `source && pro && (bridged || named)`, and Playwright's Chromium
        //        offers neither window.IncognitoBrowserApp nor a UA matching
        //        /incognito ?browser/i. This is the 2026-09-19 fix — before it,
        //        one shared link hid every upgrade ask and opened all three gates
        //        for the whole tab on the open web — checked here on all 51 pages.
        await expect(page.locator('html'), 'the boot script marked this page as opened from the app').toHaveAttribute('data-inapp', 'param');
        const marks = await page.evaluate(() => ({
          search: window.location.search,
          pro: document.documentElement.hasAttribute('data-ib-pro'),
        }));
        expect(marks.search, 'the boot script takes inapp/pro back out of the address bar').toBe('');
        expect(marks.pro, '?pro=1 alone must never set data-ib-pro on the open web (lib/in-app.ts: source && pro && (bridged || named))').toBe(false);

        // 3. The tool's own interactive surface rendered inside #tool.
        await expect(control.find(page).first(), `${engine} on ${row.path}: ${control.what} did not render inside #tool`).toBeVisible({ timeout: 15_000 });

        // 4. The three Pro engines: the gate has somewhere to render.
        //    components/ui/UpgradeOverlay.tsx returns null while closed, and
        //    opening it needs a full result cycle (cta-visibility.spec.ts does
        //    that, once per gate). What IS checkable on every skin without
        //    running anything is that this page's OWN stylesheet — content-hashed
        //    per build, so a page served from a stale build points at a stale one
        //    — still carries the overlay's chrome and the Pro ask's classes. The
        //    metadata gate's surface is also structural: the multi-file attempt
        //    is only possible because the picker is <input multiple>
        //    (MetadataViewerTool.tsx:240), which is what lib/card-copy.ts's
        //    'metadata-multi-file' gate intercepts.
        if (PRO_ENGINES.has(engine)) {
          const styled = await page.evaluate(() => {
            const want = ['.ug-scrim', '.ug-panel', '.ug-close', '.ug-headline', '.btn-pro', '.rc-foot'];
            const found = new Set<string>();
            const walk = (rules: CSSRuleList | undefined) => {
              for (const rule of Array.from(rules ?? [])) {
                const sel = (rule as CSSStyleRule).selectorText;
                if (sel) for (const w of want) if (sel.split(',').some((s) => s.trim().startsWith(w))) found.add(w);
                walk((rule as CSSGroupingRule).cssRules);
              }
            };
            for (const sheet of Array.from(document.styleSheets)) {
              try { walk(sheet.cssRules); } catch { /* a cross-origin sheet cannot be read; there are none of ours */ }
            }
            return want.filter((w) => !found.has(w));
          });
          expect(styled, `${row.path}: the upgrade overlay's classes are missing from this page's stylesheet — it cannot render a gate, which is what a stale build looks like`).toEqual([]);
          if (engine === 'metadata-viewer') {
            await expect(page.locator(`${TOOL} input[type="file"][multiple]`), 'the multi-file gate can only be attempted if the picker accepts more than one photo').toHaveCount(1);
          }
        }

        // 5. No upgrade CTA points anywhere but Play, the app's own upgrade
        //    screen, or a live declared exception. These pages render inside the
        //    Android app's WebView (IN-APP-BRIDGE.md), so an upgrade CTA is a
        //    purchase flow for a digital good — and the footnote under it says
        //    "Pro is part of the free Incognito Browser app", which has to keep
        //    describing where the tap lands. An absence is a finding too: the
        //    standing decision is a Pro funnel on every page.
        const ctas = await page.$$eval('a[data-upgrade-from]', (els) =>
          els.map((el) => ({ from: el.getAttribute('data-upgrade-from') ?? '?', href: el.getAttribute('href') ?? '' })));
        expect(ctas.length, `${row.path}: no <a data-upgrade-from> on the page — the Pro funnel is meant to be on every page`).toBeGreaterThan(0);
        const stray = ctas.map((c) => ({ ...c, why: upgradeProblem(c.href) })).filter((c) => c.why);
        expect(stray, `${row.path}: upgrade CTA(s) pointing at an undeclared or expired destination`).toEqual([]);
      });
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────
// Stale-build detection across an engine's skins.
// ─────────────────────────────────────────────────────────────────────────
/**
 * The skins of one engine are the same route (app/tools/[niche]/[slug]) with
 * different niche copy, so one build gives them all the same /_next/static
 * asset set. A skin left behind by a partial deploy — the exact failure that is
 * invisible to a one-page-per-engine run — points at a different set. Measured
 * on the live droplet on 2026-09-21: all 11 browser-privacy skins and all 9
 * privacy-quiz skins agreed, across both deployments.
 *
 * HTML only, no browser: this is ~3.5 MB of static pages for the whole suite,
 * and it does not touch the API at all.
 */
test.describe('build freshness', () => {
  for (const engine of [...new Set(PAGES.map((p) => p.engine))].sort()) {
    const skins = PAGES.filter((p) => p.engine === engine);
    // An engine with one skin has nothing to compare. Saying so beats a green
    // tick over an empty comparison.
    if (skins.length < 2) continue;

    test(`${engine}: all ${skins.length} skins are served from one build`, async ({ request }) => {
      const seen: Array<{ path: string; assets: string[] }> = [];
      for (const row of skins) {
        const url = pageUrl(row.site, row.path);
        const res = await request.get(url, { failOnStatusCode: false });
        expect(res.status(), `${url} did not serve`).toBe(200);
        const assets = staticAssets(await res.text(), row.site);
        expect(assets.length, `${url} references no /_next/static assets — that is not a built page`).toBeGreaterThan(0);
        seen.push({ path: row.path, assets });
      }
      const [first, ...rest] = seen;
      const diverged = rest
        .filter((s) => s.assets.join('\n') !== first.assets.join('\n'))
        .map((s) => ({
          skin: s.path,
          missingHere: first.assets.filter((a) => !s.assets.includes(a)),
          extraHere: s.assets.filter((a) => !first.assets.includes(a)),
        }));
      expect(diverged, `these ${engine} skins reference different build assets from ${first.path} — one of them is from an older deploy`).toEqual([]);
    });
  }
});
