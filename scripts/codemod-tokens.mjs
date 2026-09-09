#!/usr/bin/env node
/**
 * Design-token codemod (DESIGN-SPEC section 2.3), PR1.
 *
 * Rewrites the ad-hoc hex / stock-Tailwind colour utilities in app/ and
 * components/ to the named tokens declared in app/globals.css. Idempotent:
 * every rule maps a legacy spelling to a token spelling that no rule matches,
 * so running it twice is a no-op. Never touches tests/, data/, lib/ or
 * anything outside the two source trees.
 *
 *   node scripts/codemod-tokens.mjs          # rewrite, print per-pattern counts
 *   node scripts/codemod-tokens.mjs --dry    # count only
 *
 * The literal table from the spec runs first. A generic sweep follows for the
 * stragglers the table did not name (orange/lime/-300/-500 tints, legend dots,
 * hover:text-[#cfcfcf]) so the post-codemod grep in the spec returns nothing.
 * `rounded-full` is deliberately NOT here: it stays on status dots, avatars
 * and progress bars and is removed by hand from buttons, links and chips.
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '..');
const SRC_DIRS = ['app', 'components'];
const EXT = new Set(['.tsx', '.ts', '.jsx', '.js', '.mdx']);
const DRY = process.argv.includes('--dry');

/** Status-colour families → token names. */
const FAMILY = {
  green: 'ok', lime: 'ok',
  yellow: 'warn', amber: 'warn', orange: 'warn',
  red: 'danger',
  blue: 'info', purple: 'info',
};

/** [label, regex, replacement] — applied in order, all occurrences. */
const RULES = [
  // ---- spec table, literally ------------------------------------------------
  ['text-[#B8B8D4]/(50|60|70) -> text-t3', /text-\[#B8B8D4\]\/(50|60|70)\b/g, 'text-t3'],
  ['text-[#B8B8D4] -> text-t2', /text-\[#B8B8D4\]/g, 'text-t2'],
  ['bg-[#0a0a0a], bg-[#191b1c] -> bg-s0', /bg-\[#(0a0a0a|191b1c)\]/g, 'bg-s0'],
  ['bg-[#2b2b36] -> bg-s1', /bg-\[#2b2b36\]/g, 'bg-s1'],
  ['border-white/10, border-white/15 -> border-b1', /border-white\/1[05]\b/g, 'border-b1'],
  ['border-white/(25|30|40) -> border-b2', /border-white\/(25|30|40)\b/g, 'border-b2'],
  ['border-white/[0.08], border-white/5 -> border-hair', /border-white\/(\[0\.08\]|5\b)/g, 'border-hair'],
  ['text-green-400, text-green-300 -> text-ok', /text-green-(400|300)\b/g, 'text-ok'],
  ['text-yellow-400, text-amber-400, text-amber-300 -> text-warn', /text-(yellow-400|amber-400|amber-300)\b/g, 'text-warn'],
  ['text-red-400, text-red-300 -> text-danger', /text-red-(400|300)\b/g, 'text-danger'],
  ['text-blue-400, text-purple-300, text-purple-400 -> text-info', /text-(blue-400|purple-300|purple-400)\b/g, 'text-info'],
  ['bg-{family}-500/(10|15) -> bg-{token}-dim', /bg-(green|red|yellow|blue|purple|amber|orange|lime)-500\/(10|15)\b/g, (_, f) => `bg-${FAMILY[f]}-dim`],
  ['border-{family}-500/(20|30) -> border-{token}/30', /border-(green|red|yellow|blue)-500\/(20|30)\b/g, (_, f) => `border-${FAMILY[f]}/30`],

  // ---- stragglers the table did not name (same semantics) -------------------
  ['text-[#cfcfcf] -> text-t2', /text-\[#cfcfcf\]/g, 'text-t2'],
  ['text-[#191b1c] -> text-s0', /text-\[#191b1c\]/g, 'text-s0'],
  ['border-{amber|orange|lime|purple}-500/(20|30) -> border-{token}/30', /border-(amber|orange|lime|purple)-500\/(20|30)\b/g, (_, f) => `border-${FAMILY[f]}/30`],
  ['bg-{family}-500/[0.06], /5 -> bg-{token}-dim', /bg-(green|red|yellow|blue|purple|amber|orange|lime)-500\/(\[0\.06\]|5\b)/g, (_, f) => `bg-${FAMILY[f]}-dim`],
  // generic sweep: any remaining utility on a status family keeps its prefix + opacity suffix
  ['generic {util}-{family}-{n}[/x] -> {util}-{token}[/x]',
    /\b((?:[a-z-]+:)*)(bg|text|border|border-[trblxy]|ring|from|to|via|fill|stroke|divide|shadow|outline|placeholder|accent|caret|decoration)-(green|red|yellow|blue|purple|amber|orange|lime)-\d{3}(\/(?:\d+|\[[\d.]+\]))?/g,
    (_, variants, util, f, suffix = '') => `${variants}${util}-${FAMILY[f]}${suffix}`],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(p, out);
    } else if (EXT.has(path.extname(entry.name))) {
      out.push(p);
    }
  }
  return out;
}

const files = SRC_DIRS.flatMap((d) => (fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : []));
const before = new Map(RULES.map(([label]) => [label, 0]));
const after = new Map(RULES.map(([label]) => [label, 0]));
let changedFiles = 0;

for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (/^(tests|data)\//.test(rel)) continue; // belt and braces: never edit tests/ or data/
  const src = fs.readFileSync(file, 'utf8');
  let out = src;
  for (const [label, re, rep] of RULES) {
    const n = (out.match(re) || []).length;
    before.set(label, before.get(label) + n);
    if (n) out = out.replace(re, rep);
  }
  for (const [label, re] of RULES) after.set(label, after.get(label) + (out.match(re) || []).length);
  if (out !== src) {
    changedFiles++;
    if (!DRY) fs.writeFileSync(file, out);
  }
}

const width = Math.max(...RULES.map(([l]) => l.length));
console.log(`${DRY ? '[dry run] ' : ''}${files.length} files scanned, ${changedFiles} ${DRY ? 'would change' : 'changed'}\n`);
console.log(`${'pattern'.padEnd(width)}  before  after`);
let total = 0;
for (const [label] of RULES) {
  total += before.get(label);
  console.log(`${label.padEnd(width)}  ${String(before.get(label)).padStart(6)}  ${String(after.get(label)).padStart(5)}`);
}
console.log(`${'total'.padEnd(width)}  ${String(total).padStart(6)}`);
