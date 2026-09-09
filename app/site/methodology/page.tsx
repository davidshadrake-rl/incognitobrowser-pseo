import Link from 'next/link';
import { redirect } from 'next/navigation';
import { generateMetadata as genMeta } from '@/lib/seo';
import { IS_PRO_DEPLOYMENT, proUrlFor } from '@/lib/tiers';

export const metadata = genMeta({
  title: 'How We Grade Website Privacy (Methodology)',
  description:
    'The exact rubric behind our A–F website privacy report cards: what we scan, what costs points, what we deliberately ignore, and how to dispute a grade.',
  path: '/site/methodology',
  type: 'website',
});

export default function MethodologyPage() {
  if (IS_PRO_DEPLOYMENT) redirect('/tools');
  return (
    <article className="max-w-3xl mx-auto prose prose-invert">
      <h1 className="text-3xl font-bold text-white mb-4">How we grade website privacy</h1>
      <p className="text-t2">
        A report card answers one narrow question honestly: <strong className="text-white">what does this site do to a first-time visitor on its homepage, before they click anything?</strong>{' '}
        Not what its privacy policy promises, not what happens after you log in — what actually arrives in the first response.
      </p>

      <h2 className="text-xl font-semibold text-white mt-8 mb-2">What we scan</h2>
      <ul className="list-disc pl-6 text-t2 space-y-1">
        <li>One request to the homepage over HTTPS, following redirects, with a normal desktop browser user-agent. No consent banner is clicked; no cookies are sent.</li>
        <li><strong className="text-white">Set-Cookie</strong> headers in that response, classified by a database of known tracking, analytics and functional cookie names, plus naming heuristics and <code>SameSite=None</code> (which enables cross-site tracking).</li>
        <li>The HTML, matched against known tracker and pixel scripts (Meta Pixel, Google Ads/DoubleClick, TikTok, Criteo, Taboola, Hotjar, and dozens more) and inline pixel initialisers.</li>
        <li>Every <code>&lt;script src&gt;</code> that loads from a domain other than the site's own.</li>
        <li>Security headers: HTTPS, HSTS, Content-Security-Policy, Permissions-Policy.</li>
      </ul>
      <p className="text-t2">It is the same code that powers the <a href={proUrlFor('ad-tracking', 'cookie-tracker-scanner')} className="underline hover:text-white">Cookie &amp; Tracker Scanner in Incognito Pro</a>, so any grade can be reproduced with the same tool.</p>

      <h2 className="text-xl font-semibold text-white mt-8 mb-2">The rubric</h2>
      <p className="text-t2">Every site starts at 100. Deductions, each capped so one category can't dominate:</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm my-3">
          <thead className="text-xs uppercase tracking-wider text-t3"><tr><th className="text-left py-2 pr-3">Finding</th><th className="text-left py-2 pr-3">Points</th><th className="text-left py-2">Cap</th></tr></thead>
          <tbody className="text-t2">
            {[
              ['Tracking cookie set before consent', '−8 each', '−32'],
              ['Advertising / marketing tracker loaded', '−6 each', '−30'],
              ['Analytics tracker loaded', '−3 each', '−12'],
              ['Inline tracking pixel', '−3 each', '−9'],
              ['Third-party script domain beyond five', '−1 each', '−15'],
              ['Not served over HTTPS', '−25', '—'],
              ['No HSTS', '−3', '—'],
              ['No Content-Security-Policy', '−3', '—'],
              ['No Permissions-Policy', '−1', '—'],
            ].map(([a, b, c]) => (
              <tr key={a} className="border-t border-b1"><td className="py-2 pr-3">{a}</td><td className="py-2 pr-3 font-mono">{b}</td><td className="py-2 font-mono">{c}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-t2"><strong className="text-white">Grades:</strong> A ≥ 90 · B ≥ 78 · C ≥ 62 · D ≥ 45 · F below 45.</p>

      <h2 className="text-xl font-semibold text-white mt-8 mb-2">What we deliberately don't do</h2>
      <ul className="list-disc pl-6 text-t2 space-y-1">
        <li>We don't execute JavaScript. Trackers injected only after scripts run are invisible to us, so <strong className="text-white">grades are a floor, not a ceiling</strong> — a real browser session usually sees more.</li>
        <li>We don't click consent banners, log in, or browse past the homepage.</li>
        <li>We don't read privacy policies. A policy is a promise; a report card is an observation.</li>
        <li>We never store or display cookie values — only names and attributes.</li>
      </ul>

      <h2 className="text-xl font-semibold text-white mt-8 mb-2">Disputing a grade</h2>
      <p className="text-t2">
        Every deduction is itemised on the site's page. If you run a site and believe a finding is wrong, re-run the scan with the public tool; if the result differs from the report card, the card is out of date and will refresh on the next monthly scan. Grades change over time — each page shows its previous grade once a second scan exists.
      </p>

      <p className="mt-8"><Link href="/site" className="text-sm text-t2 hover:text-white">← All report cards</Link></p>
    </article>
  );
}
