import taxonomyData from '@/data/taxonomy.json';

export interface Niche {
  id: string;
  name: string;
  slug: string;
  description: string;
  tier: number;
  parentId: string | null;
  keywords: string[];
  relatedNiches: string[];
}

export interface ContentType {
  id: string;
  name: string;
  slug: string;
  description: string;
}

export function getAllNiches(): Niche[] {
  return taxonomyData.niches;
}

export function getNicheBySlug(slug: string): Niche | undefined {
  return taxonomyData.niches.find(n => n.slug === slug);
}

export function getNicheById(id: string): Niche | undefined {
  return taxonomyData.niches.find(n => n.id === id);
}

export function getNichesByTier(tier: number): Niche[] {
  return taxonomyData.niches.filter(n => n.tier === tier);
}

export function getRelatedNiches(nicheId: string): Niche[] {
  const niche = getNicheById(nicheId);
  if (!niche) return [];
  return niche.relatedNiches
    .map(id => getNicheById(id))
    .filter((n): n is Niche => n !== undefined);
}

export function getAllContentTypes(): ContentType[] {
  return taxonomyData.contentTypes;
}

export function getContentTypeBySlug(slug: string): ContentType | undefined {
  return taxonomyData.contentTypes.find(ct => ct.slug === slug);
}
