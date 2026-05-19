#!/usr/bin/env node
/**
 * Bulk-promote every content file to status='published' with Darkpool
 * David as the byline. Use only after running:
 *
 *   node scripts/scrub-product-mentions.mjs --check   # must exit 0
 *
 * Refuses to run if the brand-mention check reports any remaining
 * problematic mentions in body text.
 *
 * Usage: node scripts/promote-all.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');

// Guardrail 1: brand scrub must be complete.
try {
  execSync('node scripts/scrub-product-mentions.mjs --check', {
    cwd: ROOT,
    stdio: 'inherit',
  });
} catch {
  console.error('\nBrand-mention check failed. Run scrub-product-mentions.mjs first.');
  process.exit(1);
}

const author = JSON.parse(
  fs.readFileSync(path.join(DATA, 'authors', 'darkpool-david.json'), 'utf-8')
);
const authorBlock = {
  name: author.name,
  bio: author.tagline || author.bio.slice(0, 160),
  credentials: author.credentials,
  profileUrl: author.profileUrl,
};

const SUBDIRS = ['checklists', 'guides', 'comparisons', 'templates', 'calculators', 'glossary'];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && e.name.endsWith('.json')) out.push(full);
  }
  return out;
}

const now = new Date().toISOString();
let promoted = 0;
let skipped = 0;

for (const sub of SUBDIRS) {
  const root = path.join(DATA, sub);
  if (!fs.existsSync(root)) continue;
  for (const fp of walk(root)) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(fp, 'utf-8'));
    } catch {
      skipped++;
      continue;
    }
    json.editorial = {
      status: 'published',
      reviewedAt: now,
      reviewedBy: author.name,
      notes:
        'Bulk-promoted after R3 product-mention scrub + editorial-gate rollout. Pseudonymous byline.',
    };
    if (!json.author || !json.author.name) {
      json.author = { ...authorBlock };
    }
    fs.writeFileSync(fp, JSON.stringify(json, null, 2) + '\n');
    promoted++;
  }
}

console.log(`\nPromoted: ${promoted} | Skipped: ${skipped}`);
