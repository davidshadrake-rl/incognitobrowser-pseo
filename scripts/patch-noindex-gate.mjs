#!/usr/bin/env node
/**
 * One-shot patcher: wires noIndex gate into all 7 content detail pages.
 *
 *   1. Adds `isPublished` to the existing `@/lib/content` import.
 *   2. Inserts `noIndex: !isPublished(data),` into the genMeta call.
 *
 * Idempotent: skips files where the call already contains noIndex.
 *
 * Usage: node scripts/patch-noindex-gate.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const targets = [
  'app/checklists/[niche]/[slug]/page.tsx',
  'app/guides/[niche]/[slug]/page.tsx',
  'app/comparisons/[niche]/[slug]/page.tsx',
  'app/templates/[niche]/[slug]/page.tsx',
  'app/calculators/[niche]/[slug]/page.tsx',
  'app/tools/[niche]/[slug]/page.tsx',
  'app/glossary/[term]/page.tsx',
];

for (const rel of targets) {
  const fp = path.join(ROOT, rel);
  let src = fs.readFileSync(fp, 'utf-8');
  let changed = false;

  // 1. Add isPublished to existing import from '@/lib/content'
  if (!/isPublished/.test(src)) {
    src = src.replace(
      /import\s*\{\s*([^}]*?)\s*\}\s*from\s*['"]@\/lib\/content['"]/,
      (_match, names) => {
        const trimmed = names.trim().replace(/,$/, '');
        return `import { ${trimmed}, isPublished } from '@/lib/content'`;
      }
    );
    changed = true;
  }

  // 2. Add noIndex: !isPublished(data) inside genMeta({ ... }) block.
  // Match by finding `return genMeta({` then balanced-ish until first `});`
  // that ends a metadata call. We anchor on `path:` to ensure we're inside.
  if (!/noIndex/.test(src)) {
    src = src.replace(
      /(return\s+genMeta\(\{[\s\S]*?path:[\s\S]*?,)(\s*\}\);)/,
      '$1\n    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),$2'
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(fp, src);
    console.log(`PATCHED ${rel}`);
  } else {
    console.log(`SKIP    ${rel} (already patched)`);
  }
}
