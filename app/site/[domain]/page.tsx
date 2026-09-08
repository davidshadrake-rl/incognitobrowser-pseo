import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { getAllSites, getSite, getSiblingSites, gradeChange, isSitePublished } from '@/lib/sites';
import { getCrossNicheLinks } from '@/lib/content';
import { getNicheById } from '@/lib/taxonomy';
import { generateMetadata as genMeta, generateBreadcrumbSchema } from '@/lib/seo';
import { GRADE_LABEL } from '@/lib/site-grade';
import { IS_PRO_DEPLOYMENT, proUrlFor } from '@/lib/tiers';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { RelatedContent } from '@/components/seo/RelatedContent';
import { JsonLd } from '@/components/seo/JsonLd';
import { GradeBadge } from '@/components/GradeBadge';
import { ArticleByline } from '@/components/ArticleByline';

export const dynamicParams = false;

interface PageProps {
  params: Promise<{ domain: string }>;
}

export async function generateStaticParams() {
  if (IS_PRO_DEPLOYMENT) return []; // Pro deployment serves tools only
  return getAllSites().map((s) => ({ domain: s.domain }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { domain } = await params;
  const site = getSite(domain);
  if (!site) return {};
  return genMeta({
    title: `${domain} Privacy Report Card: Grade ${site.grade.grade}`,
    description: `Does ${domain} track you? ${site.grade.headline} Scanned ${site.scannedAt.slice(0, 10)} with our own tracker scanner.`,
    path: `/site/${domain}`,
    noIndex: !isSitePublished(site),
    publishedAt: site.history?.[0]?.scannedAt || site.scannedAt,
    modifiedAt: site.scannedAt,
  });
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

export default async function SiteReportPage({ params }: PageProps) {
  const { domain } = await params;
  const site = getSite(domain);
  if (!site) notFound();

  const { grade, scan, category } = site;
  const niche = getNicheById(category.niche);
  const nicheName = niche?.name || category.label;
  const siblings = getSiblingSites(site, 6);
  const crossLinks = getCrossNicheLinks(category.niche, 'site', domain, 6);
  const change = gradeChange(site);

  const breadcrumbSchema = generateBreadcrumbSchema([
    { name: 'Resources', url: '/' },
    { name: 'Website Privacy Report Cards', url: '/site' },
    { name: domain, url: `/site/${domain}` },
  ]);
  const pageSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `${domain} Privacy Report Card`,
    description: grade.headline,
    dateModified: site.scannedAt,
    about: { '@type': 'WebSite', url: site.finalUrl, name: domain },
    publisher: { '@type': 'Organization', name: 'Incognito Browser', url: 'https://incognitobrowser.io' },
  };

  const trackingCookies = scan.cookies.filter((c) => c.category === 'tracking');
  const otherCookies = scan.cookies.filter((c) => c.category !== 'tracking');

  return (
    <article className="max-w-3xl mx-auto">
      <JsonLd data={breadcrumbSchema} />
      <JsonLd data={pageSchema} />
      <Breadcrumbs items={[{ label: 'Resources', href: '/' }, { label: 'Report Cards', href: '/site' }, { label: domain }]} />

      <header className="mb-8">
        <p className="text-xs uppercase tracking-wider text-[#B8B8D4] mb-2">Website Privacy Report Card · {category.label}</p>
        <h1 className="text-3xl font-bold text-white mb-3">Does {domain} track you?</h1>
        <ArticleByline author={site.author ?? undefined} editor={site.editor ?? undefined} reviewedAt={site.scannedAt} />
        <div className="flex items-center gap-5 bg-[#0a0a0a] border border-white/10 rounded-lg p-5">
          <GradeBadge grade={grade.grade} size="xl" />
          <div>
            <div className="text-2xl font-semibold text-white">{grade.score} / 100 — {GRADE_LABEL[grade.grade]}</div>
            <p className="text-[#B8B8D4] mt-1">{grade.headline}</p>
            <p className="text-xs text-[#B8B8D4]/60 mt-2">
              Homepage scanned {fmtDate(site.scannedAt)}, first load, no consent clicked.{' '}
              <Link href="/site/methodology" className="underline hover:text-white">How we grade</Link>
            </p>
            {change && (
              <p className={`text-xs mt-1 ${change.scoreDelta < 0 ? 'text-red-400' : 'text-green-400'}`}>
                Changed since {fmtDate(change.since)}: {change.from} → {change.to} ({change.scoreDelta > 0 ? '+' : ''}{change.scoreDelta} points)
              </p>
            )}
          </div>
        </div>
      </header>

      {/* Deductions — the arguable part, itemised */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Why {grade.grade}? Every point, itemised</h2>
        {grade.deductions.length === 0 ? (
          <p className="text-[#B8B8D4]">No deductions. On first load, {domain} set no tracking cookies, loaded no known trackers, and served the security headers we check for.</p>
        ) : (
          <ul className="space-y-2">
            {grade.deductions.map((d, i) => (
              <li key={i} className="flex items-start justify-between gap-4 bg-[#0a0a0a] border border-white/10 rounded-lg p-3">
                <div>
                  <div className="text-sm text-white">{d.reason}</div>
                  {d.detail && <div className="text-xs text-[#B8B8D4] mt-0.5">{d.detail}</div>}
                </div>
                <span className="text-sm font-mono text-red-400 shrink-0">−{d.points}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Trackers */}
      {scan.trackers.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-3">Trackers loaded on the homepage ({scan.trackers.length})</h2>
          <ul className="space-y-2">
            {scan.trackers.map((t, i) => (
              <li key={i} className="bg-[#0a0a0a] border border-white/10 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-medium">{t.name}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${t.risk === 'high' ? 'bg-red-500/10 text-red-400' : t.risk === 'medium' ? 'bg-amber-500/10 text-amber-400' : 'bg-green-500/10 text-green-400'}`}>{t.category} · {t.risk} risk</span>
                </div>
                <p className="text-xs text-[#B8B8D4] mt-1">{t.description}</p>
              </li>
            ))}
          </ul>
          {scan.inlineTrackers.length > 0 && (
            <p className="text-xs text-[#B8B8D4] mt-2">Inline pixels: {scan.inlineTrackers.join(', ')}</p>
          )}
        </section>
      )}

      {/* Cookies */}
      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Cookies set before you agree to anything ({scan.summary.totalCookies})</h2>
        {scan.cookies.length === 0 ? (
          <p className="text-[#B8B8D4]">None. The homepage set no cookies on first load.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-[#B8B8D4]/60">
                <tr><th className="text-left py-2 pr-3">Cookie</th><th className="text-left py-2 pr-3">Purpose</th><th className="text-left py-2 pr-3">Category</th><th className="text-left py-2 pr-3">SameSite</th><th className="text-left py-2">Flags</th></tr>
              </thead>
              <tbody>
                {[...trackingCookies, ...otherCookies].map((c, i) => (
                  <tr key={i} className="border-t border-white/10">
                    <td className="py-2 pr-3 font-mono text-xs text-white">{c.cookieName}</td>
                    <td className="py-2 pr-3 text-[#B8B8D4]">{c.name}</td>
                    <td className={`py-2 pr-3 ${c.category === 'tracking' ? 'text-red-400' : c.category === 'analytics' ? 'text-amber-400' : 'text-[#B8B8D4]'}`}>{c.category}</td>
                    <td className="py-2 pr-3 text-[#B8B8D4]">{c.sameSite}</td>
                    <td className="py-2 text-xs text-[#B8B8D4]">{[c.secure && 'Secure', c.httpOnly && 'HttpOnly'].filter(Boolean).join(' · ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-xs text-[#B8B8D4]/60 mt-2">Cookie values are never stored or shown — only names and attributes.</p>
      </section>

      {/* Third parties + security */}
      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
          <h2 className="text-base font-semibold text-white mb-2">Third-party script domains ({scan.thirdPartyDomains.length})</h2>
          {scan.thirdPartyDomains.length === 0 ? (
            <p className="text-sm text-[#B8B8D4]">None — every script comes from {domain} itself.</p>
          ) : (
            <ul className="text-xs font-mono text-[#B8B8D4] space-y-1 max-h-48 overflow-auto">
              {scan.thirdPartyDomains.map((d) => <li key={d}>{d}</li>)}
            </ul>
          )}
        </div>
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
          <h2 className="text-base font-semibold text-white mb-2">Security headers</h2>
          <ul className="text-sm space-y-1">
            {[
              ['HTTPS', scan.security.isHTTPS],
              ['Strict-Transport-Security (HSTS)', scan.security.hasHSTS],
              ['Content-Security-Policy', scan.security.hasCSP],
              ['Permissions-Policy', scan.security.hasPermPolicy],
            ].map(([label, ok]) => (
              <li key={String(label)} className="flex items-center gap-2">
                <span className={ok ? 'text-green-400' : 'text-red-400'}>{ok ? '✓' : '✗'}</span>
                <span className="text-[#B8B8D4]">{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* CTA — the result moment */}
      <section className="mb-10 bg-[#0a0a0a] border border-white/10 rounded-lg p-5">
        <h2 className="text-lg font-semibold text-white mb-1">
          {grade.grade === 'A' || grade.grade === 'B' ? `Most sites are not this careful.` : `${domain} is watching before you click anything.`}
        </h2>
        <p className="text-sm text-[#B8B8D4] mb-3">
          Incognito Browser blocks tracking cookies and ad trackers like these on every site by default — no consent banners to fight, nothing to configure.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="https://play.google.com/store/apps/details?id=com.androidbull.incognito.browser&hl=en_US&referrer=utm_source%3Dresources%26utm_medium%3Dreport-card%26utm_campaign%3Dsite%26utm_content%3Dgrade-{grade.grade}" rel="noopener" className="btn-primary text-xs">Get Incognito Browser</a>
          <a href={proUrlFor('ad-tracking', 'cookie-tracker-scanner')} className="text-sm text-[#B8B8D4] hover:text-white self-center">Scan any URL with Incognito Pro →</a>
        </div>
      </section>

      {/* Siblings — same category */}
      {siblings.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-3">Other {category.label.toLowerCase()} sites</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {siblings.map((s) => (
              <Link key={s.domain} href={`/site/${s.domain}`} className="flex items-center gap-3 p-3 border border-white/10 rounded-lg hover:border-white/30 bg-white/[0.02] transition-all related-card">
                <GradeBadge grade={s.grade.grade} size="sm" />
                <div className="min-w-0">
                  <span className="text-sm text-white block truncate">{s.domain}</span>
                  <span className="text-xs text-[#B8B8D4]/60">{s.grade.score}/100 · {s.scan.summary.totalTrackers} trackers</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Cross-category pSEO links into the matching niche */}
      <RelatedContent links={crossLinks} nicheHub={{ name: nicheName, href: `/topics/${category.niche}` }} />

      {/* Explore further */}
      <nav className="mt-8 pt-6 border-t border-white/10 text-sm text-[#B8B8D4] flex flex-wrap gap-x-5 gap-y-2" aria-label="Explore">
        <Link href="/site" className="hover:text-white">All report cards</Link>
        <Link href="/site/methodology" className="hover:text-white">Methodology</Link>
        <Link href="/tools" className="hover:text-white">Privacy tools</Link>
        <Link href="/checklists" className="hover:text-white">Checklists</Link>
        <Link href="/guides" className="hover:text-white">Guides</Link>
        <Link href="/comparisons" className="hover:text-white">Comparisons</Link>
      </nav>
    </article>
  );
}
