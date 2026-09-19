/**
 * lib/tiers — Free / Pro split (decided 2026-09-07).
 *
 * Guards:
 *   - exactly the three agreed engines are Pro
 *   - the free deployment shows only free engines; the Pro deployment only Pro ones
 *     (2026-09-08: "pro tools are still in the free privacy tools catalogue" → clean split)
 *   - URL defaults are overridable and never trailing-slashed
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';

async function load(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const k of ['NEXT_PUBLIC_TIER', 'NEXT_PUBLIC_PRO_URL', 'NEXT_PUBLIC_FREE_URL']) delete process.env[k];
  for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
  return import('../lib/tiers');
}
afterEach(() => { vi.resetModules(); });

const PRO = ['cookie-analyzer', 'browser-privacy', 'metadata-viewer'];
const FREE = ['whats-my-ip', 'password-strength', 'password-generator', 'hash-generator', 'useragent-analyzer', 'permission-checker', 'privacy-quiz', 'text-encryption', 'url-analyzer'];

describe('tierOfEngine', () => {
  it('marks exactly the three agreed engines as pro', async () => {
    const { tierOfEngine, PRO_ENGINES } = await load({});
    expect([...PRO_ENGINES].sort()).toEqual([...PRO].sort());
    for (const e of PRO) expect(tierOfEngine(e)).toBe('pro');
    for (const e of FREE) expect(tierOfEngine(e)).toBe('free');
    expect(tierOfEngine(undefined)).toBe('free');
  });
});

describe('engineVisibleInThisTier', () => {
  it('free deployment (default) shows only free engines — Pro tools are not in the free catalogue', async () => {
    const { engineVisibleInThisTier, IS_PRO_DEPLOYMENT, TIER } = await load({});
    expect(TIER).toBe('free');
    expect(IS_PRO_DEPLOYMENT).toBe(false);
    for (const e of FREE) expect(engineVisibleInThisTier(e)).toBe(true);
    for (const e of PRO) expect(engineVisibleInThisTier(e)).toBe(false);
    expect(engineVisibleInThisTier(undefined)).toBe(true); // engine-less tool pages are free content
  });
  it('pro deployment shows only pro engines', async () => {
    const { engineVisibleInThisTier, IS_PRO_DEPLOYMENT } = await load({ NEXT_PUBLIC_TIER: 'pro' });
    expect(IS_PRO_DEPLOYMENT).toBe(true);
    for (const e of PRO) expect(engineVisibleInThisTier(e)).toBe(true);
    for (const e of FREE) expect(engineVisibleInThisTier(e)).toBe(false);
  });
  it('treats any value other than "pro" as free', async () => {
    const { TIER } = await load({ NEXT_PUBLIC_TIER: 'PRO ' });
    expect(TIER).toBe('free');
  });
});

describe('cross-deployment URLs', () => {
  it('has sane defaults and builds a Pro tool URL without /resources', async () => {
    const { PRO_BASE_URL, FREE_BASE_URL, proUrlFor } = await load({});
    // Defaults must be hosts that RESOLVE today (audit 2026-09-08: the old pro.incognitobrowser.io default shipped 502 dead links).
    expect(PRO_BASE_URL).toBe('https://206-189-186-34.nip.io/resources-pro');
    expect(FREE_BASE_URL).toBe('https://206-189-186-34.nip.io/resources');
    expect(proUrlFor('ad-tracking', 'cookie-tracker-scanner')).toBe('https://206-189-186-34.nip.io/resources-pro/tools/ad-tracking/cookie-tracker-scanner');
  });
  it('honours overrides and strips a trailing slash', async () => {
    const { PRO_BASE_URL, FREE_BASE_URL } = await load({ NEXT_PUBLIC_PRO_URL: 'https://pro.example/', NEXT_PUBLIC_FREE_URL: 'https://free.example/x/' });
    expect(PRO_BASE_URL).toBe('https://pro.example');
    expect(FREE_BASE_URL).toBe('https://free.example/x');
  });
});

describe('app/robots.ts', () => {
  it('free: allows all except the ad-blocker bait files, and points at the sitemap', async () => {
    await load({});
    const { default: robots } = await import('../app/robots');
    const r = robots();
    // /adtest/* are deliberately ad-shaped bait files for the Ad-Blocker Test, never content.
    expect(r.rules).toEqual({ userAgent: '*', allow: '/', disallow: '/adtest/' });
    expect(r.sitemap).toBe('https://incognitobrowser.io/resources/sitemap.xml');
  });
  it('pro: crawlable (so the noindex is read) and has no sitemap; X-Robots-Tag header carries noindex', async () => {
    await load({ NEXT_PUBLIC_TIER: 'pro' });
    const { default: robots } = await import('../app/robots');
    const r = robots();
    expect(r.rules).toEqual({ userAgent: '*', allow: '/' });
    expect(r.sitemap).toBeUndefined();
    const cfg = fs.readFileSync('next.config.ts', 'utf-8');
    expect(cfg).toMatch(/IS_PRO \? \[\{ key: "X-Robots-Tag", value: "noindex, follow" \}\]/);
  });
});

describe('isToolVisible / isToolListed (lib/content) follow the tier', () => {
  async function loadContent(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const k of ['NEXT_PUBLIC_TIER']) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    return import('../lib/content');
  }
  it('free: free tools visible, Pro tools not; drafted duplicates are visible but not listed', async () => {
    const { isToolVisible, isToolListed } = await loadContent({});
    expect(isToolVisible('vpn-privacy', 'whats-my-ip')).toBe(true);
    expect(isToolVisible('ad-tracking', 'cookie-tracker-scanner')).toBe(false);
    expect(isToolListed('vpn-privacy', 'whats-my-ip')).toBe(true);
    expect(isToolListed('email-privacy', 'privacy-score-quiz')).toBe(false); // deliberate draft duplicate
  });
  it('pro: only Pro tools visible', async () => {
    const { isToolVisible } = await loadContent({ NEXT_PUBLIC_TIER: 'pro' });
    expect(isToolVisible('ad-tracking', 'cookie-tracker-scanner')).toBe(true);
    expect(isToolVisible('vpn-privacy', 'whats-my-ip')).toBe(false);
  });
});

describe('playUrl attribution', () => {
  // lib/play.ts playUrl() always returns a real Play link. It backs the
  // header, footer and home-hero "install the free app" buttons directly
  // (app/layout.tsx, app/page.tsx), so it must never be redirected — the
  // upgrade-CTA demo switch below lives in components/UpgradeButtons.tsx
  // instead, precisely so it cannot touch this function (owner, 2026-09-17:
  // an earlier version of the switch lived here and silently redirected the
  // free-app install links too — caught before it shipped).
  it('carries source/medium/campaign/content/term in the install referrer, source by tier', async () => {
    vi.resetModules(); delete process.env.NEXT_PUBLIC_TIER;
    const { playUrl, parsePlayReferrer } = await import('../lib/play');
    const u = playUrl({ medium: 'cta', campaign: 'whats-my-ip', content: 'vpn-privacy', term: 'tool' });
    expect(u.startsWith('https://play.google.com/store/apps/details?id=com.androidbull.incognito.browser')).toBe(true);
    expect(parsePlayReferrer(u)).toEqual({ utm_source: 'resources', utm_medium: 'cta', utm_campaign: 'whats-my-ip', utm_content: 'vpn-privacy', utm_term: 'tool' });
    // A result card's button sends the benefit it sold as utm_content; the app team reads these ids as they are.
    for (const benefit of ['tracker-blocking', 'hides-ad-boxes', 'photo-cleaning']) {
      expect(parsePlayReferrer(playUrl({ medium: 'funnel', campaign: 'ad-blocker-test', content: benefit, term: 'guide' })).utm_content).toBe(benefit);
    }
    vi.resetModules(); process.env.NEXT_PUBLIC_TIER = 'pro';
    const pro = await import('../lib/play');
    expect(pro.parsePlayReferrer(pro.playUrl({ medium: 'site', campaign: 'header' })).utm_source).toBe('pro');
    delete process.env.NEXT_PUBLIC_TIER;
  });

  it('is never redirected by the UpgradeButtons demo switch', async () => {
    // Two separate modules, deliberately: importing UpgradeButtons (a 'use
    // client' component) must not change what playUrl() itself returns.
    await import('../components/UpgradeButtons');
    const { playUrl } = await import('../lib/play');
    expect(playUrl({ medium: 'site', campaign: 'header' })).toMatch(/^https:\/\/play\.google\.com\/store\/apps\/details/);
  });
});

/**
 * The upgrade-CTA demo switch (components/UpgradeButtons.tsx DEMO_UPGRADE_URL).
 *
 * This block used to be one assertion, `expect(DEMO_UPGRADE_URL).toBe(
 * 'https://staging.ufile.io/pricing')`, and that assertion was guarding the
 * wrong thing. The file it guards documents the rollback as "flip
 * DEMO_UPGRADE_URL back to '' — that one line is the whole rollback", and both
 * `npm run build` and scripts/deploy-api.sh run `vitest run` before they build
 * or deploy. So performing the documented one-line rollback failed the suite
 * and blocked the deploy: the guard made the demo impossible to turn off, and
 * whoever turned it off under pressure would have had to edit a test to ship.
 *
 * Which position the switch is in is an owner decision that changes day to
 * day; it is not something a test should hold down. What a test can hold down
 * is the property the demo was scoped on: ONE switch decides where every
 * upgrade ask goes, in either position, and no other route to the paywall
 * opens up beside it. These tests pass whether the demo URL is set or empty.
 */
describe('UpgradeButtons demo switch', () => {
  /** An anchor tag's href as the browser sees it, entities and all. */
  const hrefOf = (tag: string): string => (/\bhref="([^"]*)"/.exec(tag)?.[1] ?? '').replace(/&amp;/g, '&');

  /** Every upgrade CTA rendered in `html`, read off the anchor's own tag. */
  const upgradeHrefs = (html: string): string[] =>
    [...html.matchAll(/<a\b[^>]*\bdata-upgrade-from=[^>]*>/g)].map((m) => hrefOf(m[0]));

  const PLAY_CTA = /^https:\/\/play\.google\.com\/store\/apps\/details\?id=[^"]*referrer=utm_source%3D(resources|pro)%26utm_medium%3D/;

  /**
   * The switch's current value as a plain string. DEMO_UPGRADE_URL is a const,
   * so TypeScript gives it the literal type of whatever is set today and calls
   * a comparison with the other position dead code (TS2367) — which is exactly
   * how the old one-position assertion felt correct while it was blocking the
   * rollback. Reading it as a string keeps both branches below compilable in
   * either position.
   */
  const demoSwitch = async (): Promise<string> => (await import('../components/UpgradeButtons')).DEMO_UPGRADE_URL;

  it('has two positions and nothing in between: an absolute https URL, or empty', async () => {
    vi.resetModules();
    const demo = await demoSwitch();
    expect(typeof demo).toBe('string');
    // A relative or http:// value would send the ask somewhere the comment in
    // UpgradeButtons.tsx does not describe, and would not be a demo paywall.
    if (demo !== '') expect(demo).toMatch(/^https:\/\/\S+$/);
  });

  it('every upgrade button follows the one switch, wherever the ask sits', async () => {
    vi.resetModules();
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DEMO_UPGRADE_URL, UpgradeButtons } = await import('../components/UpgradeButtons');

    // One ask per place an ask appears (the `from` values UpgradeButtons takes),
    // so a surface that quietly built its own link would show up here.
    const hrefs = (['result', 'funnel', 'report-card', 'band', 'gate'] as const).flatMap((from) =>
      upgradeHrefs(renderToStaticMarkup(React.createElement(UpgradeButtons, {
        engine: 'cookie-analyzer', from, benefit: 'tracker-blocking', term: 'report-card', pageUrl: 'https://example.com/site/cnn.com/',
      }))),
    );
    expect(hrefs.length).toBe(5);

    if (DEMO_UPGRADE_URL) {
      // While the demo is on, all five are the same one value — no surface
      // keeps a Play link of its own, and none invents a different paywall.
      expect(new Set(hrefs)).toEqual(new Set([DEMO_UPGRADE_URL]));
    } else {
      // Rolled back: every ask is an attributed Play link again (the `from`
      // value picks the medium, so these differ from one another).
      for (const href of hrefs) expect(href).toMatch(PLAY_CTA);
    }
  });

  it('the desktop hand-off sends the same link the button does', async () => {
    // "Email me the link" and "Copy app link" hand over `play`, the same value
    // the button uses. If the switch ever reached the button but not these,
    // a visitor on a laptop would be mailed a different destination.
    vi.resetModules();
    const React = (await import('react')).default;
    const { renderToStaticMarkup } = await import('react-dom/server');
    const { DEMO_UPGRADE_URL, UpgradeButtons } = await import('../components/UpgradeButtons');
    const html = renderToStaticMarkup(React.createElement(UpgradeButtons, {
      engine: 'cookie-analyzer', from: 'result', benefit: 'tracker-blocking', pageUrl: 'https://example.com/site/cnn.com/',
    }));
    const [button] = upgradeHrefs(html);
    const mailto = hrefOf(/<a\b[^>]*href="mailto:[^>]*>/.exec(html)?.[0] ?? '');
    expect(button).toBeTruthy();
    expect(decodeURIComponent(mailto)).toContain(button);
    if (DEMO_UPGRADE_URL) expect(button).toBe(DEMO_UPGRADE_URL);
    else expect(button).toMatch(PLAY_CTA);
  });
});
