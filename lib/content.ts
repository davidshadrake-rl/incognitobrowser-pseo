import fs from 'fs';
import path from 'path';

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

export function getCrossNicheLinks(
  niche: string,
  currentType: string,
  currentSlug: string,
  limit = 6
): Array<{ title: string; url: string; type: string }> {
  const contentTypes = ['guides', 'checklists', 'comparisons', 'tools', 'templates', 'calculators'];
  const typeLabels: Record<string, string> = {
    guides: 'guide', checklists: 'checklist', comparisons: 'comparison',
    tools: 'tool', templates: 'template', calculators: 'calculator',
  };
  const links: Array<{ title: string; url: string; type: string }> = [];

  for (const ct of contentTypes) {
    if (links.length >= limit) break;
    const files = getContentFiles(ct, niche);
    for (const slug of files) {
      if (links.length >= limit) break;
      if (ct === currentType && slug === currentSlug) continue;
      const title = getContentItemTitle(ct, niche, slug);
      links.push({ title, url: `/${ct}/${niche}/${slug}`, type: typeLabels[ct] });
    }
  }
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
