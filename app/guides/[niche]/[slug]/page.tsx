import { notFound } from 'next/navigation';
import { getContentItem, getContentFiles, getCrossNicheLinks } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateHowToSchema, generateFAQSchema, generateBreadcrumbSchema } from '@/lib/seo';
import { GuidePage } from '@/components/GuidePage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

interface GuideData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
  estimatedTime: string;
  intro?: string;
  prerequisites: string[];
  steps: Array<{
    stepNumber: number;
    title: string;
    description: string;
    actions: string[];
    proTip?: string;
    warning?: string;
  }>;
  faqs: Array<{ question: string; answer: string }>;
  relatedLinks: Array<{ title: string; url: string; type: string }>;
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  const files = getContentFiles('guides');
  return files.map(f => {
    const [niche, slug] = f.split('/');
    return { niche, slug };
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche, slug } = await params;
  const data = getContentItem<GuideData>('guides', niche, slug);
  if (!data) return {};
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/guides/${niche}/${slug}`,
  });
}

export default async function GuideDetailPage({ params }: PageProps) {
  const { niche, slug } = await params;
  const data = getContentItem<GuideData>('guides', niche, slug);
  if (!data) notFound();

  const nicheInfo = getNicheById(niche);
  const nicheName = nicheInfo?.name || niche;

  const howToSchema = generateHowToSchema(data.title, data.steps);
  const faqSchema = data.faqs.length > 0 ? generateFAQSchema(data.faqs, `/guides/${niche}/${slug}`) : null;
  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Guides', url: '/guides' },
    { name: nicheName, url: `/guides/${niche}` },
    { name: data.title, url: `/guides/${niche}/${slug}` },
  ]);

  const crossLinks = getCrossNicheLinks(niche, 'guides', slug);

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <JsonLd data={howToSchema} />
      {faqSchema && <JsonLd data={faqSchema} />}
      <GuidePage data={data} nicheName={nicheName} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
