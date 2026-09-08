/**
 * lib/tiers — Free / Pro split (decided 2026-09-07).
 *
 * Guards:
 *   - exactly the four agreed engines are Pro
 *   - the free deployment shows every engine; the Pro deployment only Pro ones
 *   - URL defaults are overridable and never trailing-slashed
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('free deployment (default) shows every engine, including pro ones as the free one-shot', async () => {
    const { engineVisibleInThisTier, IS_PRO_DEPLOYMENT, TIER } = await load({});
    expect(TIER).toBe('free');
    expect(IS_PRO_DEPLOYMENT).toBe(false);
    for (const e of [...PRO, ...FREE]) expect(engineVisibleInThisTier(e)).toBe(true);
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
    expect(PRO_BASE_URL).toBe('https://pro.incognitobrowser.io');
    expect(FREE_BASE_URL).toBe('https://incognitobrowser.io/resources');
    expect(proUrlFor('ad-tracking', 'cookie-tracker-scanner')).toBe('https://pro.incognitobrowser.io/tools/ad-tracking/cookie-tracker-scanner');
  });
  it('honours overrides and strips a trailing slash', async () => {
    const { PRO_BASE_URL, FREE_BASE_URL } = await load({ NEXT_PUBLIC_PRO_URL: 'https://pro.example/', NEXT_PUBLIC_FREE_URL: 'https://free.example/x/' });
    expect(PRO_BASE_URL).toBe('https://pro.example');
    expect(FREE_BASE_URL).toBe('https://free.example/x');
  });
});

describe('app/robots.ts', () => {
  it('free: allows all and points at the sitemap', async () => {
    await load({});
    const { default: robots } = await import('../app/robots');
    const r = robots();
    expect(r.rules).toEqual({ userAgent: '*', allow: '/' });
    expect(r.sitemap).toBe('https://incognitobrowser.io/resources/sitemap.xml');
  });
  it('pro: disallows everything and has no sitemap', async () => {
    await load({ NEXT_PUBLIC_TIER: 'pro' });
    const { default: robots } = await import('../app/robots');
    const r = robots();
    expect(r.rules).toEqual({ userAgent: '*', disallow: '/' });
    expect(r.sitemap).toBeUndefined();
  });
});
