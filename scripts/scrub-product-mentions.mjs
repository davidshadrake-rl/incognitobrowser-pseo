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

/**
 * Structured slots where the brand IS the entity, not promotional prose.
 * Scrubbing these produced "a privacy-focused browser vs Brave vs Firefox"
 * comparison tables and a browser dropdown you couldn't pick the product
 * from. Never scrub them.
 *   products[].name        — the product's own row in a comparison
 *   verdict / intro        — comparison prose about the compared products
 *   inputs[].options[].label — calculator dropdown labels
 *   scores.* (keys)        — comparison score columns (keys are never scrubbed anyway)
 */
const PRESERVE_PATH = /(^|\.)products\[\d+\]\.name$|(^|\.)verdict(\.|\[|$)|^intro$|(^|\.)options\[\d+\]\.label$/;

function scrubValue(v, jsonPath = '') {
  if (typeof v === 'string') return PRESERVE_PATH.test(jsonPath) ? v : scrubString(v);
  if (Array.isArray(v)) return v.map((x, i) => scrubValue(x, `${jsonPath}[${i}]`));
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = scrubValue(v[k], jsonPath ? `${jsonPath}.${k}` : k);
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
      // Same PRESERVE_PATH exemption as the scrubber: brand in a comparison's
      // product row / verdict or a calculator dropdown is legitimate, not a
      // body-text injection, and must not fail the promote gate.
      const count = (function tally(v, p = '') {
        if (typeof v === 'string') return PRESERVE_PATH.test(p) ? 0 : (v.match(/Incognito\s+Browser/g) || []).length;
        if (Array.isArray(v)) return v.reduce((s, x, i) => s + tally(x, `${p}[${i}]`), 0);
        if (v && typeof v === 'object') {
          return Object.entries(v).reduce((s, [k, x]) => s + tally(x, p ? `${p}.${k}` : k), 0);
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
