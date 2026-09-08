import { notFound } from 'next/navigation';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished, freeSitePrefix } from '@/lib/content';
import { IS_PRO_DEPLOYMENT, tierOfEngine, proUrlFor } from '@/lib/tiers';
import type { NextStepsData } from '@/components/NextSteps';
import { getNicheById } from '@/lib/taxonomy';
import { engineVisibleInThisTier } from '@/lib/tiers';
import { generateMetadata as genMeta, generateWebApplicationSchema, generateBreadcrumbSchema, generateArticleSchema, absoluteUrl } from '@/lib/seo';
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

/** Three concrete steps from the niche's first published checklist — the post-result "what to do now" block. */
function nextStepsFor(niche: string, nicheName: string): NextStepsData | null {
  for (const slug of getContentFiles('checklists', niche)) {
    const c = getContentItem<{ title: string; sections?: Array<{ items?: Array<{ task: string; why: string }> }> } & Parameters<typeof isPublished>[0]>('checklists', niche, slug);
    if (!c || !isPublished(c)) continue;
    const steps = (c.sections || []).flatMap((sec) => sec.items || []).filter((i) => i.task && i.why).slice(0, 3).map((i) => ({ task: i.task, why: i.why }));
    if (steps.length) return { nicheName, checklistTitle: c.title, checklistHref: `${freeSitePrefix()}/checklists/${niche}/${slug}`, steps };
  }
  return null;
}

/** On the free site: the Pro web tool for this niche, if the niche has one. */
function proWebUrlFor(niche: string): string | undefined {
  if (IS_PRO_DEPLOYMENT) return undefined;
  for (const slug of getContentFiles('tools', niche)) {
    const t = getContentItem<{ toolEngine?: string }>('tools', niche, slug);
    if (t && tierOfEngine(t.toolEngine) === 'pro') return proUrlFor(niche, slug);
  }
  return undefined;
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  const files = getContentFiles('tools');
  return files
    .map(f => { const [niche, slug] = f.split('/'); return { niche, slug }; })
    // Each deployment renders only its own tier's engines (free: free, Pro: Pro).
    .filter(({ niche, slug }) => engineVisibleInThisTier(getContentItem<{ toolEngine?: string }>('tools', niche, slug)?.toolEngine));
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
    publishedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    modifiedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
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
    absoluteUrl(`/tools/${niche}/${slug}`)
  );
  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Tools', url: '/tools' },
    { name: nicheName, url: `/tools/${niche}` },
    { name: data.title, url: `/tools/${niche}/${slug}` },
  ]);

  const crossLinks = getCrossNicheLinks(niche, 'tools', slug);

  // Per-article Article + Person JSON-LD. Surfaces the byline (Darkpool
  // David, pseudonymous writer) and editor (David Shadrake, LinkedIn-
  // verified) so Google can attribute the page to real entities.
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: absoluteUrl(`/tools/${niche}/${slug}`),
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
      <ToolPageClient data={data} nicheName={nicheName} nextSteps={nextStepsFor(niche, nicheName)} proWebUrl={proWebUrlFor(niche)} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `${freeSitePrefix()}/topics/${niche}` }}
      />
    </>
  );
}
