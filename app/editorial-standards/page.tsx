/**
 * Our editorial standards — the page every EditorialNote links to.
 *
 * Every claim here describes something the code or the data actually does,
 * so keep it that way when editing:
 *   - publication: an editor approves pages for publication, mostly in
 *     batches after the automated checks (editorial.notes "Bulk-promoted…"),
 *     which is why this page must not say every page was read line by line;
 *   - the publish gate: lib/content.ts isPublished(), the noIndex in each
 *     content page's generateMetadata, and the sitemap filter;
 *   - the brand-mention scrub: scripts/scrub-product-mentions.mjs, which
 *     scripts/promote-all.mjs refuses to run without. It covers guides,
 *     checklists, templates, calculators and glossary text. It leaves
 *     calculator dropdown labels alone (PRESERVE_PATH), so listing
 *     calculators with the articles below stays true only while no
 *     calculator offers or scores the app, as fixed on 2026-09-10.
 *     Comparisons still name it: each one that does carries a disclosure at
 *     the top (components/ComparisonPage.tsx) and is rated by the published
 *     rubric (lib/comparison-score.ts, /comparisons/methodology), hence the
 *     paragraph below;
 *   - duplicate demotion: scripts/demote-overlap-duplicates.mjs.
 * It names no person, on purpose — see components/EditorialNote.tsx.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { generateMetadata as genMeta } from '@/lib/seo';
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers';
import { PageHero } from '@/components/ui/PageHero';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';

export const metadata = genMeta({
  title: 'Our Editorial Standards',
  description:
    'How the privacy guides, checklists, comparisons and tools on this site are checked before they go live, and what that does and does not promise.',
  path: '/editorial-standards',
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

export default function EditorialStandardsPage() {
  // Pro serves tools only. Its editorial notes link here, on the free site.
  if (IS_PRO_DEPLOYMENT) redirect('/tools');

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[{ label: 'Editorial standards' }]} />

      <PageHero
        icon="doc"
        kicker="Editorial standards"
        title="Our editorial standards"
        description="How pages here are checked before they go live, and what that does and doesn't promise."
      />

      <p className="prose-ib">
        These pages are published by Incognito Browser, which makes a private browser for Android.
        That is a reason to be careful about what we tell you, so here is how a page gets published.
      </p>

      <Section title="How a page gets published">
        <p className="prose-ib">
          A page goes live once it has passed the checks below and an editor has approved it for
          publication. Approval clears a page to publish; it doesn&apos;t mean every line was read, and
          most pages were approved in batches after those checks. Pages that haven&apos;t been approved
          are left out of our sitemap and marked so search engines don&apos;t index them.
        </p>
      </Section>

      <Section title="What is checked before a page goes live">
        <p className="prose-ib">
          <strong className="text-t1">Articles don&apos;t advertise our app.</strong> Mentions of it are
          rewritten out of guides, checklists, templates, calculators and glossary entries before they
          can be published, so the advice stands on its own. Where we do suggest the app, it sits in a
          separate panel, not in the steps.
        </p>
        <p className="prose-ib">
          <strong className="text-t1">Comparisons can include Incognito Browser.</strong> Some
          comparisons list it next to other products. Each of those says at the top that we make it,
          and it is rated with the same published rubric as every other product, from the table on the
          page.{' '}
          <Link href="/comparisons/methodology" className="underline underline-offset-2 hover:text-t1">
            How we score comparisons
          </Link>
          .
        </p>
        <p className="prose-ib">
          <strong className="text-t1">It isn&apos;t a copy of another page.</strong> Many topics share
          the same kinds of article, like a security checklist or a complete guide. Where those
          overlap, one topic keeps the article and the copies are held back from search.
        </p>
      </Section>

      <Section title="Website report cards">
        <p className="prose-ib">
          Report cards come from an automated scan of each site&apos;s homepage, graded against a
          fixed, published rubric.{' '}
          <Link href="/site/methodology" className="underline underline-offset-2 hover:text-t1">
            How grades are worked out
          </Link>
          .
        </p>
      </Section>

      <nav className="mt-12 pt-6 border-t border-b1 text-row text-t2 flex flex-wrap gap-x-5 gap-y-2" aria-label="Explore">
        <Link href="/guides" className="hover:text-t1">Guides</Link>
        <Link href="/checklists" className="hover:text-t1">Checklists</Link>
        <Link href="/comparisons" className="hover:text-t1">Comparisons</Link>
        <Link href="/tools" className="hover:text-t1">Privacy tools</Link>
        <Link href="/glossary" className="hover:text-t1">Glossary</Link>
        <Link href="/site" className="hover:text-t1">Report cards</Link>
      </nav>
    </article>
  );
}
