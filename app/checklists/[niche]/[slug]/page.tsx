import { notFound } from 'next/navigation';
import { getContentItem, getContentFiles, getCrossNicheLinks, isPublished } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta } from '@/lib/seo';
import { ChecklistPage } from '@/components/ChecklistPage';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import { generateBreadcrumbSchema } from '@/lib/seo';
import type { Metadata } from 'next';

interface ChecklistData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
  estimatedTime: string;
  intro?: string;
  sections: Array<{
    title: string;
    items: Array<{
      id: string;
      task: string;
      why: string;
      howTo: string;
      priority: 'critical' | 'high' | 'medium' | 'low';
    }>;
  }>;
  relatedLinks: Array<{ title: string; url: string; type: string }>;
}

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ niche: string; slug: string }>;
}

export async function generateStaticParams() {
  const files = getContentFiles('checklists');
  return files.map(f => {
    const [niche, slug] = f.split('/');
    return { niche, slug };
  });
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { niche, slug } = await params;
  const data = getContentItem<ChecklistData>('checklists', niche, slug);
  if (!data) return {};
  return genMeta({
    title: data.title,
    description: data.metaDescription,
    path: `/checklists/${niche}/${slug}`,
    noIndex: !isPublished(data as unknown as Parameters<typeof isPublished>[0]),
  });
}

export default async function ChecklistDetailPage({ params }: PageProps) {
  const { niche, slug } = await params;
  const data = getContentItem<ChecklistData>('checklists', niche, slug);
  if (!data) notFound();

  const nicheInfo = getNicheById(niche);
  const nicheName = nicheInfo?.name || niche;

  const breadcrumbs = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Checklists', url: '/checklists' },
    { name: nicheName, url: `/checklists/${niche}` },
    { name: data.title, url: `/checklists/${niche}/${slug}` },
  ]);

  const crossLinks = getCrossNicheLinks(niche, 'checklists', slug);

  return (
    <>
      <JsonLd data={breadcrumbs} />
      <ChecklistPage data={data} nicheName={nicheName} />
      <RelatedContent
        links={crossLinks}
        nicheHub={{ name: nicheName, href: `/topics/${niche}` }}
      />
    </>
  );
}
