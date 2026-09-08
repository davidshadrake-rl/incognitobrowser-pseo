import Link from 'next/link';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { getAllNiches, getAllContentTypes } from '@/lib/taxonomy';

const icons: Record<string, string> = {
  checklists: '\u2611',
  tools: '\u2699',
  guides: '\u{1F4D6}',
  comparisons: '\u2194',
  glossary: '\u{1F4DC}',
  templates: '\u{1F4C4}',
  calculators: '\u{1F522}',
};

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
        <p className="text-lg text-[#B8B8D4] max-w-2xl mx-auto mb-8">
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
              <span aria-hidden="true">{icons[ct.slug] || ''}</span>
              {' '}{ct.name}
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
              <div className="border border-white/10 rounded-lg p-6 hover:border-white/40 bg-[#0a0a0a] transition-all">
                <div className="text-3xl mb-3" aria-hidden="true">{icons[ct.slug] || ''}</div>
                <h3 className="text-lg font-semibold text-white group-hover:text-[#cfcfcf] mb-1">
                  {ct.name}
                </h3>
                <p className="text-sm text-[#B8B8D4]">{ct.description}</p>
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
              className="px-4 py-2 border border-white/10 text-[#B8B8D4] rounded-full text-sm hover:border-white/40 hover:text-white transition-colors"
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
              <div className="border border-white/10 rounded-lg p-4 bg-[#0a0a0a] hover:border-white/30 transition-all">
                <h3 className="font-semibold text-white group-hover:text-[#cfcfcf] mb-1">{niche.name}</h3>
                <p className="text-sm text-[#B8B8D4] mb-3">{niche.description}</p>
                <div className="flex flex-wrap gap-1">
                  {niche.keywords.slice(0, 3).map((kw, i) => (
                    <span key={i} className="text-xs bg-white/5 text-[#B8B8D4]/70 px-2 py-0.5 rounded border border-white/5">
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
