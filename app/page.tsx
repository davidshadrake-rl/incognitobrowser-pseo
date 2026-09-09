import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getAllNiches, getAllContentTypes } from '@/lib/taxonomy';
import { Icon, IconTile } from '@/components/ui/Icon';
import { TYPE_ICON } from '@/lib/visuals';

export default function HomePage() {
  // The Pro deployment has no pSEO home — it IS the tools section.
  if (IS_PRO_DEPLOYMENT) redirect('/tools');
  const contentTypes = getAllContentTypes();
  const niches = getAllNiches();
  const tierOneNiches = niches.filter(n => n.tier === 1);

  return (
    <div>
      {/* Hero */}
      <section className="text-center py-16 mb-12" style={{ background: 'linear-gradient(-41deg, rgba(61,61,82,0) 10%, rgba(61,61,82,0.75) 40%)' }}>
        <h1 className="text-4xl font-bold text-white mb-4">
          Free Privacy Resources
        </h1>
        <p className="text-lg text-t2 max-w-2xl mx-auto mb-8">
          Interactive checklists, tools, guides, comparisons, and templates to help you
          protect your online privacy. All free, no account required.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          {contentTypes.map(ct => (
            <Link
              key={ct.slug}
              href={`/${ct.slug}`}
              className="btn-secondary text-xs"
            >
              <Icon name={TYPE_ICON[ct.slug] ?? 'arrow'} size={14} />
              {ct.name}
            </Link>
          ))}
        </div>
      </section>

      {/* Content types grid */}
      <section className="mb-16">
        <h2 className="text-2xl font-bold text-white mb-6">Browse by Type</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {contentTypes.map(ct => (
            <Link key={ct.slug} href={`/${ct.slug}`} className="group">
              <div className="border border-b1 rounded-lg p-6 hover:border-b2 bg-s0 transition-all">
                <IconTile name={TYPE_ICON[ct.slug] ?? 'arrow'} className="mb-3" />
                <h3 className="text-lg font-semibold text-white group-hover:text-t2 mb-1">
                  {ct.name}
                </h3>
                <p className="text-sm text-t2">{ct.description}</p>
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
              className="px-3 py-1.5 border border-b1 bg-s1 text-t2 rounded-[4px] text-sm hover:border-b2 hover:text-white transition-colors"
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
