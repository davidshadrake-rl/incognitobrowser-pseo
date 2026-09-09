import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT, engineVisibleInThisTier } from '@/lib/tiers';
import { getAllNiches, getAllContentTypes, type ContentType } from '@/lib/taxonomy';
import { getAllContentItems, getGlossaryFiles, isPublished, type EditableContent } from '@/lib/content';
import { Icon, IconTile } from '@/components/ui/Icon';
import { Rings } from '@/components/ui/Rings';
import { Diagram } from '@/components/ui/Diagram';
import { TYPE_ICON } from '@/lib/visuals';
import { playUrl } from '@/lib/play';

/** Glossary items are "terms" everywhere else in the site (AtoZCatalogue noun="terms"); every other slug already reads as a plural noun. */
const COUNT_NOUN: Record<string, string> = { glossary: 'terms' };

/** Published item count for a content type (DESIGN-SPEC 5.2's grid `count`). */
function countForType(slug: string): number {
  if (slug === 'glossary') return getGlossaryFiles().length;
  const items = getAllContentItems<{ toolEngine?: string } & EditableContent>(slug);
  return items.filter(i => (slug !== 'tools' || engineVisibleInThisTier(i.toolEngine)) && isPublished(i)).length;
}

export default function HomePage() {
  // The Pro deployment has no pSEO home — it IS the tools section.
  if (IS_PRO_DEPLOYMENT) redirect('/tools');
  const contentTypes = getAllContentTypes();
  const niches = getAllNiches();
  const tierOneNiches = niches.filter(n => n.tier === 1);
  const counts: Record<string, number> = Object.fromEntries(contentTypes.map((ct: ContentType) => [ct.slug, countForType(ct.slug)]));
  const toolsCount = counts['tools'] ?? 0;

  return (
    <div>
      {/* Hero (DESIGN-SPEC 5.2) */}
      <section
        className="relative overflow-hidden rounded-[16px] border border-b1 p-8 md:p-12 grid lg:grid-cols-[1.2fr_1fr] gap-8 items-center mb-16"
        style={{ backgroundImage: 'var(--accent-gradient)' }}
      >
        <Rings />
        <div className="relative min-w-0">
          <p className="text-kicker uppercase text-t3 mb-3">Free privacy tools and guides</p>
          <h1 className="font-mono text-[40px] leading-[1.1] font-semibold text-t1 mb-4">
            Know what the web sees. Then hide it.
          </h1>
          <p className="prose-ib text-lede mb-6">
            Free checks that run in your browser, from the team behind Incognito Browser. No account, no upload.
          </p>
          <div className="flex flex-wrap gap-3">
            <Link href="/tools" className="btn-primary">Try a tool</Link>
            <a href={playUrl({ medium: 'site', campaign: 'home-hero' })} rel="noopener" className="btn-secondary">Get the free app</a>
          </div>
        </div>
        <div className="relative hidden lg:block">
          <Icon name="hat" size={280} className="absolute -right-6 -bottom-10 text-t2/5 pointer-events-none" aria-hidden />
          <div className="relative w-[320px]">
            <Diagram id="tracking" />
          </div>
          <p className="figure mt-4">
            <b>{toolsCount}</b>
            <span>tools</span>
          </p>
        </div>
      </section>

      {/* Content types grid (DESIGN-SPEC 5.2) */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold text-white mb-6">Browse by Type</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contentTypes.map(ct => (
            <Link key={ct.slug} href={`/${ct.slug}`} className="group relative grid grid-cols-[40px_1fr] gap-3.5 bg-s0 border border-b1 rounded-[12px] p-4 hover:border-b2 transition-colors">
              <IconTile name={TYPE_ICON[ct.slug] ?? 'arrow'} />
              <div className="min-w-0">
                <h3 className="font-mono text-[15px] font-semibold text-t1">{ct.name}</h3>
                <p className="text-row text-t2 mt-1">{ct.description}</p>
                <p className="text-meta text-t3 tnum mt-2">{counts[ct.slug] ?? 0} {COUNT_NOUN[ct.slug] ?? ct.slug}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* Browse by topic */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold text-white mb-6">Popular Topics</h2>
        <div className="flex flex-wrap gap-2">
          {tierOneNiches.map(niche => (
            <Link
              key={niche.slug}
              href={`/topics/${niche.slug}`}
              className="rounded-[4px] bg-s1 border border-b1 px-3 py-1.5 text-meta hover:border-b2 transition-colors"
            >
              {niche.name}
            </Link>
          ))}
        </div>
      </section>

      {/* All topics */}
      <section>
        <h2 className="text-2xl font-bold text-white mb-6">All Privacy Topics</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {niches.map(niche => (
            <Link key={niche.slug} href={`/topics/${niche.slug}`} className="group">
              <div className="border border-b1 rounded-lg p-4 bg-s0 hover:border-b2 transition-all">
                <h3 className="font-semibold text-white group-hover:text-t2 mb-1">{niche.name}</h3>
                <p className="text-sm text-t2 mb-3">{niche.description}</p>
                <div className="flex flex-wrap gap-1">
                  {niche.keywords.slice(0, 3).map((kw, i) => (
                    <span key={i} className="text-xs bg-white/5 text-t3 px-2 py-0.5 rounded border border-hair">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
