import { notFound } from 'next/navigation';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateWebApplicationSchema, generateBreadcrumbSchema } from '@/lib/seo';
import { CalculatorPage } from '@/components/CalculatorPage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

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

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <JsonLd data={appSchema} />
      <CalculatorPage data={data} nicheName={nicheName} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
