import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAllContentItems, freeSitePrefix, isPublished, type EditableContent } from '@/lib/content';
import { engineVisibleInThisTier } from '@/lib/tiers';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { Card } from '@/components/ui/Card';

interface ToolMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  toolEngine?: string;
}

interface PageProps {
  params: Promise<{ niche: string }>;
}

export const dynamicParams = false;

/** Tools this deployment actually builds — a hub must never list a tool page that does not exist here. */
function visibleTools() {
  return getAllContentItems<ToolMeta>('tools').filter(i => engineVisibleInThisTier(i.toolEngine) && isPublished(i as unknown as EditableContent));
}

export async function generateStaticParams() {
  return Array.from(new Set(visibleTools().map(i => i._niche))).map(niche => ({ niche }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche } = await params;
  const nicheData = getNicheById(niche);
  return genMeta({
    title: `${nicheData?.name ?? niche} Privacy Tools`,
    description: `Free privacy tools tailored to ${nicheData?.name ?? niche}. All run client-side.`,
    path: `/tools/${niche}`,
    type: 'website',
  });
}

export default async function ToolsByNiche({ params }: PageProps) {
  const { niche } = await params;
  const items = visibleTools().filter(i => i._niche === niche);
  if (items.length === 0) notFound();
  const nicheData = getNicheById(niche);

  return (
    <div>
      <nav className="mb-6 text-sm text-t2">
        <Link href="/" className="hover:text-white">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/tools" className="hover:text-white">Tools</Link>
        <span className="mx-2">/</span>
        <span className="text-white">{nicheData?.name ?? niche}</span>
      </nav>

      <h1 className="text-3xl font-bold text-white mb-2">
        {nicheData?.name ?? niche} Privacy Tools
      </h1>
      <p className="text-t2 mb-8">
        {nicheData?.description ?? `Free interactive tools for ${nicheData?.name ?? niche}.`}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => (
          <Card
            key={item._slug}
            title={item.title}
            description={item.metaDescription}
            href={`/tools/${item._niche}/${item._slug}`}
            badge={item.toolType}
          />
        ))}
      </div>

      <div className="mt-10 pt-8 border-t border-b1">
        <p className="text-sm text-t2">
          Looking for more on this topic?{' '}
          <Link href={`${freeSitePrefix()}/topics/${niche}`} className="text-white underline hover:no-underline">
            View the full {nicheData?.name ?? niche} hub
          </Link>
        </p>
      </div>
    </div>
  );
}
