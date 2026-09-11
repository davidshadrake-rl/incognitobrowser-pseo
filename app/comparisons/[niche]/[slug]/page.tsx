import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished, redactPeople } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateFAQSchema, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo';
import { ComparisonPage } from '@/components/ComparisonPage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';
import { proofToolFor } from '@/lib/proof-route';
import { toComparisonView, type ComparisonSource } from '@/lib/comparison-score';

/**
 * A comparison data file. Ratings are not part of it as far as the page is
 * concerned: lib/comparison-score.ts works them out from `features`, and any
 * products[].rating still in a file is never read.
 */
interface ComparisonData extends ComparisonSource {
  slug: string;
  metaDescription: string;
  faqs: Array<{ question: string; answer: string }>;
  editorial?: { status?: string; reviewedAt?: string | null };
  author?: { name?: string } | null;
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return [{ niche: '_pro_export_placeholder_', slug: '_pro_export_placeholder_' }]; // Pro serves tools only; output:export needs ≥1 static param per dynamic route, so this ships one placeholder that resolves to no real content (notFound() below skips it in the actual output)
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
    publishedAt: data.editorial?.reviewedAt || undefined,
    modifiedAt: data.editorial?.reviewedAt || undefined,
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

  // Article JSON-LD. It credits the editorial masthead (an organisation), not
  // a person; `attributed` only says the page went through the promote
  // pipeline.
  const articleSchema = generateArticleSchema({
    headline: data.title,
    description: data.metaDescription || '',
    url: 'https://incognitobrowser.io/resources' + `/comparisons/${niche}/${slug}`,
    datePublished: data.editorial?.reviewedAt || undefined,
    dateModified: data.editorial?.reviewedAt || undefined,
    attributed: !!data.author?.name,
  });

  // The client component gets only what it renders (toComparisonView is a
  // whitelist: no people, no typed rating, no cell notes) plus whether the
  // page was reviewed, computed by the same rule as every other page.
  const { reviewed } = redactPeople(data);

  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      {faqSchema && <JsonLd data={faqSchema} />}
      <ComparisonPage data={toComparisonView(data)} nicheName={nicheName} reviewed={reviewed} proofRoute={proofToolFor(niche)} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
