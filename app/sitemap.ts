import type { MetadataRoute } from 'next';
import { getContentFiles, getGlossaryFiles } from '@/lib/content';
import { getAllNiches, getAllContentTypes } from '@/lib/taxonomy';

export const dynamic = 'force-static';

const SITE_URL = 'https://incognitobrowser.io/resources';

export default function sitemap(): MetadataRoute.Sitemap {
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

  // Dynamic content pages
  const dynamicTypes = ['checklists', 'guides', 'comparisons', 'tools', 'templates', 'calculators'];
  for (const type of dynamicTypes) {
    const files = getContentFiles(type);
    for (const file of files) {
      const [niche, slug] = file.split('/');
      entries.push({
        url: `${SITE_URL}/${type}/${niche}/${slug}`,
        lastModified: new Date(),
        changeFrequency: 'monthly',
        priority: 0.6,
      });
    }
  }

  // Glossary pages
  const glossaryFiles = getGlossaryFiles();
  for (const term of glossaryFiles) {
    entries.push({
      url: `${SITE_URL}/glossary/${term}`,
      lastModified: new Date(),
      changeFrequency: 'monthly',
      priority: 0.5,
    });
  }

  return entries;
}
