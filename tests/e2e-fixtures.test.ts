/**
 * The E2E fixtures must describe the site as it is now.
 *
 * e2e/fixtures/tool-pages.json tells e2e/cta-visibility.spec.ts which tier each
 * tool page lives on, and it was hand-maintained. It was written on 2026-09-16
 * and still said url-analyzer was a PRO engine; that engine moved to the free
 * site on 2026-09-17. From then on the spec built a Pro URL for three pages,
 * got a 404, and failed with `waiting for locator('input[type="text"]...')` —
 * a timeout that reads like a broken input on a broken page. Twelve failures
 * sat in the suite, and the pages were correct the entire time.
 *
 * That is the expensive kind of test failure: it accuses the product, so
 * whoever reads it goes looking in the wrong place, and after a few rounds of
 * finding nothing the suite stops being believed.
 *
 * A fixture that restates a fact the code already holds will drift. So it is
 * generated (scripts/gen-e2e-tool-pages.mjs) and this asserts the committed
 * copy still matches what the source of truth produces — data/tools/**.json for
 * the paths and engines, lib/tiers.ts PRO_ENGINES for the tier.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');
const FIXTURE = join(ROOT, 'e2e', 'fixtures', 'tool-pages.json');

const { buildToolPages, proEngines } = await import('../scripts/gen-e2e-tool-pages.mjs' as string);

describe('e2e/fixtures/tool-pages.json', () => {
  it('matches what the source of truth produces', () => {
    const committed = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
    const derived = buildToolPages();
    // Compare as a path -> tier map so the message names the pages that drifted
    // rather than printing two 51-element arrays at each other.
    const asMap = (rows: Array<{ path: string; site: string; engine: string }>) =>
      Object.fromEntries(rows.map((r) => [r.path, `${r.site}:${r.engine}`]));
    expect(asMap(committed), 'stale — run: node scripts/gen-e2e-tool-pages.mjs').toEqual(asMap(derived));
  });

  it('every tier assignment agrees with lib/tiers.ts', () => {
    const pro = proEngines();
    const committed: Array<{ path: string; site: string; engine: string }> = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
    const wrong = committed.filter((r) => (pro.has(r.engine) ? 'pro' : 'free') !== r.site);
    expect(wrong.map((r) => `${r.path} is marked ${r.site} but ${r.engine} is ${pro.has(r.engine) ? 'pro' : 'free'}`)).toEqual([]);
  });

  it('is not empty and covers both tiers', () => {
    // A generator bug that produced [] would otherwise pass both checks above,
    // and the E2E suite would go quietly green by testing nothing.
    const committed: Array<{ site: string }> = JSON.parse(readFileSync(FIXTURE, 'utf-8'));
    expect(committed.length).toBeGreaterThan(30);
    expect(new Set(committed.map((r) => r.site))).toEqual(new Set(['free', 'pro']));
  });
});
