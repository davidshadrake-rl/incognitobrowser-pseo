import { getAllContentItems } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';
import { PageHero } from '@/components/ui/PageHero';
import { TYPE_ICON } from '@/lib/visuals';

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
      <PageHero
        icon={TYPE_ICON.checklists}
        kicker="Checklists"
        title="Privacy checklists"
        description="Interactive checklists to secure your digital life. Check off items as you go; your progress is saved."
        figure={{ value: items.length, label: 'checklists' }}
      />

      <AtoZCatalogue
        noun="checklists"
        icon={TYPE_ICON.checklists}
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
