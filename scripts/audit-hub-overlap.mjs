#!/usr/bin/env node
/**
 * Hub-overlap analysis for R2 (doorway-page-network risk).
 *
 * Pairwise compares every niche against every other niche on three axes:
 *   1. Jaccard similarity of keyword sets
 *   2. Jaccard similarity of subtopic sets
 *   3. Token overlap of name + description
 *
 * Outputs `editorial/hub-overlap.csv` sorted by combined score, descending.
 *
 * High scores (≥0.4 combined) are merge candidates — those hubs probably
 * target the same intent and should be consolidated to avoid Google
 * reading the site as a doorway network.
 *
 * Usage: node scripts/audit-hub-overlap.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const TAX = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'taxonomy.json'), 'utf-8'));
const OUT = path.join(ROOT, 'editorial', 'hub-overlap.csv');

// Only true English filler is stripped here. "privacy", "browser", "tracking"
// stay in — when two hubs share those, that IS the overlap signal we care about.
const STOPWORDS = new Set([
  'and', 'or', 'the', 'a', 'an', 'of', 'to', 'in', 'on', 'for', 'with',
  'your', 'you', 'how', 'what', 'why', 'when', 'is', 'are', 'be',
  'across', 'all', 'every', 'any', 'use', 'using',
]);

function tokens(s) {
  if (!s) return new Set();
  return new Set(
    String(s)
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t))
  );
}

function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function setFrom(list) {
  return new Set((list || []).map((s) => String(s).toLowerCase()));
}

// Also pull each niche's actual content slugs (across all content types).
// If two niches both have "X privacy hardening checklist" generated under them,
// they're producing the same article twice — strong overlap signal.
function nicheContentTokens(nicheId) {
  const tokens = new Set();
  const CONTENT_TYPES = ['checklists', 'guides', 'comparisons', 'templates', 'calculators'];
  for (const ct of CONTENT_TYPES) {
    const dir = path.join(ROOT, 'data', ct, nicheId);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json')) continue;
      // Strip the niche prefix from the slug so we compare topic-only.
      // e.g. browser-privacy/browser-privacy-hardening-checklist.json
      //   -> "hardening-checklist"
      const slug = f.replace('.json', '');
      const normalized = slug
        .replace(new RegExp(`^${nicheId}-`), '')
        .replace(/^(security|privacy|hardening)-/, '');
      tokens.add(`${ct}:${normalized}`);
    }
  }
  return tokens;
}

const niches = TAX.niches.map((n) => ({
  id: n.id,
  name: n.name,
  description: n.description || '',
  keywords: setFrom(n.keywords),
  subtopics: setFrom(n.context?.subtopics || []),
  nameTokens: new Set([...tokens(n.name), ...tokens(n.description)]),
  contentSlugs: nicheContentTokens(n.id),
}));

const rows = [['niche_a', 'niche_b', 'keyword_j', 'subtopic_j', 'name_desc_j', 'content_slug_j', 'combined', 'recommendation']];

for (let i = 0; i < niches.length; i++) {
  for (let j = i + 1; j < niches.length; j++) {
    const a = niches[i];
    const b = niches[j];
    const kw = jaccard(a.keywords, b.keywords);
    const sub = jaccard(a.subtopics, b.subtopics);
    const nm = jaccard(a.nameTokens, b.nameTokens);
    const cs = jaccard(a.contentSlugs, b.contentSlugs);
    // Content-slug overlap weighted heaviest — it's the strongest signal that
    // the same article is being duplicated under two hubs.
    const combined = cs * 0.5 + kw * 0.25 + sub * 0.15 + nm * 0.1;
    if (combined < 0.05) continue;
    const rec =
      combined >= 0.4 ? 'MERGE'
      : combined >= 0.25 ? 'REVIEW'
      : 'monitor';
    rows.push([a.id, b.id, kw.toFixed(3), sub.toFixed(3), nm.toFixed(3), cs.toFixed(3), combined.toFixed(3), rec]);
  }
}

// Sort by combined desc (header stays at top). Combined is column index 6.
const header = rows[0];
const body = rows.slice(1).sort((a, b) => parseFloat(b[6]) - parseFloat(a[6]));

if (!fs.existsSync(path.dirname(OUT))) fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, [header, ...body].map((r) => r.join(',')).join('\n') + '\n');

const merges = body.filter((r) => r[7] === 'MERGE').length;
const reviews = body.filter((r) => r[7] === 'REVIEW').length;
console.log(`Pairs analyzed: ${(niches.length * (niches.length - 1)) / 2}`);
console.log(`MERGE candidates: ${merges}`);
console.log(`REVIEW candidates: ${reviews}`);
console.log(`CSV: ${path.relative(ROOT, OUT)}`);

console.log('\nTop 15 overlap pairs (combined / content-slug-jaccard / rec):');
for (const r of body.slice(0, 15)) {
  console.log(`  ${r[6]}  cs=${r[5]}  ${r[7].padEnd(8)} ${r[0]}  ↔  ${r[1]}`);
}
