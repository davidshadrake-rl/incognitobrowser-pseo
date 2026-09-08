import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateFAQSchema, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo';
import { ComparisonPage } from '@/components/ComparisonPage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

interface ComparisonData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  intro: string;
  products: Array<{
    name: string;
    slug: string;
    tagline: string;
    website?: string;
    pricing?: string;
    pros: string[];
    cons: string[];
    rating: number;
  }>;
  features: Array<{
    name: string;
    description: string;
    scores: Record<string, { value: 'yes' | 'no' | 'partial' | 'excellent' | 'good' | 'fair' | 'poor'; note?: string }>;
  }>;
  verdict: {
    summary: string;
    bestFor: Array<{ useCase: string; product: string; reason: string }>;
  };
  faqs: Array<{ question: string; answer: string }>;
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return []; // Pro deployment serves tools only
  const files = getContentFiles('comparisons');
  return files.map(f => {
    const [niche, slug] = f.split('/');
    return { niche, slug };
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche, slug } = await params;
  const data = getContentItem<ComparisonData>('comparisons', niche, slug);
  if (!data) return {};
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/comparisons/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    modifiedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
  });
}

export default async function ComparisonDetailPage({ params }: PageProps) {
  const { niche, slug } = await params;
  const data = getContentItem<ComparisonData>('comparisons', niche, slug);
  if (!data) notFound();

  const nicheInfo = getNicheById(niche);
  const nicheName = nicheInfo?.name || niche;

  const faqSchema = data.faqs.length > 0 ? generateFAQSchema(data.faqs, `/comparisons/${niche}/${slug}`) : null;
  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Comparisons', url: '/comparisons' },
    { name: nicheName, url: `/comparisons/${niche}` },
    { name: data.title, url: `/comparisons/${niche}/${slug}` },
  ]);

  const crossLinks = getCrossNicheLinks(niche, 'comparisons', slug);

  // Per-article Article + Person JSON-LD. Surfaces the byline (Darkpool
  // David, pseudonymous writer) and editor (David Shadrake, LinkedIn-
  // verified) so Google can attribute the page to real entities.
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/comparisons/${niche}/${slug}`,
    datePublished: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    dateModified: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    author: (data as unknown as { author?: { name: string; bio?: string; credentials?: string; profileUrl?: string; sameAs?: string[] } | null }).author,
    editor: (data as unknown as { editor?: { name: string; profileUrl?: string; sameAs?: string[] } | null }).editor || null,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      {faqSchema && <JsonLd data={faqSchema} />}
      <ComparisonPage data={data} nicheName={nicheName} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
