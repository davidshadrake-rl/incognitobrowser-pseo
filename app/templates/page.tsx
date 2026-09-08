import { getAllContentItems } from '@/lib/content';
import { getAllNiches } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { Card } from '@/components/ui/Card';
import { redirect } from 'next/navigation';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';

export const metadata = genMeta({
  title: 'Privacy Templates',
  description: 'Ready-to-use privacy templates: data deletion requests, privacy policies, GDPR letters, and more.',
  path: '/templates',
  type: 'website',
});

interface TemplateMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  templateType: string;
}

export default function TemplatesIndex() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools'); // the Pro deployment serves tools only
  const items = getAllContentItems<TemplateMeta>('templates');
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
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Templates</h1>
      <p className="text-[#B8B8D4] mb-8">
        Ready-to-use templates for data deletion requests, privacy policies, GDPR compliance, and more. Customize and copy.
      </p>

      <AtoZCatalogue
        noun="templates"
        entries={items.map(item => ({
          title: item.title,
          href: `/templates/${item._niche}/${item._slug}`,
          description: item.metaDescription,
          meta: nicheMap[item._niche]?.name || item._niche,
          
          keywords: item._niche,
        }))}
      />

      <h2 className="text-xl font-semibold text-white mb-6 pt-8 border-t border-white/10">Browse by topic</h2>

      {items.length === 0 && (
        <div className="text-center py-12 text-[#B8B8D4]/60">
          <p className="text-lg">Templates are being generated. Check back soon!</p>
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
                href={`/templates/${item._niche}/${item._slug}`}
                badge={item.templateType}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
