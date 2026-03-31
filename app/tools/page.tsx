import { getAllContentItems } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { Card } from '@/components/ui/Card';

export const metadata = genMeta({
  title: 'Free Privacy Tools',
  description: 'Free interactive privacy tools: password checker, fingerprint viewer, privacy score calculator, and more.',
  path: '/tools',
  type: 'website',
});

interface ToolMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
}

export default function ToolsIndex() {
  const items = getAllContentItems<ToolMeta>('tools');
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
      <h1 className="text-3xl font-bold text-white mb-2">Free Privacy Tools</h1>
      <p className="text-[#B8B8D4] mb-8">
        Interactive tools to analyze, test, and improve your online privacy. All tools run in your browser — no data is sent to any server.
      </p>

      {items.length === 0 && (
        <div className="text-center py-12 text-[#B8B8D4]/60">
          <p className="text-lg">Tools are being generated. Check back soon!</p>
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
                href={`/tools/${item._niche}/${item._slug}`}
                badge={item.toolType}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
