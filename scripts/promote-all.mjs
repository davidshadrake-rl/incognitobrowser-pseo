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

function loadProfile(slug) {
  return JSON.parse(fs.readFileSync(path.join(DATA, 'authors', `${slug}.json`), 'utf-8'));
}
const author = loadProfile('darkpool-david');
const authorBlock = {
  name: author.name,
  bio: author.tagline || author.bio.slice(0, 160),
  credentials: author.credentials,
  profileUrl: author.profileUrl,
  sameAs: author.sameAs && author.sameAs.length ? author.sameAs : undefined,
};

// Pseudonymous byline + named editor model. Every promoted page records
// the editor block so Article JSON-LD can attribute editorial review to
// the real-name editor (David Shadrake, LinkedIn-verified) without
// breaking the writer's pseudonymity.
const editorProfile = author.editorSlug ? loadProfile(author.editorSlug) : null;
const editorBlock = editorProfile
  ? {
      name: editorProfile.name,
      profileUrl: editorProfile.profileUrl,
      sameAs: editorProfile.sameAs && editorProfile.sameAs.length ? editorProfile.sameAs : undefined,
    }
  : null;

// tools included: they are hand-built, always indexable unless explicitly drafted.
// Omitting them left every tool page with no editorial block → isPublished=false
// → noindex + out of the sitemap in production. Never again.
const SUBDIRS = ['checklists', 'guides', 'comparisons', 'templates', 'calculators', 'glossary', 'tools'];

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
    // Preserve drafts. promote-all is for byline/profile restamps + bulk
    // publish of new content — it must NOT override files that an editor
    // (or the demote-overlap-duplicates script) intentionally set back to
    // 'draft'. Without this guard, the F4 doorway demotion gets reverted
    // every time we re-stamp the author block.
    const wasDraft = json.editorial?.status === 'draft';
    json.editorial = {
      status: wasDraft ? 'draft' : 'published',
      reviewedAt: wasDraft ? json.editorial?.reviewedAt || now : now,
      reviewedBy: wasDraft ? json.editorial?.reviewedBy || author.name : author.name,
      notes: wasDraft
        ? json.editorial?.notes || null
        : 'Bulk-promoted after R3 product-mention scrub + editorial-gate rollout. Pseudonymous byline.',
    };
    // Always restamp author + editor so re-runs pick up profile updates
    // (e.g., adding LinkedIn to the editor's sameAs).
    json.author = { ...authorBlock };
    if (editorBlock) json.editor = { ...editorBlock };
    fs.writeFileSync(fp, JSON.stringify(json, null, 2) + '\n');
    promoted++;
  }
}

console.log(`\nPromoted: ${promoted} | Skipped: ${skipped}`);
