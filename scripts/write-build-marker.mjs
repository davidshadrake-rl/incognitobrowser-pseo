#!/usr/bin/env node
/**
 * Writes out/.build-marker.json after a static export so the page guards can
 * prove WHICH build they are grading.
 *
 *   node scripts/write-build-marker.mjs --target static --tier free --base /resources
 *
 * Why: tests/rendered-pages.test.ts and tests/link-audit.test.ts run whenever
 * out/ exists. `npm run build` (Vercel, the deploy script) runs vitest FIRST,
 * so a leftover out/ from a different tier, a failed run, or an iCloud
 * conflict copy was silently graded with the free site's expectations —
 * 63 spurious failures in one case, and "passes" on a stale build in
 * another (audit 2026-09-08). `next build` deletes out/, so this must run
 * after the build, and the tests skip unless the marker says free/static.
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const out = path.resolve(opt('--out', 'out'));
if (!fs.existsSync(out)) { console.error(`write-build-marker: ${out} does not exist`); process.exit(2); }
const marker = {
  target: opt('--target', process.env.BUILD_TARGET || 'server'),
  tier: opt('--tier', process.env.NEXT_PUBLIC_TIER === 'pro' ? 'pro' : 'free'),
  basePath: opt('--base', process.env.BASE_PATH ?? '/resources'),
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(out, '.build-marker.json'), JSON.stringify(marker, null, 2) + '\n');
console.log(`build marker: ${JSON.stringify(marker)}`);
