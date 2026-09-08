import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAllContentItems } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { Card } from '@/components/ui/Card';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';

interface GuideMeta {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
}

interface PageProps {
  params: Promise<{ niche: string }>;
}

export const dynamicParams = false;

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return [{ niche: '_pro_export_placeholder_' }]; // Pro serves tools only; output:export needs ≥1 static param per dynamic route, so this ships one placeholder that resolves to no real content (notFound() below skips it in the actual output)
  const items = getAllContentItems<GuideMeta>('guides');
  return Array.from(new Set(items.map(i => i._niche))).map(niche => ({ niche }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche } = await params;
  const nicheData = getNicheById(niche);
  return genMeta({
    title: `${nicheData?.name ?? niche} Privacy Guides`,
    description: `In-depth privacy and security guides for ${nicheData?.name ?? niche}.`,
    path: `/guides/${niche}`,
    type: 'website',
  });
}

export default async function GuidesByNiche({ params }: PageProps) {
  const { niche } = await params;
  const items = getAllContentItems<GuideMeta>('guides').filter(i => i._niche === niche);
  if (items.length === 0) notFound();
  const nicheData = getNicheById(niche);

  return (
    <div>
      <nav className="mb-6 text-sm text-[#B8B8D4]">
        <Link href="/" className="hover:text-white">Home</Link>
        <span className="mx-2">/</span>
        <Link href="/guides" className="hover:text-white">Guides</Link>
        <span className="mx-2">/</span>
        <span className="text-white">{nicheData?.name ?? niche}</span>
      </nav>

      <h1 className="text-3xl font-bold text-white mb-2">
        {nicheData?.name ?? niche} Privacy Guides
      </h1>
      <p className="text-[#B8B8D4] mb-8">
        {nicheData?.description ?? `In-depth guides for ${nicheData?.name ?? niche}.`}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(item => (
          <Card
            key={item._slug}
            title={item.title}
            description={item.metaDescription}
            href={`/guides/${item._niche}/${item._slug}`}
            badge={item.difficulty}
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
