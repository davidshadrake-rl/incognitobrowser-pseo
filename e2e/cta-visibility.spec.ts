/**
 * Owner rule (2026-09-16): a tool's result is the "magic moment". The upgrade
 * button is on screen when the result appears, with no scrolling, and "Share
 * your result" and the ask sit above the tool's long report.
 *
 * For each result surface, on four devices, this gets a result the way a
 * visitor would (Playwright scrolls to a control before it clicks or types,
 * as a visitor does), waits until the result card says where it put itself
 * (data-result-placed, components/tools/ResultCard.tsx) and then, without
 * scrolling further, checks:
 *   - the upgrade button ([data-result-cta] .btn-pro) is fully inside the
 *     viewport, and a tap at its centre lands on it (not the sticky header);
 *   - the subscription footnote (.rc-foot) is fully inside the viewport;
 *   - the share row ([data-scorecard]) starts above the report (.rc-report).
 * At 360x640 the footnote, and the button on tools that answer on page load,
 * are soft: reported and logged, and the rest of the case still runs.
 * Calculators have no result card: after a setting changes, their next-step
 * button ([data-next-step]) must be on screen instead.
 *
 * Run against the droplet:
 *   E2E_BASE_URL=https://206-189-186-34.nip.io npx playwright test e2e/cta-visibility.spec.ts
 * ALL=1 runs every tool page that answers with a result card, not one per engine.
 * Writes a JSON report to test-results/cta-visibility.json and a viewport
 * screenshot per case to test-results/cta-visibility/.
 */
import { test, expect, devices, type Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const BASE = (process.env.E2E_BASE_URL || 'https://206-189-186-34.nip.io').replace(/\/$/, '');
const FREE = `${BASE}/resources`;
const PRO = `${BASE}/resources-pro`;
const FIX = path.join(__dirname, 'fixtures');
const SITES = path.join(__dirname, '..', 'data', 'sites');
const OUT = path.join(process.cwd(), 'test-results', 'cta-visibility');

const CARD = '[data-result-card]';
const BUTTON = '[data-result-cta] .btn-pro';
const FOOT = '.rc-foot';
const SHARE = '[data-scorecard]';
const REPORT = '.rc-report';

/** How the result arrives: after the visitor's own action, on page load, at the end of the quiz, built into the page, or a calculator's next step. */
type Kind = 'action' | 'on-load' | 'quiz' | 'report-card' | 'calculator';

interface Run { label?: string; kind?: Kind; run: (page: Page) => Promise<void>; timeout?: number }
interface Case { name: string; url: string; kind: Kind; run: (page: Page) => Promise<void>; timeout: number }

/** Choose a file as a visitor would: the upload control is on screen first. */
const upload = (file: string) => async (p: Page) => {
  const input = p.locator('input[type="file"]').first();
  await input.evaluate((el) => {
    let box: Element | null = el;
    while (box && box.getBoundingClientRect().height === 0) box = box.parentElement;
    box?.scrollIntoView({ block: 'nearest' });
  });
  await input.setInputFiles(path.join(FIX, file));
};

/** Answer every question with its last (least private) option, so the result is one Pro answers; wait for the next question or the result each time. */
async function answerQuiz(p: Page) {
  for (let i = 0; i < 30 && !(await p.locator(CARD).count()); i++) {
    const counter = (await p.getByText(/^Question \d+ of \d+$/).first().textContent({ timeout: 5_000 }))?.trim() ?? '';
    await p.locator('main button[aria-pressed]').last().click();
    await p.waitForFunction(
      ([card, before]) => !!document.querySelector(card)
        || [...document.querySelectorAll('main span')].some((s) => /^Question \d+ of \d+$/.test(s.textContent?.trim() ?? '') && s.textContent?.trim() !== before),
      [CARD, counter] as const,
      { timeout: 5_000 },
    );
  }
}

/** Change a calculator's first setting to a different value, so the result is the visitor's own. */
async function changeSetting(p: Page) {
  const field = p.locator('main select, main input[type="number"], main input[type="range"]').first();
  // A visitor scrolls to the setting before changing it; selectOption and fill don't scroll on their own.
  await field.scrollIntoViewIfNeeded();
  if ((await field.evaluate((e) => e.tagName)) === 'SELECT') {
    const index = await field.evaluate((e) => (e as HTMLSelectElement).selectedIndex);
    await field.selectOption({ index: index === 0 ? 1 : 0 });
  } else {
    const { value, min, max } = await field.evaluate((e) => {
      const i = e as HTMLInputElement;
      return { value: i.value, min: i.min || '0', max: i.max || '100' };
    });
    await field.fill(value === max ? min : max);
  }
}

/** How a visitor gets a result out of each engine. Value-only tools (hash, password generator, text encryption) have no result card by design. */
const RUN: Record<string, Run[]> = {
  // Key by key: the card waits for a pause in typing before it moves the page.
  'password-strength': [{ run: async (p) => { await p.locator('input[type="password"], input[type="text"]').first().pressSequentially('password123', { delay: 40 }); } }],
  'whats-my-ip': [{ kind: 'on-load', run: async () => {}, timeout: 30_000 }],
  'useragent-analyzer': [{ kind: 'on-load', run: async () => {} }],
  'permission-checker': [{ run: async (p) => { await p.getByRole('button', { name: /check permissions/i }).first().click(); } }],
  // The built-in example is labelled as not the visitor's and gets no ask: edit it so it is theirs.
  'email-pixel-detector': [{ run: async (p) => {
    await p.getByRole('button', { name: 'Load example', exact: true }).click();
    await p.locator('textarea').first().press('End');
    await p.locator('textarea').first().pressSequentially(' ');
    await p.getByRole('button', { name: 'Analyze email', exact: true }).click();
  } }],
  'link-unwrapper': [{ run: async (p) => {
    await p.locator('input[type="url"], input[type="text"]').first().pressSequentially('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fsale%3Ffbclid%3DIwAR0abc123def456&sa=D');
    await p.getByRole('button', { name: /unwrap|analyze/i }).first().click();
  } }],
  'ad-blocker-test': [{ run: async (p) => { await p.getByRole('button', { name: 'Run Ad-Blocker Test' }).click(); }, timeout: 20_000 }],
  'screenshot-leak-checker': [
    { label: 'red, GPS photo', run: upload('sample-gps.jpg') },
    { label: 'green, clean PNG', run: upload('sample.png') },
  ],
  'dns-leak-test': [{ run: async (p) => { await p.getByRole('button', { name: /run dns leak test/i }).first().click(); }, timeout: 30_000 }],
  'privacy-quiz': [{ kind: 'quiz', run: answerQuiz, timeout: 30_000 }],
  'browser-privacy': [{ run: async (p) => { await p.getByRole('button', { name: /run privacy audit/i }).first().click(); }, timeout: 30_000 }],
  'url-analyzer': [{ run: async (p) => {
    await p.locator('input[type="text"], input[type="url"]').first().pressSequentially('http://paypa1.com/login');
    await p.getByRole('button', { name: 'Analyze', exact: true }).click();
  } }],
  'metadata-viewer': [{ label: 'red, GPS photo', run: upload('sample-gps.jpg') }],
  'cookie-analyzer': [{ run: async (p) => {
    await p.locator('input[type="url"], input[type="text"]').first().fill('https://example.com');
    await p.getByRole('button', { name: 'Scan', exact: true }).click();
  }, timeout: 60_000 }],
};

const TOOL_PAGES: Array<{ site: 'free' | 'pro'; path: string; engine: string }> = JSON.parse(fs.readFileSync(path.join(FIX, 'tool-pages.json'), 'utf-8'));

/** One published report card per grade, A to F (first by file name), besides the two with their own words. */
function reportCards(): Array<{ grade: string; domain: string }> {
  const own = new Set(['google.com', 'apple.com']);
  const byGrade = new Map<string, string>();
  for (const file of fs.readdirSync(SITES).filter((f) => f.endsWith('.json')).sort()) {
    const site = JSON.parse(fs.readFileSync(path.join(SITES, file), 'utf-8'));
    const grade: string | undefined = site.grade?.grade;
    if (!grade || byGrade.has(grade) || site.editorial?.status !== 'published' || own.has(site.domain)) continue;
    byGrade.set(grade, site.domain);
  }
  return ['A', 'B', 'C', 'D', 'F'].flatMap((grade) => (byGrade.has(grade) ? [{ grade, domain: byGrade.get(grade)! }] : []));
}

/** ALL=1 runs every tool page; by default one page per engine. */
const seen = new Set<string>();
const CASES: Case[] = [
  ...TOOL_PAGES
    .filter((t) => RUN[t.engine])
    .filter((t) => process.env.ALL === '1' || (!seen.has(t.engine) && seen.add(t.engine)))
    .flatMap((t) => RUN[t.engine].map((r) => ({
      name: `${t.engine}${r.label ? `, ${r.label}` : ''} ${t.path}`,
      url: `${t.site === 'pro' ? PRO : FREE}${t.path}/`,
      kind: r.kind ?? 'action',
      run: r.run,
      timeout: r.timeout ?? 15_000,
    }))),
  ...reportCards().map(({ grade, domain }) => ({ name: `report card, grade ${grade} (${domain})`, url: `${FREE}/site/${domain}/`, kind: 'report-card' as const, run: async () => {}, timeout: 15_000 })),
  { name: 'report card, own words (google.com)', url: `${FREE}/site/google.com/`, kind: 'report-card', run: async () => {}, timeout: 15_000 },
  { name: 'report card, own words (apple.com)', url: `${FREE}/site/apple.com/`, kind: 'report-card', run: async () => {}, timeout: 15_000 },
  // A calculator's answer is a next step: change a setting so the result is "Your result".
  { name: 'calculator (GDPR risk)', url: `${FREE}/calculators/gdpr/gdpr-compliance-risk-calculator/`, kind: 'calculator', run: changeSetting, timeout: 10_000 },
  { name: 'calculator (browser privacy risk)', url: `${FREE}/calculators/browser-privacy/browser-privacy-risk-calculator/`, kind: 'calculator', run: changeSetting, timeout: 10_000 },
];

const { userAgent: ANDROID_UA, isMobile, hasTouch, deviceScaleFactor } = devices['Pixel 7'];
const ANDROID = { userAgent: ANDROID_UA, isMobile, hasTouch, deviceScaleFactor };
const DESKTOP = { userAgent: devices['Desktop Chrome'].userAgent, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

interface Device { label: string; slug: string; ua: 'desktop' | 'android'; small: boolean; use: Record<string, unknown> }
const DEVICES: Device[] = [
  { label: 'desktop 1280x800', slug: 'desktop-1280x800', ua: 'desktop', small: false, use: { ...DESKTOP, viewport: { width: 1280, height: 800 } } },
  { label: 'desktop UA 390x844', slug: 'desktop-390x844', ua: 'desktop', small: false, use: { ...DESKTOP, viewport: { width: 390, height: 844 } } },
  { label: 'Android 390x844', slug: 'android-390x844', ua: 'android', small: false, use: { ...ANDROID, viewport: { width: 390, height: 844 } } },
  { label: 'Android 360x640', slug: 'android-360x640', ua: 'android', small: true, use: { ...ANDROID, viewport: { width: 360, height: 640 } } },
];

const rows: Array<Record<string, unknown>> = [];

/** Let the last layout land: two animation frames, not a fixed wait. */
const frames = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

/** Where the card's parts sit in the viewport right now. */
function measureCard(page: Page) {
  return page.evaluate(({ card: cardSel, button: buttonSel, foot: footSel, share: shareSel, report: reportSel }) => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const inside = (r: DOMRect | undefined) => !!r && r.width > 0 && r.height > 0 && r.top >= -0.5 && r.left >= -0.5 && r.bottom <= vh + 0.5 && r.right <= vw + 0.5;
    const nameOf = (el: Element | null) => (el ? `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : ''}` : 'nothing');
    const card = document.querySelector(cardSel);
    const button = card?.querySelector(buttonSel) ?? document.querySelector(buttonSel);
    const b = button?.getBoundingClientRect();
    const at = b ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
    const hit = !!button && !!at && (at === button || button.contains(at));
    const f = (card?.querySelector(footSel) ?? document.querySelector(footSel))?.getBoundingClientRect();
    const share = (card?.querySelector(shareSel) ?? document.querySelector(shareSel))?.getBoundingClientRect();
    // The report starts at its label; a page without one (a report card) starts its report with whatever follows the card.
    let report: Element | null | undefined = document.querySelector(reportSel);
    let reportFrom = reportSel;
    if (!report && card) {
      let el: Element | null = card;
      while (el && !el.nextElementSibling) el = el.parentElement;
      report = el?.nextElementSibling;
      reportFrom = `after the card (${nameOf(report ?? null)})`;
    }
    const r = report?.getBoundingClientRect();
    return {
      viewport: `${vw}x${vh}`,
      scrollY: Math.round(window.scrollY),
      placed: card?.getAttribute('data-result-placed') ?? null,
      tone: card?.getAttribute('data-tone') ?? null,
      cardTop: card ? Math.round(card.getBoundingClientRect().top) : null,
      buttonTop: b ? Math.round(b.top) : null,
      buttonBottom: b ? Math.round(b.bottom) : null,
      buttonInside: inside(b),
      buttonHit: hit,
      hitBy: button && !hit ? nameOf(at) : null,
      footBottom: f ? Math.round(f.bottom) : null,
      footInside: inside(f),
      shareTop: share ? Math.round(share.top) : null,
      reportTop: r ? Math.round(r.top) : null,
      reportFrom: report ? reportFrom : null,
      scrollNeeded: b ? Math.max(0, Math.round(b.bottom - vh), Math.round(-b.top)) : null,
    };
  }, { card: CARD, button: BUTTON, foot: FOOT, share: SHARE, report: REPORT });
}

/** Every visible next-step button on a calculator page, and whether it is fully on screen and tappable. */
function measureNextSteps(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    return [...document.querySelectorAll<HTMLElement>('[data-next-step]')]
      .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
      .map((el) => {
        const r = el.getBoundingClientRect();
        const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return {
          which: el.getAttribute('data-next-step') || el.textContent?.trim().slice(0, 40) || '',
          top: Math.round(r.top),
          bottom: Math.round(r.bottom),
          inside: r.width > 0 && r.height > 0 && r.top >= -0.5 && r.left >= -0.5 && r.bottom <= vh + 0.5 && r.right <= vw + 0.5,
          hit: !!at && (at === el || el.contains(at)),
        };
      });
  });
}

async function screenshot(page: Page, slug: string, name: string) {
  fs.mkdirSync(OUT, { recursive: true });
  await page.screenshot({ path: path.join(OUT, `${slug}-${name.replace(/[^a-z0-9]+/gi, '-').replace(/-$/, '')}.png`) });
}

/** A hard check stops the case; a soft one is reported, logged, and the case goes on. */
function check(soft: boolean, ok: boolean, message: string) {
  if (soft) {
    if (!ok) {
      console.log(`[soft] ${message}`);
      test.info().annotations.push({ type: 'soft', description: message });
    }
    expect.soft(ok, message).toBe(true);
  } else {
    expect(ok, message).toBe(true);
  }
}

async function checkCard(page: Page, device: Device, c: Case) {
  const found = await page.locator(`${CARD}[data-result-placed]`).first().waitFor({ state: 'attached', timeout: c.timeout }).then(() => true, () => false);
  await frames(page);
  const m = await measureCard(page);
  const shareAboveReport = m.shareTop === null || m.reportTop === null ? null : m.shareTop < m.reportTop;
  rows.push({ device: device.label, ua: device.ua, case: c.name, kind: c.kind, url: c.url, found, ...m, shareAboveReport });
  await screenshot(page, device.slug, c.name);

  const at = `${c.name} @ ${device.label}`;
  expect(found, `${at}: the result card placed itself (data-result-placed)`).toBe(true);
  // On the smallest phone, a result that is there on page load may leave its button under the fold; the footnote may not fit anywhere.
  const buttonSoft = device.small && c.kind === 'on-load';
  check(buttonSoft, m.buttonInside, `${at}: upgrade button fully on screen (placed: ${m.placed}; needs ${m.scrollNeeded}px of scrolling)`);
  check(buttonSoft, m.buttonHit, `${at}: a tap at the upgrade button's centre lands on it, not on ${m.hitBy}`);
  check(device.small, m.footInside, `${at}: the subscription footnote fully on screen (bottom ${m.footBottom} of ${m.viewport})`);
  if (m.shareTop === null) {
    // Some results have nothing to share (a DNS baseline, a browser that exposes no permissions).
    test.info().annotations.push({ type: 'note', description: `${at}: no share row` });
  } else {
    expect(shareAboveReport, `${at}: "Share your result" (top ${m.shareTop}) above the report (${m.reportFrom}, top ${m.reportTop})`).toBe(true);
  }
}

async function checkNextStep(page: Page, device: Device, c: Case) {
  // The page may scroll or slide a bar in: look each frame until one is fully on screen, or time runs out.
  const deadline = Date.now() + c.timeout;
  let steps = await measureNextSteps(page);
  while (!steps.some((s) => s.inside && s.hit) && Date.now() < deadline) {
    await frames(page);
    steps = await measureNextSteps(page);
  }
  const shown = steps.find((s) => s.inside && s.hit) ?? null;
  const scrollY = await page.evaluate(() => Math.round(window.scrollY));
  rows.push({ device: device.label, ua: device.ua, case: c.name, kind: c.kind, url: c.url, found: steps.length > 0, scrollY, nextSteps: steps, onScreen: shown?.which ?? null });
  await screenshot(page, device.slug, c.name);

  const at = `${c.name} @ ${device.label}`;
  expect(steps.length, `${at}: a next-step button ([data-next-step]) rendered`).toBeGreaterThan(0);
  expect(shown, `${at}: a next-step button fully on screen and tappable (found: ${JSON.stringify(steps)})`).not.toBeNull();
}

for (const device of DEVICES) {
  test.describe(device.label, () => {
    test.use(device.use);
    for (const c of CASES) {
      test(c.name, async ({ page }) => {
        test.setTimeout(c.timeout + 45_000);
        await page.goto(c.url);
        await c.run(page);
        if (c.kind === 'calculator') await checkNextStep(page, device, c);
        else await checkCard(page, device, c);
      });
    }
  });
}

test.describe('where the card places itself', () => {
  test.use({ ...DESKTOP, viewport: { width: 1280, height: 800 } });

  test('a viewport tall enough for the whole card: in-view, no scroll', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 3200 });
    await page.goto(`${FREE}/tools/children-safety/permission-checker/`);
    await page.getByRole('button', { name: /check permissions/i }).first().click();
    const card = page.locator(`${CARD}[data-result-placed]`).first();
    await card.waitFor({ state: 'attached', timeout: 15_000 });
    rows.push({ device: 'desktop 1280x3200', ua: 'desktop', case: 'behaviour: tall viewport', kind: 'action', ...(await measureCard(page)) });
    await screenshot(page, 'desktop-1280x3200', 'behaviour-tall-viewport');
    await expect(card).toHaveAttribute('data-result-placed', 'in-view');
  });

  test('a Pro subscriber inside the app: no ask, and the card places nothing', async ({ page }) => {
    // How the app says so (lib/in-app.ts): the flags it keeps for the tab, so the boot script marks <html data-ib-pro>.
    await page.addInitScript(() => {
      try {
        sessionStorage.setItem('ib-inapp', '1');
        sessionStorage.setItem('ib-pro', '1');
      } catch { /* storage blocked */ }
      document.documentElement?.setAttribute('data-ib-pro', '');
    });
    await page.goto(`${FREE}/tools/data-breach/password-strength-checker/`);
    await expect(page.locator('html')).toHaveAttribute('data-ib-pro', '');
    await page.locator('input[type="password"], input[type="text"]').first().pressSequentially('password123', { delay: 40 });
    const card = page.locator(CARD).first();
    await card.waitFor({ state: 'attached', timeout: 15_000 });
    // It either says the band is hidden or never places at all: give it the typing pause and a little more.
    await page.locator(`${CARD}[data-result-placed]`).first().waitFor({ state: 'attached', timeout: 3_000 }).catch(() => {});
    const m = await measureCard(page);
    rows.push({ device: 'desktop 1280x800', ua: 'desktop', case: 'behaviour: Pro in the app', kind: 'action', ...m });
    await screenshot(page, 'desktop-1280x800', 'behaviour-pro-in-app');
    await expect(page.locator('[data-result-cta]').first()).toBeHidden();
    expect([null, 'hidden'], `placed: ${m.placed}`).toContain(m.placed);
  });

  test('scrolling by hand while the DNS leak test runs: own-scroll', async ({ page }) => {
    test.setTimeout(75_000);
    await page.goto(`${FREE}/tools/vpn-privacy/dns-leak-test/`);
    await page.getByRole('button', { name: /run dns leak test/i }).first().click();
    const box = page.viewportSize()!;
    await page.mouse.move(box.width / 2, box.height / 2);
    await page.mouse.wheel(0, 600);
    const card = page.locator(`${CARD}[data-result-placed]`).first();
    const found = await card.waitFor({ state: 'attached', timeout: 30_000 }).then(() => true, () => false);
    const m = await measureCard(page);
    rows.push({ device: 'desktop 1280x800', ua: 'desktop', case: 'behaviour: own scroll during the DNS run', kind: 'action', found, ...m });
    await screenshot(page, 'desktop-1280x800', 'behaviour-own-scroll');
    // The test needs the DNS API; a local build may have none, so no result there is reported, not fatal.
    check(!found, found, 'DNS leak test: a result card appeared (needs the DNS API)');
    if (found) await expect(card).toHaveAttribute('data-result-placed', 'own-scroll');
  });
});

test.afterAll(() => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const file = path.join(process.cwd(), 'test-results', 'cta-visibility.json');
  const prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf-8')) : [];
  fs.writeFileSync(file, JSON.stringify([...prev, ...rows], null, 1));
});
