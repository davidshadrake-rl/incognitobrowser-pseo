import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished, redactPeople, type EditableContent } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { funnelFor } from '@/lib/funnels';
import { generateMetadata as genMeta, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo';
import { TemplatePage } from '@/components/TemplatePage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';
import { proofToolFor } from '@/lib/proof-route';

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
  if (IS_PRO_DEPLOYMENT) return [{ niche: '_pro_export_placeholder_', slug: '_pro_export_placeholder_' }]; // Pro serves tools only; output:export needs ≥1 static param per dynamic route, so this ships one placeholder that resolves to no real content (notFound() below skips it in the actual output)
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
  const { editorial } = data as unknown as EditableContent;
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/templates/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: editorial?.reviewedAt || undefined,
    modifiedAt: editorial?.updatedAt || editorial?.reviewedAt || undefined,
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
  // Published is the review; modified is the last text change after it
  // (editorial.updatedAt), else the review. An edit never moves the review date.
  const { editorial } = data as unknown as EditableContent;
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/templates/${niche}/${slug}`,
    datePublished: editorial?.reviewedAt || undefined,
    dateModified: editorial?.updatedAt || editorial?.reviewedAt || undefined,
    attributed: !!(data as unknown as { author?: { name?: string } | null }).author?.name,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <TemplatePage data={redactPeople(data)} nicheName={nicheName} proofRoute={proofToolFor(niche)}funnel={funnelFor(`/templates/${niche}/${slug}`)} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
