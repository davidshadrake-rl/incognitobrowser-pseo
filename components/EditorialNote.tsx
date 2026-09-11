/**
 * Fine-print link to the editorial standards, at the foot of every published
 * content page.
 *
 * Replaces the header byline ("By <pen name> · Editorially reviewed ·
 * Reviewed <date>"). The owner did not want a person named on content pages.
 * It no longer says "Editorially reviewed": most pages were approved for
 * publication in batches after automated checks (editorial.notes
 * "Bulk-promoted…"), so a per-page review claim was not true. "Our editorial
 * standards" is true of every page it appears on (owner, 2026-09-10).
 *
 * Takes a boolean, never a person: most content pages are client components,
 * whose props ship in the page's RSC payload, so passing an author or editor
 * object here would put their name in the HTML of every page even though
 * nothing renders it.
 *
 * The explanation lives on the free site. The Pro deployment is noindexed and
 * serves tools only, so from there the link crosses to the free site.
 */
import Link from 'next/link';
import { FREE_BASE_URL, IS_PRO_DEPLOYMENT } from '@/lib/tiers';

const STANDARDS_PATH = '/editorial-standards';

export function EditorialNote({ reviewed }: { reviewed?: boolean }) {
  if (!reviewed) return null;
  const linkClass = 'underline underline-offset-2 hover:text-t2';
  const label = 'Our editorial standards';
  return (
    <p className="mt-12 pt-4 border-t border-b1 text-meta text-t3" data-testid="editorial-note">
      {IS_PRO_DEPLOYMENT ? (
        <a href={`${FREE_BASE_URL}${STANDARDS_PATH}`} className={linkClass}>{label}</a>
      ) : (
        <Link href={STANDARDS_PATH} className={linkClass}>{label}</Link>
      )}
      : how pages here are checked before they go live.
    </p>
  );
}
