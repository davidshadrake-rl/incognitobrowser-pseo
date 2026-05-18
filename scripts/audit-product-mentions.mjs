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

// Match "Incognito Browser" as a product name — case-insensitive but requires
// "browser" after "incognito", which excludes the generic feature "incognito mode".
const PATTERN = /incognito\s+browser/i;

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

function findMentions(value, jsonPath, hits) {
  if (typeof value === 'string') {
    if (PATTERN.test(value)) {
      hits.push({ jsonPath, context: value.slice(0, 240) });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => findMentions(v, `${jsonPath}[${i}]`, hits));
  } else if (value && typeof value === 'object') {
    for (const k of Object.keys(value)) {
      findMentions(value[k], jsonPath ? `${jsonPath}.${k}` : k, hits);
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
