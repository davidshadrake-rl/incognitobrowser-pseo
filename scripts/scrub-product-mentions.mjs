#!/usr/bin/env node
/**
 * Bulk-rewrite "Incognito Browser" product mentions to category-level wording.
 *
 * Why: the 883 mentions across 391 files are the R3 quality-rater signal
 * we have to remove before promoting pages to indexable. Each replacement
 * is a deterministic, context-preserving rewrite — not an AI rewrite —
 * so we don't change article meaning, just the brand-name injection.
 *
 * Replacement rules apply in order; first match wins. The rules target
 * the exact patterns the generator was producing (see audit CSV).
 *
 * Idempotent: re-running on already-scrubbed files is a no-op.
 *
 * Usage:
 *   node scripts/scrub-product-mentions.mjs [--dry-run]
 *   node scripts/scrub-product-mentions.mjs --check   # exits 1 if any mentions remain
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');

const SUBDIRS = ['checklists', 'guides', 'comparisons', 'templates', 'calculators', 'glossary'];

/**
 * Ordered replacement rules. Each rule rewrites a specific way the
 * generator inserted the product name. The pattern after replacement
 * must still be a sensible English sentence — that's why we have
 * pattern-specific rules instead of a single global regex.
 *
 * The trailing rule is a fallback for any remaining bare "Incognito Browser"
 * that wasn't captured by a specific pattern.
 */
const RULES = [
  // "Download Incognito Browser and ..." -> "Use a privacy-focused browser and ..."
  [/(?:Download|Install)\s+Incognito Browser(?:\s+(?:and|to|for))?/gi, 'Use a privacy-focused browser '],

  // "Consider Incognito Browser for ..." -> "Consider a privacy-focused browser for ..."
  [/Consider Incognito Browser/gi, 'Consider a privacy-focused browser'],

  // "Use Incognito Browser..." -> "Use a privacy-focused browser..."
  [/Use Incognito Browser/gi, 'Use a privacy-focused browser'],

  // "browsers like Incognito Browser, Firefox..." -> "privacy-focused browsers like Firefox..."
  [/browsers like Incognito Browser,\s*/gi, 'privacy-focused browsers like '],

  // "such as Incognito Browser, X, Y" -> "such as X, Y" (when followed by other names)
  [/such as Incognito Browser,\s*/gi, 'such as '],

  // "Incognito Browser (X)" parens descriptor -> remove the brand portion
  [/Incognito Browser\s*\([^)]+\)/gi, 'a privacy-focused browser'],

  // "Incognito Browser - <descriptor>" headings/cards -> generic descriptor only
  [/Incognito Browser\s*[-–—]\s*([A-Za-z][^.,;\n"]+)/g, '$1'],

  // "with Incognito Browser" -> "with a privacy-focused browser"
  [/with Incognito Browser/gi, 'with a privacy-focused browser'],

  // "switching to Incognito Browser" -> "switching to a privacy-focused browser"
  [/switching to Incognito Browser/gi, 'switching to a privacy-focused browser'],

  // "Incognito Browser is/offers/provides ..." -> "Privacy-focused browsers ..."
  [/Incognito Browser (is|offers|provides|gives|includes|features)/gi, 'Privacy-focused browsers $1'],

  // "the Incognito Browser app" -> "a privacy-focused browser"
  [/the Incognito Browser(?:\s+app)?/gi, 'a privacy-focused browser'],

  // Catch-all for any remaining bare mention.
  [/\bIncognito Browser\b/g, 'a privacy-focused browser'],
];

function scrubString(s) {
  let out = s;
  for (const [re, repl] of RULES) out = out.replace(re, repl);
  // Clean up double spaces left by replacements.
  out = out.replace(/  +/g, ' ').replace(/\s+([.,;:])/g, '$1');
  return out;
}

function scrubValue(v) {
  if (typeof v === 'string') return scrubString(v);
  if (Array.isArray(v)) return v.map(scrubValue);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = scrubValue(v[k]);
    return out;
  }
  return v;
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

let totalFiles = 0;
let changedFiles = 0;
let remaining = 0;

for (const sub of SUBDIRS) {
  const root = path.join(DATA_DIR, sub);
  if (!fs.existsSync(root)) continue;
  for (const fp of walk(root)) {
    totalFiles++;
    const raw = fs.readFileSync(fp, 'utf-8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      continue;
    }
    if (CHECK) {
      // Count "Incognito Browser" mentions in string VALUES only.
      // Object keys (comparison-table vendor columns) are legitimate
      // and not counted as body-text injection.
      const count = (function tally(v) {
        if (typeof v === 'string') return (v.match(/Incognito\s+Browser/g) || []).length;
        if (Array.isArray(v)) return v.reduce((s, x) => s + tally(x), 0);
        if (v && typeof v === 'object') {
          return Object.values(v).reduce((s, x) => s + tally(x), 0);
        }
        return 0;
      })(json);
      remaining += count;
      continue;
    }
    const scrubbed = scrubValue(json);
    const newJson = JSON.stringify(scrubbed, null, 2) + '\n';
    const oldJson = JSON.stringify(json, null, 2) + '\n';
    if (newJson !== oldJson) {
      changedFiles++;
      if (!DRY) fs.writeFileSync(fp, newJson);
    }
  }
}

if (CHECK) {
  console.log(`Remaining "Incognito Browser" mentions in content JSON: ${remaining}`);
  process.exit(remaining > 0 ? 1 : 0);
}

console.log(
  `${DRY ? '[DRY] ' : ''}Files scanned: ${totalFiles} | Files changed: ${changedFiles}`
);
