import { getAllContentItems, isPublished, type EditableContent } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';
import { PageHero } from '@/components/ui/PageHero';
import { TYPE_ICON } from '@/lib/visuals';

export const metadata = genMeta({
  title: 'Privacy Guides',
  description: 'Step-by-step privacy guides covering browser security, VPNs, encrypted messaging, data brokers, and more.',
  path: '/guides',
  type: 'website',
});

interface GuideMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
}

export default function GuidesIndex() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools'); // the Pro deployment serves tools only
  // Published only, like the home page's count for this type: drafts render
  // (noindex) but are not listed, so every count on the site agrees.
  const items = getAllContentItems<GuideMeta & EditableContent>('guides').filter(isPublished);
  const niches = getAllNiches();
  const nicheMap = Object.fromEntries(niches.map(n => [n.id, n]));


  return (
    <div>
      <PageHero
        icon={TYPE_ICON.guides}
        kicker="Guides"
        title="Privacy guides"
        description="Step-by-step guides to browser security, VPNs, encrypted messaging, data brokers and more."
        figure={{ value: items.length, label: 'guides' }}
      />

      <AtoZCatalogue
        noun="guides"
        icon={TYPE_ICON.guides}
        entries={items.map(item => ({
          title: item.title,
          href: `/guides/${item._niche}/${item._slug}`,
          description: item.metaDescription,
          meta: nicheMap[item._niche]?.name || item._niche,
          badge: item.difficulty,
          keywords: item._niche,
        }))}
        topics={Array.from(new Set(items.map(i => i._niche))).map(n => ({ label: nicheMap[n]?.name || n, href: `/guides/${n}` })).sort((a, b) => a.label.localeCompare(b.label))}
      />

      {items.length === 0 && (
        <div className="text-center py-12 text-t3">
          <p className="text-lg">Guides are being generated. Check back soon!</p>
        </div>
      )}

    </div>
  );
}
