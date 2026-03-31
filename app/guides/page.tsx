import { getAllContentItems } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { Card } from '@/components/ui/Card';

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
  const items = getAllContentItems<GuideMeta>('guides');
  const niches = getAllNiches();
  const nicheMap = Object.fromEntries(niches.map(n => [n.id, n]));

  const grouped = items.reduce<Record<string, typeof items>>((acc, item) => {
    const key = item._niche;
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Guides</h1>
      <p className="text-[#B8B8D4] mb-8">
        Step-by-step guides to help you protect your privacy online. From beginner basics to advanced techniques.
      </p>

      {items.length === 0 && (
        <div className="text-center py-12 text-[#B8B8D4]/60">
          <p className="text-lg">Guides are being generated. Check back soon!</p>
        </div>
      )}

      {Object.entries(grouped).map(([nicheId, nicheItems]) => (
        <section key={nicheId} className="mb-10">
          <h2 className="text-xl font-semibold text-white mb-4">
            {nicheMap[nicheId]?.name || nicheId}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {nicheItems.map(item => (
              <Card
                key={item._slug}
                title={item.title}
                description={item.metaDescription}
                href={`/guides/${item._niche}/${item._slug}`}
                badge={item.difficulty}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
