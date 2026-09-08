import { getAllContentItems } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';

export const metadata = genMeta({
  title: 'Privacy Comparisons',
  description: 'Side-by-side comparisons of privacy tools, browsers, VPNs, messaging apps, and more.',
  path: '/comparisons',
  type: 'website',
});

interface ComparisonMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
}

export default function ComparisonsIndex() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools'); // the Pro deployment serves tools only
  const items = getAllContentItems<ComparisonMeta>('comparisons');
  const niches = getAllNiches();
  const nicheMap = Object.fromEntries(niches.map(n => [n.id, n]));


  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Comparisons</h1>
      <p className="text-[#B8B8D4] mb-8">
        Side-by-side comparisons to help you choose the best privacy tools for your needs.
      </p>

      <AtoZCatalogue
        noun="comparisons"
        entries={items.map(item => ({
          title: item.title,
          href: `/comparisons/${item._niche}/${item._slug}`,
          description: item.metaDescription,
          meta: nicheMap[item._niche]?.name || item._niche,
          
          keywords: item._niche,
        }))}
        topics={Array.from(new Set(items.map(i => i._niche))).map(n => ({ label: nicheMap[n]?.name || n, href: `/comparisons/${n}` })).sort((a, b) => a.label.localeCompare(b.label))}
      />

      {items.length === 0 && (
        <div className="text-center py-12 text-[#B8B8D4]/60">
          <p className="text-lg">Comparisons are being generated. Check back soon!</p>
        </div>
      )}

    </div>
  );
}
