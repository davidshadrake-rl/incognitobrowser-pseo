import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAllContentItems } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { Card } from '@/components/ui/Card';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';

interface ComparisonMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
}

interface PageProps {
  params: Promise<{ niche: string }>;
}

export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return []; // Pro deployment serves tools only
  const items = getAllContentItems<ComparisonMeta>('comparisons');
  return Array.from(new Set(items.map(i => i._niche))).map(niche => ({ niche }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche } = await params;
  const nicheData = getNicheById(niche);
  return genMeta({
    title: `${nicheData?.name ?? niche} Privacy Comparisons`,
    description: `Side-by-side comparisons of privacy tools for ${nicheData?.name ?? niche}.`,
    path: `/comparisons/${niche}`,
    type: 'website',
  });
}

export default async function ComparisonsByNiche({ params }: PageProps) {
  const { niche } = await params;
  const items = getAllContentItems<ComparisonMeta>('comparisons').filter(i => i._niche === niche);
  if (items.length === 0) notFound();
  const nicheData = getNicheById(niche);

  return (
    <div>
      <nav className="mb-6 text-sm text-[#B8B8D4]">
        <Link href="/" className="hover:text-white">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/comparisons" className="hover:text-white">Comparisons</Link>
        <span className="mx-2">/</span>
        <span className="text-white">{nicheData?.name ?? niche}</span>
      </nav>

      <h1 className="text-3xl font-bold text-white mb-2">
        {nicheData?.name ?? niche} Privacy Comparisons
      </h1>
      <p className="text-[#B8B8D4] mb-8">
        {nicheData?.description ?? `Side-by-side comparisons for ${nicheData?.name ?? niche}.`}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => (
          <Card
            key={item._slug}
            title={item.title}
            description={item.metaDescription}
            href={`/comparisons/${item._niche}/${item._slug}`}
          />
        ))}
      </div>

      <div className="mt-10 pt-8 border-t border-white/10">
        <p className="text-sm text-[#B8B8D4]">
          Looking for more on this topic?{' '}
          <Link href={`/topics/${niche}`} className="text-white underline hover:no-underline">
            View the full {nicheData?.name ?? niche} hub
          </Link>
        </p>
      </div>
    </div>
  );
}
