#!/usr/bin/env node
/**
 * One-shot patcher: wires Article JSON-LD + OG timestamps into all 7
 * content detail pages.
 *
 *   1. Adds `generateArticleSchema` to the `@/lib/seo` import.
 *   2. Adds `publishedAt: data.editorial?.reviewedAt` + `modifiedAt` to
 *      the genMeta call so OG article timestamps emit.
 *   3. Renders <JsonLd data={articleSchema} /> next to the existing
 *      breadcrumb JsonLd, where articleSchema is built from the data's
 *      title/metaDescription/author/editor blocks.
 *
 * Idempotent. Skips files already patched.
 *
 * Usage: node scripts/patch-article-schema.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// Each target: file path + the rendered URL path template (server-side var refs).
const targets = [
  { file: 'app/checklists/[niche]/[slug]/page.tsx', pathExpr: '`/checklists/${niche}/${slug}`' },
  { file: 'app/guides/[niche]/[slug]/page.tsx',     pathExpr: '`/guides/${niche}/${slug}`' },
  { file: 'app/comparisons/[niche]/[slug]/page.tsx',pathExpr: '`/comparisons/${niche}/${slug}`' },
  { file: 'app/templates/[niche]/[slug]/page.tsx',  pathExpr: '`/templates/${niche}/${slug}`' },
  { file: 'app/calculators/[niche]/[slug]/page.tsx',pathExpr: '`/calculators/${niche}/${slug}`' },
  { file: 'app/tools/[niche]/[slug]/page.tsx',      pathExpr: '`/tools/${niche}/${slug}`' },
  { file: 'app/glossary/[term]/page.tsx',           pathExpr: '`/glossary/${term}`' },
];

for (const t of targets) {
  const fp = path.join(ROOT, t.file);
  let src = fs.readFileSync(fp, 'utf-8');
  let changed = false;

  // 1. Add generateArticleSchema to the @/lib/seo import.
  if (!/generateArticleSchema/.test(src)) {
    src = src.replace(
      /import\s*\{\s*([^}]*?)\s*\}\s*from\s*['"]@\/lib\/seo['"]/,
      (_m, names) => {
        const trimmed = names.trim().replace(/,$/, '');
        return `import { ${trimmed}, generateArticleSchema } from '@/lib/seo'`;
      }
    );
    changed = true;
  }

  // 2. Add publishedAt + modifiedAt + type='article' to the genMeta call.
  if (!/publishedAt:/.test(src)) {
    src = src.replace(
      /(noIndex:\s*!isPublished\(data as unknown as Parameters<typeof isPublished>\[0\]\),)/,
      `$1\n    publishedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,\n    modifiedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,`
    );
    changed = true;
  }

  // 3. Inject Article JSON-LD render. We add it right after the existing
  // <JsonLd data={breadcrumbs} /> render. Build the article schema from data.
  if (!/articleSchema/.test(src)) {
    // The path expression is a TS template literal like `/checklists/${niche}/${slug}`.
    // Embed it inside a larger template literal as the SUFFIX of the URL.
    const articleSchemaBlock = [
      '',
      '  // Per-article Article + Person JSON-LD. Surfaces the byline (Darkpool',
      '  // David, pseudonymous writer) and editor (David Shadrake, LinkedIn-',
      '  // verified) so Google can attribute the page to real entities.',
      '  const articleSchema = generateArticleSchema({',
      '    headline: (data as unknown as { title: string }).title,',
      '    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription',
      "      || (data as unknown as { definition?: string }).definition",
      "      || '',",
      `    url: 'https://incognitobrowser.io/resources' + ${t.pathExpr},`,
      '    datePublished: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,',
      '    dateModified: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,',
      '    author: (data as unknown as { author?: { name: string; bio?: string; credentials?: string; profileUrl?: string; sameAs?: string[] } | null }).author,',
      '    editor: (data as unknown as { editor?: { name: string; profileUrl?: string; sameAs?: string[] } | null }).editor || null,',
      '  });',
      '',
    ].join('\n');

    src = src.replace(
      /(\n\s*return\s*\(\s*\n\s*<>)/,
      `\n${articleSchemaBlock}$1`
    );

    src = src.replace(
      /(<JsonLd data=\{breadcrumb[A-Za-z]*\}\s*\/>)/,
      `$1\n      {articleSchema && <JsonLd data={articleSchema} />}`
    );
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(fp, src);
    console.log(`PATCHED ${t.file}`);
  } else {
    console.log(`SKIP    ${t.file} (already patched)`);
  }
}
