import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateWebApplicationSchema, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo';
import { CalculatorPage } from '@/components/CalculatorPage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';
import { proofToolFor } from '@/lib/proof-route';

interface CalculatorData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  description: string;
  inputs: Array<{
    id: string;
    label: string;
    type: 'number' | 'select' | 'range' | 'checkbox';
    defaultValue: number | string | boolean;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ value: string | number; label: string }>;
    helpText?: string;
  }>;
  outputFields: Array<{
    id: string;
    label: string;
    format: 'percentage' | 'score' | 'grade' | 'text' | 'number' | 'currency';
    description?: string;
  }>;
  formula: string;
  educational: {
    methodology?: string;
    tips?: string[];
    interpretation?: Array<{
      range: string;
      label: string;
      description: string;
      color: string;
    }>;
  };
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return []; // Pro deployment serves tools only
  const files = getContentFiles('calculators');
  return files.map(f => {
    const [niche, slug] = f.split('/');
    return { niche, slug };
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche, slug } = await params;
  const data = getContentItem<CalculatorData>('calculators', niche, slug);
  if (!data) return {};
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/calculators/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    modifiedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
  });
}

export default async function CalculatorDetailPage({ params }: PageProps) {
  const { niche, slug } = await params;
  const data = getContentItem<CalculatorData>('calculators', niche, slug);
  if (!data) notFound();

  const nicheInfo = getNicheById(niche);
  const nicheName = nicheInfo?.name || niche;

  const appSchema = generateWebApplicationSchema(
    data.title,
    data.description,
    `https://incognitobrowser.io/resources/calculators/${niche}/${slug}`
  );
  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Calculators', url: '/calculators' },
    { name: nicheName, url: `/calculators/${niche}` },
    { name: data.title, url: `/calculators/${niche}/${slug}` },
  ]);

  const crossLinks = getCrossNicheLinks(niche, 'calculators', slug);

  // Per-article Article + Person JSON-LD. Surfaces the byline (Darkpool
  // David, pseudonymous writer) and editor (David Shadrake, LinkedIn-
  // verified) so Google can attribute the page to real entities.
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/calculators/${niche}/${slug}`,
    datePublished: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    dateModified: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    author: (data as unknown as { author?: { name: string; bio?: string; credentials?: string; profileUrl?: string; sameAs?: string[] } | null }).author,
    editor: (data as unknown as { editor?: { name: string; profileUrl?: string; sameAs?: string[] } | null }).editor || null,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <JsonLd data={appSchema} />
      <CalculatorPage data={data} nicheName={nicheName} proofRoute={proofToolFor(niche)} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
