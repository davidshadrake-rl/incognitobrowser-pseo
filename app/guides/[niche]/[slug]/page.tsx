import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getContentItem, getContentFiles, getGlossaryFiles, getCrossNicheLinks, isPublished, isToolListed } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateHowToSchema, generateFAQSchema, generateBreadcrumbSchema, generateArticleSchema } from '@/lib/seo';
import { GuidePage } from '@/components/GuidePage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';
import { proofToolFor } from '@/lib/proof-route';

/**
 * relatedLinks[] is hand/AI-authored per guide and, across the corpus,
 * frequently stale: single-segment slugs, a niche name standing in for a
 * path, targets that were never generated. Nothing rendered this field
 * before GuidePage started weaving it into prose (lib/inline-links.ts), so
 * a broken entry was silently inert; weaving it verbatim would ship a
 * dangling link (tests/link-audit.test.ts, DESIGN-SPEC section 9 "do not
 * break the export"). Only keep a link weaveLinks is allowed to turn into a
 * real anchor: any http(s) URL (external sites are not ours to validate at
 * build time — same trust boundary RelatedContent already accepts), or a
 * same-site path that resolves to a page this build actually produces.
 */
const VALIDATED_CONTENT_TYPES = ['guides', 'checklists', 'comparisons', 'calculators', 'templates'] as const;

let knownInternalPaths: Set<string> | null = null;
function getKnownInternalPaths(): Set<string> {
  if (knownInternalPaths) return knownInternalPaths;
  const known = new Set<string>();
  for (const type of VALIDATED_CONTENT_TYPES) {
    for (const f of getContentFiles(type)) known.add(`/${type}/${f}`);
  }
  for (const slug of getGlossaryFiles()) known.add(`/glossary/${slug}`);
  knownInternalPaths = known;
  return known;
}

function resolvableRelatedLinks(
  links: Array<{ title: string; url: string; type: string }> | undefined
): Array<{ title: string; url: string; type: string }> {
  if (!links || links.length === 0) return [];
  const known = getKnownInternalPaths();
  return links
    .filter((l) => l && l.title && l.url)
    .filter((l) => {
      if (/^https?:\/\//i.test(l.url)) return true;
      if (!l.url.startsWith('/')) return false;
      const p = l.url.replace(/\/+$/, '');
      const toolMatch = p.match(/^\/tools\/([^/]+)\/([^/]+)$/);
      if (toolMatch) return isToolListed(toolMatch[1], toolMatch[2]);
      return known.has(p);
    })
    .map((l) => ({ ...l, type: /^https?:\/\//i.test(l.url) ? 'external' : 'internal' }));
}

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
  pro_tips?: string[];
  relatedLinks: Array<{ title: string; url: string; type: string }>;
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return [{ niche: '_pro_export_placeholder_', slug: '_pro_export_placeholder_' }]; // Pro serves tools only; output:export needs ≥1 static param per dynamic route, so this ships one placeholder that resolves to no real content (notFound() below skips it in the actual output)
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
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
    publishedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    modifiedAt: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
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

  // ~38% of guides ship a relatedLinks[] whose entries are entirely
  // unresolvable (see resolvableRelatedLinks above) — the guide would then
  // weave zero inline links, quietly missing the owner's global pSEO rule
  // (~/.claude/CLAUDE.md: 2-4 inline links in every long-form page's prose).
  // crossLinks is already validated (getCrossNicheLinks only ever returns
  // real, buildable targets), so it is a safe fallback source for weaving
  // when the guide's own authored links are unusable; it still renders in
  // full as the RelatedContent card grid below regardless.
  // Top up rather than choose: most guides author 1-3 links and only some of
  // them resolve, so an either/or left 23 guides with a single inline link,
  // under the 2-4 the spec asks for.
  const ownRelatedLinks = resolvableRelatedLinks(data.relatedLinks);
  const weaveLinkCandidates = [
    ...ownRelatedLinks,
    ...crossLinks.filter(c => !ownRelatedLinks.some(o => o.url === c.url)),
  ].slice(0, 4);

  // Per-article Article + Person JSON-LD. Surfaces the byline (Darkpool
  // David, pseudonymous writer) and editor (David Shadrake, LinkedIn-
  // verified) so Google can attribute the page to real entities.
  const articleSchema = generateArticleSchema({
    headline: (data as unknown as { title: string }).title,
    description: (data as unknown as { metaDescription?: string; definition?: string }).metaDescription
      || (data as unknown as { definition?: string }).definition
      || '',
    url: 'https://incognitobrowser.io/resources' + `/guides/${niche}/${slug}`,
    datePublished: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    dateModified: (data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt || undefined,
    author: (data as unknown as { author?: { name: string; bio?: string; credentials?: string; profileUrl?: string; sameAs?: string[] } | null }).author,
    editor: (data as unknown as { editor?: { name: string; profileUrl?: string; sameAs?: string[] } | null }).editor || null,
  });


  return (
    <>
      <JsonLd data={breadcrumbs} />
      {articleSchema && <JsonLd data={articleSchema} />}
      <JsonLd data={howToSchema} />
      {faqSchema && <JsonLd data={faqSchema} />}
      <GuidePage
        data={{ ...data, relatedLinks: weaveLinkCandidates }}
        nicheName={nicheName}
        proofRoute={proofToolFor(niche)}
      />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
