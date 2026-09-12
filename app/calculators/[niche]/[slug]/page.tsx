import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished, redactPeople, type EditableContent } from '@/lib/content';
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
  if (IS_PRO_DEPLOYMENT) return [{ niche: '_pro_export_placeholder_', slug: '_pro_export_placeholder_' }]; // Pro serves tools only; output:export needs ≥1 static param per dynamic route, so this ships one placeholder that resolves to no real content (notFound() below skips it in the actual output)
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
  const { editorial } = data as unknown as EditableContent;
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/calculators/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: editorial?.reviewedAt || undefined,
    modifiedAt: editorial?.updatedAt || editorial?.reviewedAt || undefined,
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
  // Published is the review; modified is the last text change after it
  // (editorial.updatedAt), else the review. An edit never moves the review date.
  const { editorial } = data as unknown as EditableContent;
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/calculators/${niche}/${slug}`,
    datePublished: editorial?.reviewedAt || undefined,
    dateModified: editorial?.updatedAt || editorial?.reviewedAt || undefined,
    attributed: !!(data as unknown as { author?: { name?: string } | null }).author?.name,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <JsonLd data={appSchema} />
      <CalculatorPage data={redactPeople(data)} nicheName={nicheName} proofRoute={proofToolFor(niche)} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
