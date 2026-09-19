#!/usr/bin/env node
/**
 * Regenerate e2e/fixtures/tool-pages.json from the source of truth.
 *
 *   node scripts/gen-e2e-tool-pages.mjs          write it
 *   node scripts/gen-e2e-tool-pages.mjs --check  exit 1 if the committed file is stale
 *
 * Why this exists: that fixture was hand-maintained, and it drifted. It was
 * generated on 2026-09-16 and still recorded url-analyzer as a PRO engine.
 * url-analyzer moved to the free site on 2026-09-17 (lib/tiers.ts PRO_ENGINES),
 * so from then on e2e/cta-visibility.spec.ts built a Pro URL for it, got a 404,
 * and failed with "waiting for locator('input...')" — a timeout that reads like
 * a broken page rather than a test asking for a page that does not exist.
 * Twelve of those failures were sitting in the suite, and the pages themselves
 * were fine the whole time.
 *
 * A fixture that encodes a fact the code also encodes will drift. The fix is
 * not to correct it once; it is to derive it, and to fail when the derived
 * answer and the committed answer disagree — which tests/e2e-fixtures.test.ts
 * now does on every run.
 *
 * Source of truth:
 *   path   data/tools/<niche>/<slug>.json      -> /tools/<niche>/<slug>
 *   engine that file's toolEngine
 *   site   lib/tiers.ts PRO_ENGINES            -> 'pro' | 'free'
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'e2e', 'fixtures', 'tool-pages.json');

/** Read PRO_ENGINES out of lib/tiers.ts rather than duplicating the list here. */
export function proEngines() {
  const src = readFileSync(join(ROOT, 'lib', 'tiers.ts'), 'utf-8');
  const block = /PRO_ENGINES\s*=\s*new Set<string>\(\[([\s\S]*?)\]\)/.exec(src);
  if (!block) throw new Error('could not find PRO_ENGINES in lib/tiers.ts — this generator is now guessing, which is worse than failing');
  const names = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  if (!names.length) throw new Error('PRO_ENGINES parsed as empty — refusing to mark every tool free');
  return new Set(names);
}

export function buildToolPages() {
  const pro = proEngines();
  const toolsDir = join(ROOT, 'data', 'tools');
  const rows = [];
  for (const niche of readdirSync(toolsDir, { withFileTypes: true })) {
    if (!niche.isDirectory()) continue;
    for (const file of readdirSync(join(toolsDir, niche.name))) {
      if (!file.endsWith('.json')) continue;
      const data = JSON.parse(readFileSync(join(toolsDir, niche.name, file), 'utf-8'));
      const engine = data.toolEngine;
      if (!engine) continue; // a page with no engine renders no result card
      rows.push({
        site: pro.has(engine) ? 'pro' : 'free',
        path: `/tools/${data.niche}/${data.slug}`,
        engine,
      });
    }
  }
  // Stable order so the committed file only changes when the facts change.
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return rows;
}

/**
 * Everything below runs ONLY when this file is executed as a script.
 *
 * Without this guard, importing it for its two exported functions also ran the
 * CLI body — and the `else` branch WRITES the fixture. tests/e2e-fixtures.test.ts
 * imports those functions, so the act of loading the test regenerated the very
 * file the test then compared against. The guard healed its own subject and
 * passed unconditionally: mutating the fixture to the stale values it was
 * written to catch still reported 3/3 green.
 *
 * That is the failure this repo keeps finding in different costumes — a check
 * that cannot fail. It is worth stating plainly: a module with a side effect at
 * import time is not safely importable, and a test that imports it is not
 * testing what it thinks.
 */
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (!isMain) {
  // Imported for buildToolPages()/proEngines(). Do nothing else.
} else {

const rows = buildToolPages();
const json = JSON.stringify(rows, null, 2) + '\n';

if (process.argv.includes('--check')) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf-8') : '';
  if (current !== json) {
    console.error('e2e/fixtures/tool-pages.json is STALE. Run: node scripts/gen-e2e-tool-pages.mjs');
    process.exit(1);
  }
  console.log(`tool-pages.json is current (${rows.length} pages)`);
} else {
  writeFileSync(OUT, json);
  const byTier = rows.reduce((a, r) => ((a[r.site] = (a[r.site] || 0) + 1), a), {});
  console.log(`wrote ${rows.length} tool pages to e2e/fixtures/tool-pages.json`, byTier);
}

}
