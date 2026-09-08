#!/usr/bin/env node
/**
 * Backfills every content JSON file with `editorial.status = 'draft'`
 * and `author = null` if not already present.
 *
 * Idempotent. Skips files that already have an editorial block.
 * Skips `data/tools/` because tool data is rendered through different
 * pipeline (tool pages have static UI; not LLM-generated body text).
 *
 * Usage: node scripts/backfill-editorial.mjs [--dry-run]
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DRY = process.argv.includes('--dry-run');

const SUBDIRS = ['checklists', 'guides', 'comparisons', 'templates', 'calculators', 'glossary', 'tools'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && entry.name.endsWith('.json')) out.push(full);
  }
  return out;
}

let updated = 0;
let alreadyOk = 0;
let total = 0;

for (const sub of SUBDIRS) {
  const root = path.join(DATA_DIR, sub);
  if (!fs.existsSync(root)) continue;

  for (const fp of walk(root)) {
    total++;
    const raw = fs.readFileSync(fp, 'utf-8');
    let json;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      console.warn(`SKIP ${fp}: invalid JSON`);
      continue;
    }

    let changed = false;
    if (!json.editorial) {
      json.editorial = { status: 'draft', reviewedAt: null, reviewedBy: null, notes: null };
      changed = true;
    }
    if (!('author' in json)) {
      json.author = null;
      changed = true;
    }

    if (changed) {
      updated++;
      if (!DRY) fs.writeFileSync(fp, JSON.stringify(json, null, 2) + '\n');
    } else {
      alreadyOk++;
    }
  }
}

console.log(
  `${DRY ? '[DRY] ' : ''}Total: ${total} | Updated: ${updated} | Already OK: ${alreadyOk}`
);
