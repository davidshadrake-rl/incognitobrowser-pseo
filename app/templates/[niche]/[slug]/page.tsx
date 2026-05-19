import { notFound } from 'next/navigation';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo';
import { TemplatePage } from '@/components/TemplatePage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

interface TemplateData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  description: string;
  templateType: string;
  sections: Array<{
    heading: string;
    content: string;
    placeholders?: Array<{ key: string; label: string; defaultValue: string }>;
  }>;
  useCases: string[];
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  const files = getContentFiles('templates');
  return files.map(f => {
    const [niche, slug] = f.split('/');
    return { niche, slug };
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche, slug } = await params;
  const data = getContentItem<TemplateData>('templates', niche, slug);
  if (!data) return {};
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/templates/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    modifiedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
  });
}

export default async function TemplateDetailPage({ params }: PageProps) {
  const { niche, slug } = await params;
  const data = getContentItem<TemplateData>('templates', niche, slug);
  if (!data) notFound();

  const nicheInfo = getNicheById(niche);
  const nicheName = nicheInfo?.name || niche;

  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Templates', url: '/templates' },
    { name: nicheName, url: `/templates/${niche}` },
    { name: data.title, url: `/templates/${niche}/${slug}` },
  ]);

  const crossLinks = getCrossNicheLinks(niche, 'templates', slug);

  // Per-article Article + Person JSON-LD. Surfaces the byline (Darkpool
  // David, pseudonymous writer) and editor (David Shadrake, LinkedIn-
  // verified) so Google can attribute the page to real entities.
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/templates/${niche}/${slug}`,
    datePublished: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    dateModified: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    author: (data as unknown as { author?: { name: string; bio?: string; credentials?: string; profileUrl?: string; sameAs?: string[] } | null }).author,
    editor: (data as unknown as { editor?: { name: string; profileUrl?: string; sameAs?: string[] } | null }).editor || null,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <TemplatePage data={data} nicheName={nicheName} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
