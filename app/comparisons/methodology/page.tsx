/**
 * How comparison ratings are worked out: the page every comparison's
 * "How we score" link points to.
 *
 * Every rule here is what lib/comparison-score.ts does, and the points table
 * is rendered from its POINTS, so the page and the code can't drift. Keep the
 * prose in step when the code changes:
 *   - points per value, and '—' / 'unknown' / 'n/a' left out;
 *   - at least half of a page's criteria assessed, else "Not enough data",
 *     listed last;
 *   - round(10 × mean, 1), a half rounding up; ties alphabetical by name;
 *   - ratings come only from the page's table (products[].rating is ignored).
 * The Incognito Browser section states the owner's 2026-09-10 decision
 * (disclose, verified facts from data/brand.json, 'no' rather than '—' for a
 * criterion it can't back, left out where it isn't comparable). Each of those
 * statements is a test over data/comparisons in tests/comparison-score.test.ts
 * (IB_BACKING, NOT_A_BROWSER_CRITERION, IB_COMPARABLE and the slug check that
 * makes the disclosure render), so change the test and the prose together.
 *
 * Do not claim testing or verification: cells are our reading of each
 * product's published features, judgement criteria (ease of use) are our
 * judgement, and we have not independently verified any of them. We run no
 * lab tests; a cell may follow a third-party lab's published result, and
 * speed or performance is scored only that way (the sitewide speed policy),
 * both enforced by the data rules in tests/comparison-score.test.ts. The only
 * sentence here that may say "verified" is the one saying we haven't.
 * It names no person, on purpose — see components/EditorialNote.tsx.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { generateMetadata as genMeta } from '@/lib/seo';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { PageHero } from '@/components/ui/PageHero';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { CELL_LABEL, METHODOLOGY_PATH, POINTS, type RatedValue } from '@/lib/comparison-score';

export const metadata = genMeta({
  title: 'How We Score Comparisons',
  description:
    'The one rubric behind every comparison rating here: how table cells become points, what is not counted, how ties are broken, and how Incognito Browser, which we make, is scored.',
  path: METHODOLOGY_PATH,
  type: 'website',
});

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10">
      <h2 className="font-mono text-h2 text-t1 mb-3">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}

/** POINTS grouped by value, highest first: [points, labels]. */
function pointsRows(): Array<[number, string[]]> {
  const groups = new Map<number, string[]>();
  for (const [value, points] of Object.entries(POINTS) as Array<[RatedValue, number]>) {
    groups.set(points, [...(groups.get(points) ?? []), CELL_LABEL[value]]);
  }
  return [...groups.entries()].sort((a, b) => b[0] - a[0]);
}

export default function ComparisonMethodologyPage() {
  // Pro serves tools only; comparisons live on the free site.
  if (IS_PRO_DEPLOYMENT) redirect('/tools');

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[{ label: 'Comparisons', href: '/comparisons' }, { label: 'How we score' }]} />

      <PageHero
        icon="grade"
        kicker="Comparisons · methodology"
        title="How we score comparisons"
        description="One rubric for every product on every comparison page, worked out from that page's own table."
      />

      <p className="prose-ib">
        These pages are published by the makers of Incognito Browser, a private browser for Android.
        Some comparisons include it, so every product, ours included, is rated the same way: by code,
        from the table on the page.
      </p>

      <Section title="Where a rating comes from">
        <p className="prose-ib">
          Each comparison has a feature table, with one row per criterion and one column per product.
          A product&apos;s rating is worked out from its column in that table and nothing else. Nobody
          types a rating in, and there is no adjustment after the fact.
        </p>
      </Section>

      <Section title="How a cell becomes points">
        <div className="overflow-x-auto border border-b1 rounded-[12px]">
          <table className="w-full border-collapse text-row">
            <thead className="bg-s1">
              <tr>
                <th className="text-left p-3 font-medium text-t2">Cell says</th>
                <th className="text-left p-3 font-medium text-t2">Points</th>
              </tr>
            </thead>
            <tbody className="text-t2">
              {pointsRows().map(([points, labels]) => (
                <tr key={points} className="border-t border-hair">
                  <td className="p-3">{labels.join(', ')}</td>
                  <td className="p-3 font-mono tnum">{points}</td>
                </tr>
              ))}
              <tr className="border-t border-hair">
                <td className="p-3">— (not assessed, or doesn&apos;t apply)</td>
                <td className="p-3">Not counted</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="prose-ib">
          A dash means we haven&apos;t assessed that criterion for that product, or it doesn&apos;t
          apply to it. It is left out of the rating completely, so it counts neither for nor against
          the product.
        </p>
      </Section>

      <Section title="From points to a rating">
        <p className="prose-ib">
          A product&apos;s rating is the average of its points over the criteria it was assessed on,
          times 10, rounded to one decimal place (a half rounds up). For example, Yes, Good and Partial
          average 0.75, which is a rating of 7.5/10. Every criterion on a page counts the same.
        </p>
        <p className="prose-ib">
          A product needs at least half of the page&apos;s criteria assessed to get a rating. With fewer,
          it shows &ldquo;Not enough data&rdquo; instead of a number and is listed last.
        </p>
        <p className="prose-ib">
          Products are listed from the highest rating down. Two products with the same rating are listed
          alphabetically by name.
        </p>
      </Section>

      <Section title="Incognito Browser is scored the same way">
        <p className="prose-ib">
          We make Incognito Browser, and every comparison that includes it says so at the top of the
          page. It is scored with the same rubric as every other product.
        </p>
        <p className="prose-ib">
          A cell gives it credit only for a feature documented in its Google Play listing. Where we
          can&apos;t back a criterion that way, the cell says No rather than showing a dash, so a
          feature we can&apos;t show it has counts against it instead of being left out. The only
          exception is a criterion that doesn&apos;t apply to a browser at all, which is marked not
          assessed.
        </p>
        <p className="prose-ib">
          That goes for criteria that are a matter of judgement too. Its always-on private mode, with
          nothing to set up, can count towards ease of use; speed gets no credit, because nothing
          documented backs it.
        </p>
        <p className="prose-ib">
          We include it only in comparisons of browsers and private-browsing modes, ad, tracker and
          cookie blocking, fingerprinting and search history, and leave it out of everything else,
          such as VPNs or email services.
        </p>
      </Section>

      <Section title="What a rating does and doesn't tell you">
        <p className="prose-ib">
          The cells are our reading of each product&apos;s published features, and we have not
          independently verified them. We don&apos;t run lab tests of our own; where a cell follows a
          third-party lab result, the page says so. Criteria such as ease of use are our judgement, not
          a documented feature. Speed and performance are scored only where the page cites a
          third-party measurement. Products change, so check anything that matters to you with the
          product itself.
        </p>
        <p className="prose-ib">
          A rating treats every criterion as equally important, which may not match what matters to you.
          The rows you care about tell you more than the number. Criteria also differ from page to page,
          so a rating only compares products on the same page.
        </p>
        <p className="prose-ib">
          How pages are checked before they go live is covered in{' '}
          <Link href="/editorial-standards">our editorial standards</Link>.
        </p>
      </Section>

      <nav className="mt-12 pt-6 border-t border-b1 text-row text-t2 flex flex-wrap gap-x-5 gap-y-2" aria-label="Explore">
        <Link href="/comparisons" className="hover:text-t1">Comparisons</Link>
        <Link href="/guides" className="hover:text-t1">Guides</Link>
        <Link href="/checklists" className="hover:text-t1">Checklists</Link>
        <Link href="/tools" className="hover:text-t1">Privacy tools</Link>
        <Link href="/glossary" className="hover:text-t1">Glossary</Link>
        <Link href="/editorial-standards" className="hover:text-t1">Editorial standards</Link>
      </nav>
    </article>
  );
}
