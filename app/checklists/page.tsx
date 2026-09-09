import { getAllContentItems } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';

export const metadata = genMeta({
  title: 'Privacy Checklists',
  description: 'Interactive privacy and security checklists. Track your progress as you harden your browser, devices, and online accounts.',
  path: '/checklists',
  type: 'website',
});

interface ChecklistMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
}

export default function ChecklistsIndex() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools'); // the Pro deployment serves tools only
  const items = getAllContentItems<ChecklistMeta>('checklists');
  const niches = getAllNiches();
  const nicheMap = Object.fromEntries(niches.map(n => [n.id, n]));


  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Checklists</h1>
      <p className="text-t2 mb-8">
        Interactive checklists to help you secure your digital life. Check off items as you go — your progress is saved.
      </p>

      <AtoZCatalogue
        noun="checklists"
        entries={items.map(item => ({
          title: item.title,
          href: `/checklists/${item._niche}/${item._slug}`,
          description: item.metaDescription,
          meta: nicheMap[item._niche]?.name || item._niche,
          
          keywords: item._niche,
        }))}
        topics={Array.from(new Set(items.map(i => i._niche))).map(n => ({ label: nicheMap[n]?.name || n, href: `/checklists/${n}` })).sort((a, b) => a.label.localeCompare(b.label))}
      />

      {items.length === 0 && (
        <div className="text-center py-12 text-t3">
          <p className="text-lg">Checklists are being generated. Check back soon!</p>
        </div>
      )}

    </div>
  );
}
