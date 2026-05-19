#!/usr/bin/env node
/**
 * Resolves F4 (R2 doorway-pattern risk): drafts the duplicate-template
 * articles in lower-priority niches so only the canonical niche keeps
 * each templated article indexed.
 *
 * Rule: for each cluster of niches that share the same 4-5 template
 * slugs ("security-checklist", "privacy-hardening-checklist",
 * "complete-guide", etc.), pick a CANONICAL niche and demote those
 * specific template articles to status='draft' in all other niches in
 * the cluster.
 *
 * The canonical niches were chosen because they're the broadest/most-
 * established topic in each cluster (largest existing keyword footprint
 * in incognitobrowser_blog_posts.csv).
 *
 * Idempotent.
 *
 * Usage: node scripts/demote-overlap-duplicates.mjs [--dry-run]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');

/**
 * For each cluster: the canonical niche keeps templated articles;
 * the others get those same templates demoted to draft. Source of
 * cluster groupings is editorial/hub-overlap.csv (content_slug_j ≥ 0.5).
 */
const CLUSTERS = [
  {
    name: 'browser/privacy/fingerprinting/footprint',
    canonical: 'browser-privacy',
    demote: ['incognito-mode', 'device-fingerprinting', 'digital-footprint'],
  },
  {
    name: 'messaging/social/drone-surveillance',
    canonical: 'social-media-privacy',
    demote: ['encrypted-messaging', 'drone-surveillance'],
  },
  {
    name: 'shopping/banking/search-history',
    canonical: 'online-banking',
    demote: ['online-shopping', 'search-history'],
  },
  {
    name: 'us-state/international-privacy',
    canonical: 'us-state-privacy',
    demote: ['international-privacy'],
  },
];

// The article SLUGS that the generator produces in near-identical form
// across every niche. These are the doorway-pattern offenders.
const DUPLICATE_TEMPLATE_SUFFIXES = [
  'security-checklist',
  'privacy-hardening-checklist',
  'complete-guide-to-',
  'for-beginners',
  'advanced-',
  'risk-calculator',
];

const CONTENT_TYPES = ['checklists', 'guides', 'comparisons', 'templates', 'calculators'];

function isTemplateSlug(slug) {
  return DUPLICATE_TEMPLATE_SUFFIXES.some((s) => slug.includes(s));
}

let demoted = 0;
let kept = 0;

for (const cluster of CLUSTERS) {
  for (const niche of cluster.demote) {
    for (const ct of CONTENT_TYPES) {
      const dir = path.join(DATA, ct, niche);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        const slug = f.replace('.json', '');
        if (!isTemplateSlug(slug)) {
          kept++;
          continue;
        }
        const fp = path.join(dir, f);
        const json = JSON.parse(fs.readFileSync(fp, 'utf-8'));
        if (json.editorial?.status === 'draft') {
          kept++;
          continue;
        }
        json.editorial = {
          status: 'draft',
          reviewedAt: json.editorial?.reviewedAt || null,
          reviewedBy: 'David Shadrake',
          notes: `Demoted to draft to resolve R2 doorway-pattern overlap with ${cluster.canonical}. Canonical version lives under /${ct}/${cluster.canonical}/.`,
        };
        if (!DRY) fs.writeFileSync(fp, JSON.stringify(json, null, 2) + '\n');
        demoted++;
        console.log(`DEMOTE  ${ct}/${niche}/${slug}`);
      }
    }
  }
}

console.log(`\n${DRY ? '[DRY] ' : ''}Demoted: ${demoted} | Kept: ${kept}`);
console.log('These pages will emit noindex,follow and drop out of the sitemap.');
console.log("Canonical templated articles remain in the cluster's canonical niche.");
