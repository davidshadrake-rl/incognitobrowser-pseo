import { notFound } from 'next/navigation';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateWebApplicationSchema, generateBreadcrumbSchema } from '@/lib/seo';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import { ToolPageClient } from './client';
import type { Metadata } from 'next';

interface ToolData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  description: string;
  inputs: Array<{
    id: string;
    label: string;
    type: 'text' | 'url' | 'email' | 'textarea' | 'select' | 'number';
    placeholder: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  educational: {
    howItWorks?: string;
    tips?: string[];
    commonMistakes?: string[];
  };
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  const files = getContentFiles('tools');
  return files.map(f => {
    const [niche, slug] = f.split('/');
    return { niche, slug };
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche, slug } = await params;
  const data = getContentItem<ToolData>('tools', niche, slug);
  if (!data) return {};
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/tools/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
  });
}

export default async function ToolDetailPage({ params }: PageProps) {
  const { niche, slug } = await params;
  const data = getContentItem<ToolData>('tools', niche, slug);
  if (!data) notFound();

  const nicheInfo = getNicheById(niche);
  const nicheName = nicheInfo?.name || niche;

  const appSchema = generateWebApplicationSchema(
    data.title,
    data.description,
    `https://incognitobrowser.io/resources/tools/${niche}/${slug}`
  );
  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Tools', url: '/tools' },
    { name: nicheName, url: `/tools/${niche}` },
    { name: data.title, url: `/tools/${niche}/${slug}` },
  ]);

  const crossLinks = getCrossNicheLinks(niche, 'tools', slug);

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <JsonLd data={appSchema} />
      <ToolPageClient data={data} nicheName={nicheName} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
