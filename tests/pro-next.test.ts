/**
 * The Pro the app is about to ship (data/brand.json `proNext`, owner
 * 2026-09-17: unlimited private VPN, Ad Block Pro, private downloads, private
 * AI chat; a free trial; a weekly Google Play subscription).
 *
 * It is NOT live. Until the owner says the build is out, `live` stays false
 * and no page may claim any of it — the site still tells visitors that Pro
 * blocks trackers, hides ad boxes and cleans photo metadata, and that it is
 * no VPN. These guards keep the two apart:
 *   - while `live` is false, nothing the visitor reads claims the new ones;
 *   - flipping `live` is not enough on its own: `pro` has to be rewritten to
 *     match, so the claims and the switch can never drift apart;
 *   - three things are never claimed at all (owner): the coin airdrops, the
 *     "3 million+" figure, and any price. The site names the trial only.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import brand from '../data/brand.json';

const ROOT = path.join(__dirname, '..');
const DIRS = ['app', 'components', 'lib', 'data'];
const EXTS = new Set(['.ts', '.tsx', '.json']);

function walk(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return EXTS.has(path.extname(e.name)) ? [rel] : [];
  });
}
const FILES = DIRS.flatMap(walk).filter((f) => f !== path.join('data', 'brand.json'));
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf-8');

/** Every line matching a pattern, file by file. */
function hits(re: RegExp): string[] {
  return FILES.flatMap((f) => read(f).split('\n').filter((l) => re.test(l)).map((l) => `${f}: ${l.trim().slice(0, 120)}`));
}

describe('the next Pro, recorded but not claimed', () => {
  it('is written down with its source, and switched off', () => {
    expect(brand.proNext.live, 'flip this only when the owner says the build is out').toBe(false);
    expect(brand.proNext.source).toMatch(/owner, 20\d\d-\d\d-\d\d/);
    expect(brand.proNext.features.map((f) => f.id)).toEqual(['pro-vpn', 'pro-ad-block', 'pro-downloads', 'pro-ai-chat']);
    for (const f of brand.proNext.features) expect(f.source, f.id).toMatch(/owner/);
  });

  it('flipping the switch without rewriting the claims fails here', () => {
    // `pro` is what every page claims (lib/card-copy.ts). While the new build
    // is unreleased the two lists differ, and that is the point: switching
    // `live` on with the old claims still in place would be a false page.
    const live = new Set(brand.pro.features.map((f) => f.id));
    const next = new Set(brand.proNext.features.map((f) => f.id));
    const same = live.size === next.size && [...live].every((id) => next.has(id));
    expect(brand.proNext.live ? same : !same, 'proNext.live is on, so brand.pro must list the same features').toBe(true);
  });

  it('while it is off, no page claims the VPN, the downloads or the AI chat', () => {
    if (brand.proNext.live) return;
    // A claim needs Pro and a verb of having. Denials ("Pro doesn't include a
    // VPN", "hiding it takes a VPN, which Pro doesn't include") are what the
    // site says today, and are the opposite of a claim.
    const CLAIM = /\b(Pro|the subscription)\b[^.]{0,80}\b(includes?|adds?|gives you|comes with|has)\b[^.]{0,60}\b(VPN|AI chat|private downloads)\b/i;
    const DENIES = /\b(doesn['\u2019]t|does not|isn['\u2019]t|never|without|no)\b[^.]{0,60}\b(include|VPN)\b/i;
    const claims = FILES.flatMap((f) => read(f).split('\n')
      .filter((l) => CLAIM.test(l) && !DENIES.test(l))
      .map((l) => `${f}: ${l.trim().slice(0, 140)}`));
    expect(claims).toEqual([]);
    // "Uncensored" is the paywall's word for the AI chat, and ours nowhere.
    expect(hits(/\buncensored\b/i)).toEqual([]);
  });

  it('never claims what the owner ruled out: the coin, the 3 million figure, or a price', () => {
    // Case-sensitive "AirDrop" is Apple's feature, which the public Wi-Fi pages rightly name.
    expect(hits(/\bIncognito Coin\b|\bINC\b[^.]*\bairdrop|\bcoin airdrops?\b/i)).toEqual([]);
    expect(hits(/\b3 ?million\+? (people|users)/i)).toEqual([]);
    // Our own price only: comparison pages rightly list what other products cost,
    // and the CCPA calculators name a $25M revenue threshold.
    const OURS = /\bIncognito (Browser|Pro)\b/;
    const PRICE = /\$?\d+\.\d{2}\s*(\/|per )\s*(week|month|year)\b|\b(2\.49|9\.99)\b|\b75% off\b/i;
    expect(FILES.flatMap((f) => read(f).split('\n').filter((l) => PRICE.test(l) && OURS.test(l)).map((l) => `${f}: ${l.trim().slice(0, 120)}`))).toEqual([]);
    expect(brand.proNext.notClaimed.length).toBeGreaterThanOrEqual(3);
  });

  it('records the trial and the billing, which the site may say once it is live', () => {
    expect(brand.proNext.offer.trial).toMatch(/free trial/i);
    expect(brand.proNext.offer.billing).toMatch(/Google Play/);
    expect(brand.proNext.offer.sitePrice).toMatch(/never/i);
  });
});
