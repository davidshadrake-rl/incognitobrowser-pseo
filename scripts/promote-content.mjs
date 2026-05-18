#!/usr/bin/env node
/**
 * Promote a content file to editorial.status = 'published'.
 *
 * REQUIRES: author.name must be set. The whole point of the gate is that a
 * named human is claiming responsibility for the page. Refuses if missing.
 *
 * Usage:
 *   node scripts/promote-content.mjs checklists browser-privacy privacy-hardening-checklist \
 *     --reviewer "David Shadrake" \
 *     --notes "Editorial pass complete; tool embeds added"
 *
 *   # Bulk from a newline-separated file of "type/niche/slug" lines:
 *   node scripts/promote-content.mjs --batch priority-50.txt --reviewer "David Shadrake"
 *
 * Status transitions:
 *   draft -> reviewed   (intermediate state, optional, no indexing yet)
 *   reviewed -> published (live in sitemap, indexable)
 *   draft -> published    (also allowed if reviewer trusts the page)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? fallback : process.argv[i + 1];
}

const reviewer = arg('--reviewer');
const notes = arg('--notes', null);
const targetStatus = arg('--status', 'published'); // 'reviewed' or 'published'
const batchFile = arg('--batch');

if (!reviewer) {
  console.error('Missing --reviewer "Your Name"');
  process.exit(1);
}

if (!['reviewed', 'published'].includes(targetStatus)) {
  console.error(`Invalid --status: ${targetStatus}. Must be 'reviewed' or 'published'.`);
  process.exit(1);
}

function promoteOne(type, niche, slug) {
  const fp = type === 'glossary'
    ? path.join(DATA_DIR, 'glossary', `${slug}.json`)
    : path.join(DATA_DIR, type, niche, `${slug}.json`);

  if (!fs.existsSync(fp)) {
    console.error(`MISSING ${fp}`);
    return false;
  }

  const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));

  if (targetStatus === 'published') {
    if (!data.author || !data.author.name) {
      console.error(`BLOCKED ${type}/${niche}/${slug}: author.name is required to publish. Edit the JSON to add an author block first.`);
      return false;
    }
  }

  data.editorial = {
    status: targetStatus,
    reviewedAt: new Date().toISOString(),
    reviewedBy: reviewer,
    notes: notes || data.editorial?.notes || null,
  };

  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n');
  console.log(`PROMOTED ${type}/${niche || ''}/${slug} -> ${targetStatus}`);
  return true;
}

let entries;
if (batchFile) {
  entries = fs
    .readFileSync(batchFile, 'utf-8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('/'));
} else {
  const [, , type, niche, slug] = process.argv;
  if (!type || (!slug && type !== 'glossary') || (type === 'glossary' && !niche)) {
    console.error('Usage: node scripts/promote-content.mjs <type> <niche> <slug> --reviewer "Name"');
    process.exit(1);
  }
  entries = type === 'glossary' ? [['glossary', '', niche]] : [[type, niche, slug]];
}

let ok = 0;
let fail = 0;
for (const [type, niche, slug] of entries) {
  if (promoteOne(type, niche, slug)) ok++;
  else fail++;
}
console.log(`\n${ok} promoted, ${fail} blocked/missing.`);
process.exit(fail > 0 ? 1 : 0);
