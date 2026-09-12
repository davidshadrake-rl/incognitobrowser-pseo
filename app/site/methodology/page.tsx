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
        {/* Keep in step with lib/scanner.ts categorizeCookie: known names first
            (KNOWN_COOKIES, KNOWN_COOKIE_PATTERNS), then the heuristics. */}
        <li><strong className="text-white">Set-Cookie</strong> headers in that response. A cookie we know by name is classified by what it is: advertising, analytics, or functional. The hosting cookies we know (load balancers, CDNs and bot protection from AWS, Cloudflare, Akamai, F5, Imperva, Azure and others) are functional even when they are set <code>SameSite=None</code>. A cookie we don&apos;t know is judged by its name first (names with &ldquo;uid&rdquo;, &ldquo;visitor&rdquo; or &ldquo;track&rdquo; count as tracking; &ldquo;session&rdquo;, &ldquo;token&rdquo;, &ldquo;csrf&rdquo; or &ldquo;auth&rdquo; as functional); failing that, it counts as tracking when it is set <code>SameSite=None</code>, which lets the browser send it with requests from other sites, as cross-site tracking requires. A response that sets the same cookie several times &mdash; the same name, domain and path, sent again with a new expiry &mdash; leaves the visitor with one cookie, so we count it once.</li>
        <li>The HTML, matched against known tracker and pixel scripts (Meta Pixel, Google Ads/DoubleClick, TikTok, Criteo, Taboola, comScore, Hotjar, ad exchanges, tag managers and dozens more) and inline pixel initialisers.</li>
        <li>Every <code>&lt;script src&gt;</code> that loads from a domain other than the site&apos;s own.</li>
        <li>Security headers: HTTPS, HSTS, Content-Security-Policy, Permissions-Policy.</li>
      </ul>
      {/* Only the detection is shared (lib/scanner.ts). The Pro scanner has its
          own deductions and grade cut-offs (CookieAnalyzerTool getPrivacyScore),
          so this must not promise that a re-scan reproduces the grade. */}
      <p className="text-t2">The <a href={proUrlFor('ad-tracking', 'cookie-tracker-scanner')} className="underline hover:text-white">Cookie &amp; Tracker Scanner in Incognito Pro</a> uses the same detection code, so it finds the same cookies, trackers and security headers. It scores them on its own scale, so its number and letter can differ from the report card&apos;s.</p>

      <h2 className="text-xl font-semibold text-white mt-8 mb-2">The rubric</h2>
      <p className="text-t2">Every site starts at 100. Deductions, each capped so one category can&apos;t dominate:</p>
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
      <p className="text-t2">Advertising and marketing trackers include ad exchanges, ad-verification and retargeting tags. Analytics trackers include tag managers (Google, Adobe, Tealium) and A/B-testing tools. Scripts we recognise as functional, such as error monitoring, CAPTCHAs and payments, are listed on the card but cost no points.</p>
      <p className="text-t2 text-sm">Rubric updated 11 September 2026: load-balancer, CDN and bot-protection cookies no longer count as tracking cookies, comScore and 54 more ad and analytics scripts are now detected, a cookie set several times in one response now counts once (lowes.com sent one ID cookie eight times and the card called it &ldquo;8 tracking cookies&rdquo;), and every card was re-graded from its stored scan (trackers matched against the script domains that scan recorded), so its scan date is unchanged.</p>

      <h2 className="text-xl font-semibold text-white mt-8 mb-2">What we deliberately don&apos;t do</h2>
      <ul className="list-disc pl-6 text-t2 space-y-1">
        <li>We don&apos;t execute JavaScript. Trackers injected only after scripts run are invisible to us, so <strong className="text-white">grades are a floor, not a ceiling</strong> — a real browser session usually sees more.</li>
        <li>We don&apos;t click consent banners, log in, or browse past the homepage.</li>
        <li>We don&apos;t read privacy policies. A policy is a promise; a report card is an observation.</li>
        <li>We never store or display cookie values — only names and attributes.</li>
      </ul>

      <h2 className="text-xl font-semibold text-white mt-8 mb-2">Disputing a grade</h2>
      <p className="text-t2">
        Every deduction is itemised on the site&apos;s page. If you run a site and believe a finding is wrong, scan your homepage with the Cookie &amp; Tracker Scanner and compare what it finds (the cookies, trackers and security headers), not its score. If those findings differ from the report card, the card is out of date and will refresh on the next monthly scan. Grades change over time — each page shows its previous grade once there is a second scan of that site under the same rubric. When we change the rubric we re-grade every card, and a grade that moved because the rubric moved is never published as a change in the site.
      </p>

      <p className="mt-8"><Link href="/site" className="text-sm text-t2 hover:text-white">← All report cards</Link></p>
    </article>
  );
}
