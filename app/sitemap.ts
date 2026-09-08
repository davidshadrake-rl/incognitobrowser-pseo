import type { MetadataRoute } from 'next';
import {
  getContentFiles,
  getGlossaryFiles,
  getContentItem,
  getGlossaryItem,
  isPublished,
  type EditableContent,
  isToolVisible,
} from '@/lib/content';
import { getAllSites, isSitePublished } from '@/lib/sites';
import { getAllNiches, getAllContentTypes } from '@/lib/taxonomy';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';

export const dynamic = 'force-static';

const SITE_URL = 'https://incognitobrowser.io/resources';

/**
 * Sitemap only lists pages that are editorially gated as "published".
 * Drafts and reviewed-but-not-promoted pages exist on the site and
 * render normally, but they emit noindex,follow and are excluded here
 * so search engines don't get pointed at unfinished content.
 *
 * The top-level index pages (home, /checklists, /guides etc.) and niche
 * hub pages stay in the sitemap because they're navigational landing
 * pages — they don't depend on individual article editorial status.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  // The Pro deployment is a product surface (gate coming), noindex sitewide,
  // and must not compete with the free site for the same content: no sitemap.
  if (IS_PRO_DEPLOYMENT) return [];
  const entries: MetadataRoute.Sitemap = [];

  // Home page
  entries.push({
    url: SITE_URL,
    lastModified: new Date(),
    changeFrequency: 'weekly',
    priority: 1,
  });

  // Content type index pages
  const contentTypes = getAllContentTypes();
  for (const ct of contentTypes) {
    entries.push({
      url: `${SITE_URL}/${ct.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.8,
    });
  }

  // Niche hub pages
  const niches = getAllNiches();
  for (const niche of niches) {
    entries.push({
      url: `${SITE_URL}/topics/${niche.slug}`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    });
  }

  // Dynamic content pages — gated by editorial.status === 'published'
  const dynamicTypes = ['checklists', 'guides', 'comparisons', 'tools', 'templates', 'calculators'];
  for (const type of dynamicTypes) {
    const files = getContentFiles(type);
    for (const file of files) {
      const [niche, slug] = file.split('/');
      const item = getContentItem<EditableContent>(type, niche, slug);
      if (!isPublished(item)) continue;
      if (type === 'tools' && !isToolVisible(niche, slug)) continue; // Pro-engine pages live on the Pro deployment
      entries.push({
        url: `${SITE_URL}/${type}/${niche}/${slug}`,
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }

  // Glossary pages — same gate
  const glossaryFiles = getGlossaryFiles();
  for (const term of glossaryFiles) {
    const item = getGlossaryItem<EditableContent>(term);
    if (!isPublished(item)) continue;
    entries.push({
      url: `${SITE_URL}/glossary/${term}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    });
  }

  // Website Privacy Report Cards
  entries.push({ url: `${SITE_URL}/site`, lastModified: new Date(), changeFrequency: 'weekly', priority: 0.8 });
  entries.push({ url: `${SITE_URL}/site/methodology`, lastModified: new Date(), changeFrequency: 'monthly', priority: 0.5 });
  for (const s of getAllSites()) {
    if (!isSitePublished(s)) continue;
    entries.push({ url: `${SITE_URL}/site/${s.domain}`, lastModified: new Date(s.scannedAt), changeFrequency: 'monthly', priority: 0.6 });
  }

  return entries;
}
