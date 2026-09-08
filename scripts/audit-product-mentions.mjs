#!/usr/bin/env node
/**
 * Audits every content JSON file for product-name leakage.
 *
 * Walks each file, recursively finds every string value that contains
 * "Incognito Browser" (case-insensitive, but not the standalone phrase
 * "incognito mode" which is a generic feature term).
 *
 * Writes `editorial/product-mentions.csv` with columns:
 *   file, json_path, context (160 chars)
 *
 * Editorial uses this list as their cleanup queue. A page should not be
 * promoted to `published` until every flagged mention has been either
 * removed or rewritten to a non-promotional, category-level reference.
 *
 * Usage: node scripts/audit-product-mentions.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'editorial');
const OUT_CSV = path.join(OUT_DIR, 'product-mentions.csv');

const SUBDIRS = ['checklists', 'guides', 'comparisons', 'templates', 'calculators', 'glossary'];

// Match the capitalized brand "Incognito Browser" — that's the form the
// generator was injecting as a product reference. Lowercase "incognito
// browser" appears in user-search keywords (e.g. "best incognito browser")
// and as a generic feature phrase ("dedicated incognito browser") — those
// are legitimate vocabulary, not product promo.
const PATTERN = /Incognito\s+Browser/;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

// Structured slots where the brand IS the entity (comparison product rows,
// comparison verdicts, calculator dropdown labels). These are legitimate
// placements, not body-text injection — mirror of PRESERVE_PATH in the scrubber.
const PRESERVE_PATH = /(^|\.)products\[\d+\]\.name$|(^|\.)verdict(\.|\[|$)|^intro$|(^|\.)options\[\d+\]\.label$/;

function findMentions(value, jsonPath, hits) {
  if (typeof value === 'string') {
    if (PATTERN.test(value) && !PRESERVE_PATH.test(jsonPath)) {
      hits.push({ jsonPath, context: value.slice(0, 240) });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findMentions(v, `${jsonPath}[${i}]`, hits));
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      // Also test keys — comparison tables use vendor names as keys.
      // We accept the brand appearing as a comparison-table column key,
      // which is legitimate marketing content (we ARE a marketing site
      // and a comparison column is clearly-labeled product positioning,
      // not stealth body-text injection).
      const nextPath = jsonPath ? `${jsonPath}.${k}` : k;
      if (
        PATTERN.test(k) &&
        !/\bvendors?\b|\bcompetitors?\b|\btable\b|\bproducts?\b|\bscores?\b|\bfeatures?\b|\bcomparison\b|\btools?\b|\boptions?\b/i.test(
          jsonPath
        )
      ) {
        // Key mention outside of an expected comparison-table location.
        hits.push({ jsonPath: nextPath + ' (key)', context: k });
      }
      findMentions(value[k], nextPath, hits);
    }
  }
}

function csvEscape(s) {
  if (s == null) return '';
  const str = String(s).replace(/\r?\n/g, ' ').replace(/\s+/g, ' ');
  return /[",]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

const rows = [['file', 'json_path', 'context']];
let totalMentions = 0;
let filesWithMentions = 0;
let totalFiles = 0;

for (const sub of SUBDIRS) {
  const root = path.join(DATA_DIR, sub);
  if (!fs.existsSync(root)) continue;
  for (const fp of walk(root)) {
    totalFiles++;
    let json;
    try {
      json = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
      continue;
    }
    const hits = [];
    findMentions(json, '', hits);
    if (hits.length > 0) {
      filesWithMentions++;
      totalMentions += hits.length;
      const rel = path.relative(ROOT, fp);
      for (const h of hits) {
        rows.push([rel, h.jsonPath, h.context]);
      }
    }
  }
}

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT_CSV, rows.map((r) => r.map(csvEscape).join(',')).join('\n') + '\n');

console.log(
  `Scanned: ${totalFiles} files | With mentions: ${filesWithMentions} | Total mentions: ${totalMentions}`
);
console.log(`CSV: ${path.relative(ROOT, OUT_CSV)}`);
