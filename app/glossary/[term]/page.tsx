import { notFound } from 'next/navigation';
import { getGlossaryItem, getGlossaryFiles, isPublished } from '@/lib/content';
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
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/glossary/${term}`,
    datePublished: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    dateModified: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    author: (data as unknown as { author?: { name: string; bio?: string; credentials?: string; profileUrl?: string; sameAs?: string[] } | null }).author,
    editor: (data as unknown as { editor?: { name: string; profileUrl?: string; sameAs?: string[] } | null }).editor || null,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <GlossaryTermPage data={data} validTermSlugs={validTermSlugs} />
    </>
  );
}
