import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAllSites, getSitesByCategory, getExtremes, gradeDistribution } from '@/lib/sites';
import { CATEGORY_LABEL, type SiteCategory } from '@/lib/site-categories';
import { generateMetadata as genMeta } from '@/lib/seo';
import { IS_PRO_DEPLOYMENT, proUrlFor } from '@/lib/tiers';
import { GradeBadge } from '@/components/GradeBadge';
import { AtoZCatalogue } from '@/components/AtoZCatalogue';

export const metadata = genMeta({
  title: 'Website Privacy Report Cards: 500 Sites Graded A–F',
  description:
    'Which popular websites track you before you click anything? 500 sites graded A–F on tracking cookies, ad trackers, third-party scripts and security headers — scanned with our own tracker scanner, methodology published.',
  path: '/site',
  type: 'website',
});

export default function SiteIndexPage() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools');
  const all = getAllSites();
  const byCat = getSitesByCategory();
  const { worst, best } = getExtremes(10);
  const dist = gradeDistribution();
  const scannedAt = all[0]?.scannedAt?.slice(0, 10) ?? '';

  const Row = ({ s }: { s: (typeof all)[number] }) => (
    <Link href={`/site/${s.domain}`} className="flex items-center gap-3 py-2 px-3 rounded hover:bg-white/5 transition-colors">
      <GradeBadge grade={s.grade.grade} size="sm" />
      <span className="text-sm text-white flex-1 truncate">{s.domain}</span>
      <span className="text-xs text-t3 w-14 text-right">{s.grade.score}/100</span>
      <span className="text-xs text-t3 w-24 text-right hidden sm:inline">{s.scan.summary.totalTrackers} trackers</span>
    </Link>
  );

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Website Privacy Report Cards</h1>
      <p className="text-t2 mb-2 max-w-2xl">
        {all.length} popular websites, graded A–F on what they do to a first-time visitor <em>before</em> any consent banner is clicked:
        tracking cookies, ad and analytics trackers, third-party scripts, and security headers.
      </p>
      <p className="text-sm text-t3 mb-6">
        Scanned {scannedAt} with the same scanner behind the <a href={proUrlFor('ad-tracking', 'cookie-tracker-scanner')} className="underline hover:text-white">Cookie &amp; Tracker Scanner in Incognito Pro</a>.
        Every point is itemised on each page. <Link href="/site/methodology" className="underline hover:text-white">Read the methodology</Link> — and argue with it.
      </p>


      <AtoZCatalogue
        noun="websites"
        entries={all.map(s => ({
          title: s.domain,
          href: `/site/${s.domain}`,
          description: s.grade.headline,
          meta: `${s.category.label} · ${s.grade.score}/100`,
          grade: s.grade.grade,
          keywords: `${s.category.category} grade ${s.grade.grade}`,
        }))}
        topics={(Object.keys(byCat) as SiteCategory[]).map(c => ({ label: CATEGORY_LABEL[c], query: CATEGORY_LABEL[c] })).sort((a, b) => a.label.localeCompare(b.label))}
      >
      {/* Distribution */}
      <div className="flex flex-wrap gap-3 mb-10">
        {(['A', 'B', 'C', 'D', 'F'] as const).map((g) => (
          <div key={g} className="flex items-center gap-2 bg-s0 border border-b1 rounded-lg px-3 py-2">
            <GradeBadge grade={g} size="sm" />
            <span className="text-sm text-white">{dist[g]}</span>
            <span className="text-xs text-t3">sites</span>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-12">
        <section className="bg-s0 border border-b1 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-2">Most aggressive tracking</h2>
          {worst.map((s) => <Row key={s.domain} s={s} />)}
        </section>
        <section className="bg-s0 border border-b1 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-2">Cleanest</h2>
          {best.map((s) => <Row key={s.domain} s={s} />)}
        </section>
      </div>
      </AtoZCatalogue>
    </div>
  );
}
