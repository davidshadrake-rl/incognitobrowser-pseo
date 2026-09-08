#!/usr/bin/env node
/**
 * Generates the first-party ad-blocker bait files under public/adtest/ from
 * the catalogue in lib/adblock-bait.ts.
 *
 *   - every script bait  → `window.__adtest=(window.__adtest||{});window.__adtest['<id>']=1;`
 *   - every image bait   → the canonical 43-byte transparent 1×1 GIF89a
 *
 * The directory is rebuilt from scratch so stale files never linger. The
 * generated files are committed: the static export copies public/ verbatim
 * and the test suite (tests/adblock-test.test.ts) asserts they exist and
 * carry the right bytes — a missing file would read as "blocked" (404) and
 * silently inflate every visitor's score.
 *
 * Usage — the catalogue is TypeScript; either of these works:
 *   node scripts/gen-adtest-bait.mjs        (Node ≥ 22.18: built-in type stripping)
 *   npx tsx scripts/gen-adtest-bait.mjs     (older Node)
 * tsx compiles the .ts as CommonJS (package.json has no "type"), so its
 * exports arrive under `default`; plain Node exposes them as named exports.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const mod = await import('../lib/adblock-bait.ts');
const catalogue = mod.NETWORK_BAITS ? mod : mod.default;
const { NETWORK_BAITS, GIF_1X1_BYTES, BAIT_ROOT, baitScriptSource } = catalogue;
if (!Array.isArray(NETWORK_BAITS) || typeof baitScriptSource !== 'function') {
  throw new Error('Could not load the bait catalogue from lib/adblock-bait.ts');
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'public', BAIT_ROOT.replace(/^\//, ''));

const gif = Buffer.from(GIF_1X1_BYTES);
if (gif.length !== 43 || gif.subarray(0, 6).toString('latin1') !== 'GIF89a' || gif[42] !== 0x3b) {
  throw new Error('GIF_1X1_BYTES is not the expected 43-byte GIF89a');
}

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

const prefix = BAIT_ROOT + '/';
let scripts = 0;
let images = 0;
for (const bait of NETWORK_BAITS) {
  if (!bait.path.startsWith(prefix)) throw new Error(`bait ${bait.id} is outside ${BAIT_ROOT}: ${bait.path}`);
  const rel = bait.path.slice(prefix.length);
  if (rel.split('/').some((seg) => seg === '' || seg === '.' || seg === '..')) throw new Error(`unsafe path for ${bait.id}: ${bait.path}`);
  const file = path.join(OUT_DIR, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (bait.kind === 'script') {
    if (!bait.path.endsWith('.js')) throw new Error(`script bait ${bait.id} must end in .js`);
    fs.writeFileSync(file, baitScriptSource(bait.id) + '\n', 'utf8');
    scripts += 1;
  } else {
    if (!bait.path.endsWith('.gif')) throw new Error(`image bait ${bait.id} must end in .gif (every image is a GIF89a)`);
    fs.writeFileSync(file, gif);
    images += 1;
  }
}

console.log(`Wrote ${scripts} script baits and ${images} image baits (${scripts + images} total) to ${path.relative(ROOT, OUT_DIR)}/`);
