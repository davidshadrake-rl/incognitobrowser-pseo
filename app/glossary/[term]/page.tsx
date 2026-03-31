import { notFound } from 'next/navigation';
import { getGlossaryItem, getGlossaryFiles } from '@/lib/content';
import { generateMetadata as genMeta, generateBreadcrumbSchema } from '@/lib/seo';
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
  });
}

export default async function GlossaryDetailPage({ params }: PageProps) {
  const { term } = await params;
  const data = getGlossaryItem<GlossaryData>(term);
  if (!data) notFound();

  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Glossary', url: '/glossary' },
    { name: data.term, url: `/glossary/${term}` },
  ]);

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <GlossaryTermPage data={data} />
    </>
  );
}
