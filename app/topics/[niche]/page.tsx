import { notFound } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import Link from 'next/link';
import { getAllNiches, getNicheBySlug, getRelatedNiches } from '@/lib/taxonomy';
import { getContentFiles, getContentItemTitle, isToolVisible } from '@/lib/content';
import { generateMetadata as genMeta, generateBreadcrumbSchema } from '@/lib/seo';
import { JsonLd } from '@/components/seo/JsonLd';
import type { Metadata } from 'next';

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string }>;
}

const CONTENT_TYPES = [
  { slug: 'guides', name: 'Guides', icon: '\u{1F4D6}', description: 'Step-by-step tutorials' },
  { slug: 'checklists', name: 'Checklists', icon: '\u2611', description: 'Actionable task lists' },
  { slug: 'comparisons', name: 'Comparisons', icon: '\u2194', description: 'Product & tool reviews' },
  { slug: 'tools', name: 'Tools', icon: '\u2699', description: 'Interactive privacy tools' },
  { slug: 'templates', name: 'Templates', icon: '\u{1F4C4}', description: 'Ready-to-use documents' },
  { slug: 'calculators', name: 'Calculators', icon: '\u{1F522}', description: 'Privacy assessments' },
];

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return []; // Pro deployment serves tools only
  const niches = getAllNiches();
  return niches.map(n => ({ niche: n.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche } = await params;
  const nicheData = getNicheBySlug(niche);
  if (!nicheData) return {};
  return genMeta({
    title: `${nicheData.name} - Privacy Resources`,
    description: `Everything you need to know about ${nicheData.name.toLowerCase()}: guides, checklists, tools, comparisons, templates, and calculators. ${nicheData.description}`,
    path: `/topics/${niche}`,
    type: 'website',
  });
}

export default async function NicheHubPage({ params }: PageProps) {
  const { niche } = await params;
  const nicheData = getNicheBySlug(niche);
  if (!nicheData) notFound();

  const relatedNiches = getRelatedNiches(nicheData.id);

  // Gather all content for this niche across content types
  const sections = CONTENT_TYPES.map(ct => {
    const files = getContentFiles(ct.slug, niche).filter(slug => ct.slug !== 'tools' || isToolVisible(niche, slug));
    const items = files.map(slug => ({
      slug,
      title: getContentItemTitle(ct.slug, niche, slug),
      href: `/${ct.slug}/${niche}/${slug}`,
    }));
    return { ...ct, items };
  }).filter(s => s.items.length > 0);

  const totalItems = sections.reduce((sum, s) => sum + s.items.length, 0);

  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Topics', url: '/' },
    { name: nicheData.name, url: `/topics/${niche}` },
  ]);

  const collectionSchema = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: `${nicheData.name} - Privacy Resources`,
    description: nicheData.description,
    url: `https://incognitobrowser.io/resources/topics/${niche}`,
    numberOfItems: totalItems,
  };

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <JsonLd data={collectionSchema} />

      {/* Hero */}
      <section className="py-12 mb-10" style={{ background: 'linear-gradient(-41deg, rgba(61,61,82,0) 10%, rgba(61,61,82,0.75) 40%)' }}>
        <nav className="text-sm text-[#B8B8D4]/60 mb-4">
          <Link href="/" className="hover:text-white">Resources</Link>
          <span className="mx-2">/</span>
          <span className="text-[#B8B8D4]">{nicheData.name}</span>
        </nav>
        <h1 className="text-3xl md:text-4xl font-bold text-white mb-3">
          {nicheData.name}
        </h1>
        <p className="text-lg text-[#B8B8D4] max-w-3xl mb-4">
          {nicheData.description}
        </p>
        <p className="text-sm text-[#B8B8D4]/60">
          {totalItems} resources across {sections.length} categories
        </p>
      </section>

      {/* Content sections */}
      {sections.map(section => (
        <section key={section.slug} className="mb-12">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-2xl">{section.icon}</span>
            <div>
              <h2 className="text-xl font-bold text-white">{section.name}</h2>
              <p className="text-sm text-[#B8B8D4]/60">{section.description}</p>
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {section.items.map(item => (
              <Link
                key={item.href}
                href={item.href}
                className="group border border-white/10 rounded-lg p-4 hover:border-white/30 bg-[#0a0a0a] transition-all"
              >
                <span className="text-sm font-medium text-white group-hover:text-[#cfcfcf]">
                  {item.title}
                </span>
                <span className="block text-xs text-[#B8B8D4]/50 mt-1 capitalize">{section.slug.slice(0, -1)}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}

      {/* Related topics */}
      {relatedNiches.length > 0 && (
        <section className="mt-16 pt-8 border-t border-white/10">
          <h2 className="text-xl font-bold text-white mb-4">Related Topics</h2>
          <div className="flex flex-wrap gap-2">
            {relatedNiches.map(rn => (
              <Link
                key={rn.slug}
                href={`/topics/${rn.slug}`}
                className="px-4 py-2 border border-white/10 text-[#B8B8D4] rounded-full text-sm hover:border-white/40 hover:text-white transition-colors"
              >
                {rn.name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Keywords for SEO */}
      {nicheData.keywords.length > 0 && (
        <section className="mt-8 mb-4">
          <h3 className="text-sm font-medium text-[#B8B8D4]/40 mb-2">Related searches</h3>
          <div className="flex flex-wrap gap-1">
            {nicheData.keywords.map((kw, i) => (
              <span key={i} className="text-xs bg-white/5 text-[#B8B8D4]/50 px-2 py-0.5 rounded border border-white/5">
                {kw}
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
