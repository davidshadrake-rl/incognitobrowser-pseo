import { notFound } from 'next/navigation';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished, freeSitePrefix, redactPeople, type EditableContent } from '@/lib/content';
import { tierOfEngine } from '@/lib/tiers';
import { proHandoffFor } from '@/lib/proof-route';
import type { NextStepsData } from '@/components/NextSteps';
import { getNicheById } from '@/lib/taxonomy';
import { engineVisibleInThisTier } from '@/lib/tiers';
import { generateMetadata as genMeta, generateWebApplicationSchema, generateBreadcrumbSchema, generateArticleSchema, absoluteUrl } from '@/lib/seo';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import { ToolPageClient } from './client';
import { ENGINE_DIAGRAM, familyOfEngine } from '@/lib/visuals';
import type { Metadata } from 'next';

interface ToolData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  description: string;
  toolEngine?: string;
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

/**
 * Three concrete steps for the post-result "what to do now" block. Tries, in
 * order: (1) a published checklist in the tool's own niche, (2) a published
 * checklist in a related niche (data/taxonomy.json relatedNiches — most
 * niches share enough ground that this reads naturally), (3) the tool's own
 * "tips" as a last resort, so a niche whose checklists are still drafts (a
 * genuine content-pipeline gap, confirmed 2026-09-08 for digital-footprint
 * and encrypted-messaging) never silently drops this funnel surface.
 */
function checklistSteps(niche: string, nicheName: string): NextStepsData | null {
  for (const slug of getContentFiles('checklists', niche)) {
    const c = getContentItem<{ title: string; sections?: Array<{ items?: Array<{ task: string; why: string }> }> } & Parameters<typeof isPublished>[0]>('checklists', niche, slug);
    if (!c || !isPublished(c)) continue;
    const steps = (c.sections || []).flatMap((sec) => sec.items || []).filter((i) => i.task && i.why).slice(0, 3).map((i) => ({ task: i.task, why: i.why }));
    if (steps.length) return { nicheName, checklistTitle: c.title, checklistHref: `${freeSitePrefix()}/checklists/${niche}/${slug}`, steps };
  }
  return null;
}

function nextStepsFor(niche: string, nicheName: string, fallbackTips: string[] | undefined): NextStepsData | null {
  const own = checklistSteps(niche, nicheName);
  if (own) return own;
  const related = getNicheById(niche)?.relatedNiches || [];
  for (const r of related) {
    // Keep the related niche's name: the block says which checklist the steps
    // come from, and it used to name this page's topic instead ("Three steps
    // from the Digital Footprint checklist" above a Data Broker checklist link).
    const viaRelated = checklistSteps(r, getNicheById(r)?.name || r);
    if (viaRelated) return viaRelated;
  }
  if (fallbackTips?.length) {
    return {
      nicheName,
      fromTips: true,
      checklistTitle: `${nicheName} tips`,
      checklistHref: `${freeSitePrefix()}/topics/${niche}`,
      steps: fallbackTips.slice(0, 3).map((tip) => ({ task: tip, why: '' })),
    };
  }
  return null;
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
  const { editorial } = data as unknown as EditableContent;
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/tools/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: editorial?.reviewedAt || undefined,
    modifiedAt: editorial?.updatedAt || editorial?.reviewedAt || undefined,
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

  // Per-article Article JSON-LD, credited to the editorial masthead (see
  // generateArticleSchema for why no person is named). Published is the
  // review; modified is the last text change after it (editorial.updatedAt),
  // else the review. An edit never moves the review date.
  const { editorial } = data as unknown as EditableContent;
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: absoluteUrl(`/tools/${niche}/${slug}`),
    datePublished: editorial?.reviewedAt || undefined,
    dateModified: editorial?.updatedAt || editorial?.reviewedAt || undefined,
    attributed: !!(data as unknown as { author?: { name?: string } | null }).author?.name,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <JsonLd data={appSchema} />
      <ToolPageClient
        data={redactPeople(data)}
        nicheName={nicheName}
        niche={niche}
        nextSteps={nextStepsFor(niche, nicheName, data.educational?.tips)}
        proWebUrl={proHandoffFor(niche)}
        diagram={data.toolEngine ? (ENGINE_DIAGRAM[data.toolEngine] ?? 'tracking') : 'tracking'}
        family={data.toolEngine ? familyOfEngine(data.toolEngine) : 'trace'}
        tier={tierOfEngine(data.toolEngine)}
      />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `${freeSitePrefix()}/topics/${niche}` }}
      />
    </>
  );
}
