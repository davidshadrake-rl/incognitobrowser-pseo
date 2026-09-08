/**
 * lib/tiers — Free / Pro split (decided 2026-09-07).
 *
 * Guards:
 *   - exactly the four agreed engines are Pro
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

const PRO = ['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer'];
const FREE = ['whats-my-ip', 'password-strength', 'password-generator', 'hash-generator', 'useragent-analyzer', 'permission-checker', 'privacy-quiz', 'text-encryption'];

describe('tierOfEngine', () => {
  it('marks exactly the four agreed engines as pro', async () => {
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
    expect(PRO_BASE_URL).toBe('https://incognitobrowser-pro.vercel.app');
    expect(FREE_BASE_URL).toBe('https://incognitobrowser-pseo.vercel.app');
    expect(proUrlFor('ad-tracking', 'cookie-tracker-scanner')).toBe('https://incognitobrowser-pro.vercel.app/tools/ad-tracking/cookie-tracker-scanner');
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
  it('carries source/medium/campaign/content/term in the install referrer, source by tier', async () => {
    vi.resetModules(); delete process.env.NEXT_PUBLIC_TIER;
    const { playUrl, parsePlayReferrer } = await import('../lib/play');
    const u = playUrl({ medium: 'cta', campaign: 'whats-my-ip', content: 'vpn-privacy', term: 'tool' });
    expect(u.startsWith('https://play.google.com/store/apps/details?id=com.androidbull.incognito.browser')).toBe(true);
    expect(parsePlayReferrer(u)).toEqual({ utm_source: 'resources', utm_medium: 'cta', utm_campaign: 'whats-my-ip', utm_content: 'vpn-privacy', utm_term: 'tool' });
    vi.resetModules(); process.env.NEXT_PUBLIC_TIER = 'pro';
    const pro = await import('../lib/play');
    expect(pro.parsePlayReferrer(pro.playUrl({ medium: 'site', campaign: 'header' })).utm_source).toBe('pro');
    delete process.env.NEXT_PUBLIC_TIER;
  });
});
