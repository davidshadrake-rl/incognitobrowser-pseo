import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getGlossaryItem, getGlossaryFiles, isPublished, getCrossNicheLinks, nicheForGlossaryTerm, redactPeople } from '@/lib/content';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo';
import { GlossaryTermPage } from '@/components/GlossaryPage';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

interface GlossaryData {
  term: string;
  slug: string;
  definition: string;
  metaDescription: string;
  simpleExplanation: string;
  whyItMatters: string;
  technicalDetail?: string;
  examples: Array<{ scenario: string; explanation: string }>;
  relatedTerms: string[];
  niche?: string;
  category: string;
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ term: string }>;
}

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return [{ term: '_pro_export_placeholder_' }]; // Pro serves tools only; output:export needs ≥1 static param per dynamic route, so this ships one placeholder that resolves to no real content (notFound() below skips it in the actual output)
  const files = getGlossaryFiles();
  return files.map(term => ({ term }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { term } = await params;
  const data = getGlossaryItem<GlossaryData>(term);
  if (!data) return {};
  return genMeta({
    title: `${data.term} - Privacy Glossary`,
    description: data.metaDescription,
    path: `/glossary/${term}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    modifiedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
  });
}

export default async function GlossaryDetailPage({ params }: PageProps) {
  const { term } = await params;
  const data = getGlossaryItem<GlossaryData>(term);
  if (!data) notFound();

  const validTermSlugs = getGlossaryFiles();

  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Glossary', url: '/glossary' },
    { name: data.term, url: `/glossary/${term}` },
  ]);

  // Per-article Article + Person JSON-LD. Surfaces the byline (Darkpool
  // David, pseudonymous writer) and editor (David Shadrake, LinkedIn-
  // verified) so Google can attribute the page to real entities.
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { term?: string; title?: string }).term || (data as unknown as { title?: string }).title || term, // glossary items carry `term`, not `title` — every Article schema shipped without a headline
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/glossary/${term}`,
    datePublished: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    dateModified: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    attributed: !!(data as unknown as { author?: { name?: string } | null }).author?.name,
  });


  const glossaryNiche = nicheForGlossaryTerm(term);
  const nicheName = glossaryNiche ? getNicheById(glossaryNiche)?.name : undefined;

  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <GlossaryTermPage data={redactPeople(data)} validTermSlugs={validTermSlugs} niche={glossaryNiche} nicheName={nicheName} />
      {/* Glossary terms previously linked only to sibling terms, never into the
          guides/checklists/tools that explain them. The niche comes from a
          hand-authored map (see nicheForGlossaryTerm). */}
      {glossaryNiche && (
        <RelatedContent
          links={getCrossNicheLinks(glossaryNiche, 'glossary', term, 12, 0.75)}
          nicheHub={nicheName ? { name: nicheName, href: `/topics/${glossaryNiche}` } : undefined}
        />
      )}
    </>
  );
}
