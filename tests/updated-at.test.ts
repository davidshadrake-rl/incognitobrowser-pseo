/**
 * editorial.updatedAt: a text change after review moves a page's modified
 * date, never its review date.
 *
 *   - Content pages: JSON-LD dateModified and og modified_time are
 *     `updatedAt ?? reviewedAt`; datePublished and og published_time stay
 *     reviewedAt. Checked on all seven page types.
 *   - The sitemap's lastModified for a content page follows the same rule.
 *   - scripts/stamp-updated.ts: where the stamp goes, what counts as a text
 *     change, and that every stamp in data/ is well formed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isValidElement } from 'react';
import type { Metadata } from 'next';
import { JsonLd } from '@/components/seo/JsonLd';
import { getContentFiles, getContentItem, getGlossaryFiles, getGlossaryItem, isPublished, type EditableContent } from '@/lib/content';
import { CONTENT_TYPES, serialize, stampUpdatedAt, textChanged } from '../scripts/stamp-updated';

// Pages and the sitemap read content through lib/content; a test swaps in one
// item under its path ("guides/<niche>/<slug>", "glossary/<term>").
const override = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@/lib/content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/content')>();
  return {
    ...actual,
    getContentItem: (type: string, ...parts: string[]) => override.get([type, ...parts].join('/')) ?? actual.getContentItem(type, ...parts),
    getGlossaryItem: (slug: string) => override.get(`glossary/${slug}`) ?? actual.getGlossaryItem(slug),
  };
});

afterEach(() => override.clear());

// Fixture dates no real file carries, so a pass cannot come from the data.
const REVIEWED = '2026-01-02T03:04:05.000Z';
const UPDATED = '2026-02-03';

type Item = Record<string, unknown>;
type Params = Record<string, string>;

interface PageModule {
  default: (props: { params: Promise<Params> }) => Promise<unknown>;
  generateMetadata: (props: { params: Promise<Params> }) => Promise<Metadata>;
}

const PAGES: Array<{ type: string; load: () => Promise<unknown> }> = [
  { type: 'guides', load: () => import('@/app/guides/[niche]/[slug]/page') },
  { type: 'checklists', load: () => import('@/app/checklists/[niche]/[slug]/page') },
  { type: 'templates', load: () => import('@/app/templates/[niche]/[slug]/page') },
  { type: 'calculators', load: () => import('@/app/calculators/[niche]/[slug]/page') },
  { type: 'comparisons', load: () => import('@/app/comparisons/[niche]/[slug]/page') },
  { type: 'tools', load: () => import('@/app/tools/[niche]/[slug]/page') },
  { type: 'glossary', load: () => import('@/app/glossary/[term]/page') },
];

/** A real published page of this type: published, so it carries the Article JSON-LD. */
function publishedPage(type: string): { key: string; params: Params; item: Item } {
  if (type === 'glossary') {
    for (const term of getGlossaryFiles()) {
      const item = getGlossaryItem<Item>(term);
      if (item && isPublished(item as EditableContent)) return { key: `glossary/${term}`, params: { term }, item };
    }
  } else {
    for (const file of getContentFiles(type)) {
      const [niche, slug] = file.split('/');
      const item = getContentItem<Item>(type, niche, slug);
      if (item && isPublished(item as EditableContent)) return { key: `${type}/${file}`, params: { niche, slug }, item };
    }
  }
  throw new Error(`no published ${type} page`);
}

/** The item with exactly these review dates (no updatedAt unless given). */
function withDates(item: Item, dates: { reviewedAt: string; updatedAt?: string }): Item {
  const editorial = { ...(item.editorial as Item) };
  delete editorial.updatedAt;
  return { ...item, editorial: { ...editorial, ...dates } };
}

/** The Article JSON-LD a page's element tree carries. */
function articleSchema(tree: unknown): Item | undefined {
  const blocks: Item[] = [];
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!isValidElement(node)) return;
    const props = node.props as { data?: Item; children?: unknown };
    if (node.type === JsonLd && props.data) blocks.push(props.data);
    visit(props.children);
  };
  visit(tree);
  return blocks.find((b) => b['@type'] === 'Article');
}

async function render(type: string, load: () => Promise<unknown>, dates: { reviewedAt: string; updatedAt?: string }) {
  const { key, params, item } = publishedPage(type);
  override.set(key, withDates(item, dates));
  const page = (await load()) as PageModule;
  const schema = articleSchema(await page.default({ params: Promise.resolve(params) }));
  const meta = await page.generateMetadata({ params: Promise.resolve(params) });
  return { schema, openGraph: meta.openGraph as Item | undefined };
}

describe.each(PAGES)('$type page dates', ({ type, load }) => {
  it('dateModified is editorial.updatedAt when the page has one; datePublished stays reviewedAt', async () => {
    const { schema, openGraph } = await render(type, load, { reviewedAt: REVIEWED, updatedAt: UPDATED });
    expect(schema).toBeDefined();
    expect(schema?.dateModified).toBe(UPDATED);
    expect(schema?.datePublished).toBe(REVIEWED);
    expect(openGraph).toMatchObject({ modifiedTime: UPDATED, publishedTime: REVIEWED });
  });

  it('without updatedAt, dateModified falls back to reviewedAt', async () => {
    const { schema, openGraph } = await render(type, load, { reviewedAt: REVIEWED });
    expect(schema).toBeDefined();
    expect(schema?.dateModified).toBe(REVIEWED);
    expect(schema?.datePublished).toBe(REVIEWED);
    expect(openGraph).toMatchObject({ modifiedTime: REVIEWED, publishedTime: REVIEWED });
  });
});

describe('sitemap lastModified', () => {
  it('is updatedAt for a page that has one, else reviewedAt', async () => {
    const guide = publishedPage('guides');
    const term = publishedPage('glossary');
    override.set(guide.key, withDates(guide.item, { reviewedAt: REVIEWED, updatedAt: UPDATED }));
    override.set(term.key, withDates(term.item, { reviewedAt: REVIEWED }));
    // The Pro deployment has no sitemap, and the tier is read at module load:
    // load the sitemap as the free site, as tests/comparison-score does.
    const tier = process.env.NEXT_PUBLIC_TIER;
    vi.resetModules();
    delete process.env.NEXT_PUBLIC_TIER;
    try {
      const { default: sitemap } = await import('@/app/sitemap');
      const lastModified = new Map(sitemap().map((e) => [e.url, e.lastModified]));
      const base = 'https://incognitobrowser.io/resources';
      expect(lastModified.get(`${base}/guides/${guide.params.niche}/${guide.params.slug}`)).toEqual(new Date(UPDATED));
      expect(lastModified.get(`${base}/glossary/${term.params.term}`)).toEqual(new Date(REVIEWED));
    } finally {
      vi.resetModules();
      if (tier === undefined) delete process.env.NEXT_PUBLIC_TIER;
      else process.env.NEXT_PUBLIC_TIER = tier;
    }
  });
});

describe('scripts/stamp-updated.ts', () => {
  const file = {
    title: 'A page',
    editorial: { status: 'published', reviewedAt: REVIEWED, reviewedBy: null, notes: null },
    author: { name: 'Editorial' },
  };

  it('puts updatedAt right after reviewedAt and changes nothing else', () => {
    const { json, outcome } = stampUpdatedAt(file, '2026-09-11');
    expect(outcome).toBe('stamped');
    expect(Object.keys(json)).toEqual(Object.keys(file));
    expect(Object.keys(json.editorial as Item)).toEqual(['status', 'reviewedAt', 'updatedAt', 'reviewedBy', 'notes']);
    expect(json.editorial).toMatchObject({ reviewedAt: REVIEWED, updatedAt: '2026-09-11' });
    // The file gains exactly one line.
    expect(serialize(json).replace('    "updatedAt": "2026-09-11",\n', '')).toBe(serialize(file));
    expect(file.editorial).not.toHaveProperty('updatedAt');
  });

  it('never moves a stamp back, and leaves alone a page reviewed after the date', () => {
    const stamped = stampUpdatedAt(file, '2026-09-11').json;
    expect(stampUpdatedAt(stamped, '2026-09-11').outcome).toBe('kept');
    expect(stampUpdatedAt(stamped, '2026-09-10').outcome).toBe('kept');
    expect(stampUpdatedAt(stamped, '2026-09-12').json.editorial).toMatchObject({ updatedAt: '2026-09-12' });
    expect(stampUpdatedAt(file, '2025-12-31').outcome).toBe('reviewed-later');
    expect(stampUpdatedAt({ title: 'No editorial' }, '2026-09-11').outcome).toBe('no-editorial');
  });

  it('counts a text change, but not a stamp or any other editorial-only change', () => {
    expect(textChanged(file, { ...file, title: 'Another title' })).toBe(true);
    expect(textChanged(null, file)).toBe(true);
    expect(textChanged(file, stampUpdatedAt(file, '2026-09-11').json)).toBe(false);
    expect(textChanged(file, { ...file, editorial: { ...file.editorial, status: 'draft' } })).toBe(false);
  });

  it('every updatedAt in the content data is an ISO date right after reviewedAt, not before the review', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
        const p = path.join(dir, d.name);
        return d.isDirectory() ? walk(p) : d.name.endsWith('.json') ? [p] : [];
      });
    const bad: string[] = [];
    for (const type of CONTENT_TYPES) {
      for (const f of walk(path.join(process.cwd(), 'data', type))) {
        const editorial = (JSON.parse(fs.readFileSync(f, 'utf8')) as { editorial?: Item }).editorial;
        if (!editorial || !('updatedAt' in editorial)) continue;
        const keys = Object.keys(editorial);
        const updatedAt = editorial.updatedAt;
        const reviewedAt = typeof editorial.reviewedAt === 'string' ? editorial.reviewedAt : '';
        const ok =
          keys[keys.indexOf('reviewedAt') + 1] === 'updatedAt' &&
          typeof updatedAt === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(updatedAt) &&
          updatedAt >= reviewedAt.slice(0, 10);
        if (!ok) bad.push(path.relative(process.cwd(), f));
      }
    }
    expect(bad).toEqual([]);
  });
});
