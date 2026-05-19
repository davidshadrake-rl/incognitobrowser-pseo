#!/usr/bin/env node
/**
 * One-shot patcher: drops a <ArticleByline> render right after each
 * content page's <h1> so every article shows a visible byline.
 *
 *   1. Adds `import { ArticleByline } from './ArticleByline'`.
 *   2. Inserts the render after the first `<h1 ...>{data.title}</h1>`
 *      using the data's author/editor/editorial.reviewedAt blocks.
 *
 * Idempotent.
 *
 * Usage: node scripts/patch-byline-render.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const targets = [
  'components/ChecklistPage.tsx',
  'components/GuidePage.tsx',
  'components/ComparisonPage.tsx',
  'components/TemplatePage.tsx',
  'components/CalculatorPage.tsx',
  'components/ToolPage.tsx',
  'components/GlossaryPage.tsx',
];

const IMPORT_LINE = "import { ArticleByline } from './ArticleByline';";
const BYLINE_BLOCK = `        <ArticleByline
          author={(data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author}
          editor={(data as unknown as { editor?: { name: string; profileUrl?: string } | null }).editor}
          reviewedAt={(data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt}
        />`;

for (const rel of targets) {
  const fp = path.join(ROOT, rel);
  if (!fs.existsSync(fp)) {
    console.warn(`MISSING ${rel}`);
    continue;
  }
  let src = fs.readFileSync(fp, 'utf-8');
  let changed = false;

  if (!/from '\.\/ArticleByline'/.test(src) && !/ArticleByline/.test(src)) {
    // Insert after the last existing top-level import.
    src = src.replace(
      /(\nimport[^\n]+;\n)(?!import )/,
      `$1${IMPORT_LINE}\n`
    );
    changed = true;
  }

  if (!/<ArticleByline/.test(src)) {
    // Find the first <h1 ...>{data.title}</h1> (or first h1 in general) and
    // insert the byline immediately after it.
    src = src.replace(
      /(<h1[^>]*>[\s\S]*?<\/h1>\s*\n)/,
      `$1${BYLINE_BLOCK}\n`
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(fp, src);
    console.log(`PATCHED ${rel}`);
  } else {
    console.log(`SKIP    ${rel}`);
  }
}
