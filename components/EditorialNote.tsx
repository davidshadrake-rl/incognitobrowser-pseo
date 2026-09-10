/**
 * Fine-print editorial note at the foot of every reviewed content page.
 *
 * Replaces the header byline ("By <pen name> · Editorially reviewed ·
 * Reviewed <date>"). The owner did not want a person named on content pages,
 * and a review claim reads better as a footnote that says where it is
 * explained than as a credit next to the title.
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
  const label = 'Editorially reviewed';
  return (
    <p className="mt-12 pt-4 border-t border-b1 text-meta text-t3" data-testid="editorial-note">
      {IS_PRO_DEPLOYMENT ? (
        <a href={`${FREE_BASE_URL}${STANDARDS_PATH}`} className={linkClass}>{label}</a>
      ) : (
        <Link href={STANDARDS_PATH} className={linkClass}>{label}</Link>
      )}
      {' '}— what that means, and what is checked before a page goes live.
    </p>
  );
}
