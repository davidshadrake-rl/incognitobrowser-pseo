import { getAllContentItems } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';

export const metadata = genMeta({
  title: 'Privacy Calculators',
  description: 'Interactive privacy calculators: risk score, data exposure cost, privacy rating, and more.',
  path: '/calculators',
  type: 'website',
});

interface CalcMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
}

export default function CalculatorsIndex() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools'); // the Pro deployment serves tools only
  const items = getAllContentItems<CalcMeta>('calculators');
  const niches = getAllNiches();
  const nicheMap = Object.fromEntries(niches.map(n => [n.id, n]));


  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Calculators</h1>
      <p className="text-t2 mb-8">
        Interactive calculators to assess your privacy risk, estimate data exposure, and more.
      </p>

      <AtoZCatalogue
        noun="calculators"
        entries={items.map(item => ({
          title: item.title,
          href: `/calculators/${item._niche}/${item._slug}`,
          description: item.metaDescription,
          meta: nicheMap[item._niche]?.name || item._niche,
          
          keywords: item._niche,
        }))}
        topics={Array.from(new Set(items.map(i => i._niche))).map(n => ({ label: nicheMap[n]?.name || n, href: `/calculators/${n}` })).sort((a, b) => a.label.localeCompare(b.label))}
      />

      {items.length === 0 && (
        <div className="text-center py-12 text-t3">
          <p className="text-lg">Calculators are being generated. Check back soon!</p>
        </div>
      )}

    </div>
  );
}
