import fs from 'fs';
import path from 'path';
import { engineVisibleInThisTier, IS_PRO_DEPLOYMENT, FREE_BASE_URL } from './tiers';
import { getRelatedNiches } from './taxonomy';
import glossaryNicheMap from '@/data/glossary-niche-map.json';

const DATA_DIR = path.join(process.cwd(), 'data');

/**
 * Editorial gate. A page is only indexable when:
 *   editorial.status === 'published' AND author has a real name.
 *
 * Everything else (drafts, reviewed-but-not-published) renders normally
 * for humans but emits `<meta name="robots" content="noindex,follow">`
 * and is excluded from sitemap.xml.
 *
 * This prevents the "doorway page network" + "scaled content abuse"
 * signal that Google's Helpful Content classifier looks for.
 */
export interface EditorialMeta {
  status: 'draft' | 'reviewed' | 'published';
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  notes?: string | null;
}

export interface Author {
  name: string;
  bio?: string;
  credentials?: string;
  profileUrl?: string;
  sameAs?: string[];
}

export interface Editor {
  name: string;
  profileUrl?: string;
  sameAs?: string[];
}

export interface EditableContent {
  editorial?: EditorialMeta;
  author?: Author | null;
  editor?: Editor | null;
}

export function isPublished(item: EditableContent | null | undefined): boolean {
  if (!item) return false;
  if (item.editorial?.status !== 'published') return false;
  if (!item.author || !item.author.name) return false;
  return true;
}

export function getContentFiles(contentType: string, niche?: string): string[] {
  const dir = niche
    ? path.join(DATA_DIR, contentType, niche)
    : path.join(DATA_DIR, contentType);

  if (!fs.existsSync(dir)) return [];

  if (niche) {
    return fs.readdirSync(dir)
      .filter(f => f.endsWith('.json'))
      .map(f => f.replace('.json', ''));
  }

  // If no niche, look in all subdirectories
  const niches = fs.readdirSync(dir).filter(f => {
    const fullPath = path.join(dir, f);
    return fs.statSync(fullPath).isDirectory();
  });

  const files: string[] = [];
  for (const nicheDir of niches) {
    const nicheFiles = fs.readdirSync(path.join(dir, nicheDir))
      .filter(f => f.endsWith('.json'))
      .map(f => `${nicheDir}/${f.replace('.json', '')}`);
    files.push(...nicheFiles);
  }
  return files;
}

export function getContentItem<T>(contentType: string, ...pathParts: string[]): T | null {
  const filePath = path.join(DATA_DIR, contentType, ...pathParts) + '.json';
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

export function getAllContentItems<T>(contentType: string): Array<T & { _niche: string; _slug: string }> {
  const files = getContentFiles(contentType);
  const items: Array<T & { _niche: string; _slug: string }> = [];

  for (const file of files) {
    const parts = file.split('/');
    if (parts.length === 2) {
      const item = getContentItem<T>(contentType, parts[0], parts[1]);
      if (item) {
        items.push({ ...item, _niche: parts[0], _slug: parts[1] });
      }
    }
  }
  return items;
}

/**
 * Is this tool page part of the current deployment (free or Pro)?
 * Every place that lists or links a tool must go through this — a tool page
 * that is not built here must never be linked from here.
 */
export function isToolVisible(niche: string, slug: string): boolean {
  const item = getContentItem<{ toolEngine?: string }>('tools', niche, slug);
  return !!item && engineVisibleInThisTier(item.toolEngine);
}

/** Visible in this tier AND published — the filter for every LISTING surface (catalogue, hubs, topic hubs, related links). Drafts still render (noindex) but are not advertised. */
export function isToolListed(niche: string, slug: string): boolean {
  if (!isToolVisible(niche, slug)) return false;
  return isPublished(getContentItem<EditableContent>('tools', niche, slug));
}

/** Absolute prefix for pages that exist only on the free site (empty on the free site itself). */
export function freeSitePrefix(): string {
  return IS_PRO_DEPLOYMENT ? FREE_BASE_URL : '';
}

const CROSS_LINK_TYPES = ['guides', 'checklists', 'comparisons', 'tools', 'templates', 'calculators'];
const CROSS_LINK_TYPE_LABELS: Record<string, string> = {
  guides: 'guide', checklists: 'checklist', comparisons: 'comparison',
  tools: 'tool', templates: 'template', calculators: 'calculator',
};

/**
 * Related links for a content page: at least `limit` of them, spread across
 * content types AND across niches.
 *
 * Two properties matter, and the previous implementation had neither:
 *   - Breadth of type. It drained one content type before starting the next,
 *     so a niche with many guides returned guides only.
 *     Now types are drained round-robin, one item per pass.
 *   - Breadth of niche. Every link came from the page's own niche, which is
 *     not a cross-niche block at all. Now half the block comes from this
 *     niche and the rest from `relatedNiches`, backfilling from this niche
 *     only when the related ones cannot fill it.
 */
export function getCrossNicheLinks(
  niche: string,
  currentType: string,
  currentSlug: string,
  limit = 12,
  /**
   * Fraction of the block drawn from the page's own niche. Topic hubs pass 0:
   * they already list their whole niche above, so same-niche links there are
   * pure duplication and the block is only useful if it reaches outward.
   */
  ownNicheShare = 0.5
): Array<{ title: string; url: string; type: string }> {
  // Content pages (guides, checklists, …) are built only on the free site; the
  // Pro deployment links to them absolutely. Tool links are always same-site
  // and only to tools this tier actually builds.
  const contentPrefix = freeSitePrefix();
  const links: Array<{ title: string; url: string; type: string }> = [];
  const seen = new Set<string>();

  const take = (ct: string, n: string, slug: string): boolean => {
    if (links.length >= limit) return false;
    if (ct === currentType && slug === currentSlug && n === niche) return false;
    if (ct === 'tools' && !isToolListed(n, slug)) return false;
    const prefix = ct === 'tools' ? '' : contentPrefix;
    const url = `${prefix}/${ct}/${n}/${slug}`;
    if (seen.has(url)) return false;
    seen.add(url);
    links.push({ title: getContentItemTitle(ct, n, slug), url, type: CROSS_LINK_TYPE_LABELS[ct] });
    return true;
  };

  /** Round-robin across content types within one niche, up to `cap` links. */
  const drain = (n: string, cap: number): void => {
    const queues = CROSS_LINK_TYPES.map(ct => ({ ct, files: getContentFiles(ct, n), i: 0 }));
    let added = 0;
    for (let progressed = true; progressed && added < cap && links.length < limit; ) {
      progressed = false;
      for (const q of queues) {
        if (added >= cap || links.length >= limit) break;
        while (q.i < q.files.length) {
          if (take(q.ct, n, q.files[q.i++])) { added++; progressed = true; break; }
        }
      }
    }
  };

  drain(niche, Math.ceil(limit * ownNicheShare));
  const related = getRelatedNiches(niche);
  // Spread whatever the own-niche pass left across the related niches, so a
  // hub asking for cross-niche links only still fills its block.
  const perRelated = related.length ? Math.ceil((limit - links.length) / related.length) : 0;
  for (const r of related) {
    if (links.length >= limit) break;
    drain(r.id, perRelated);
  }
  if (links.length < limit) drain(niche, limit);

  return links;
}

export function getContentItemTitle(contentType: string, niche: string, slug: string): string {
  const item = getContentItem<{ title?: string }>(contentType, niche, slug);
  return item?.title || slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// For glossary (flat structure, no niche subdirectories)
export function getGlossaryFiles(): string[] {
  const dir = path.join(DATA_DIR, 'glossary');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace('.json', ''));
}

export function getGlossaryItem<T>(slug: string): T | null {
  const filePath = path.join(DATA_DIR, 'glossary', `${slug}.json`);
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(raw) as T;
}

/**
 * Niche a glossary term belongs to, for its related-content block.
 *
 * Hand-authored in data/glossary-niche-map.json rather than derived: keyword
 * matching against niche keywords was ~40% wrong even on high-confidence
 * matches, and a wrong related link costs more than a missing one. A term
 * absent from the map renders no content links.
 */
export function nicheForGlossaryTerm(slug: string): string | undefined {
  return (glossaryNicheMap as { terms: Record<string, string> }).terms[slug];
}

/**
 * Strip the reviewing editor's identity before content crosses into a client
 * component.
 *
 * Next serialises every prop into the RSC payload embedded in the page, so
 * passing the whole content object shipped the editor's real name and personal
 * profile URL in the HTML of 1,000+ pages — invisible on screen, but present
 * in view-source and to any scraper. The byline only ever needed to know
 * *whether* a page was reviewed, so that is all that crosses: `reviewed`.
 *
 * Call this in the server component, after generateArticleSchema (which runs
 * server-side and may still read the full object).
 */
export function redactEditor<T extends object>(data: T): T & { reviewed: boolean } {
  const { editor, editorial, ...rest } = data as T & {
    editor?: unknown;
    editorial?: { reviewedBy?: string | null } & Record<string, unknown>;
  };
  // `editorial.reviewedBy` names the same person as `editor` and rides along
  // in the same payload, so both have to go — stripping one and not the other
  // leaves the name in the HTML while looking fixed.
  const safeEditorial = editorial
    ? Object.fromEntries(Object.entries(editorial).filter(([k]) => k !== 'reviewedBy'))
    : editorial;
  return { ...(rest as T), ...(editorial ? { editorial: safeEditorial } : {}), reviewed: !!editor } as T & { reviewed: boolean };
}
