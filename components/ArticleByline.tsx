/**
 * Visible article byline.
 *
 * Renders near the H1 of every editorially-promoted content page. Shows
 * the pseudonymous writer and a link to the editorial standards page, plus a
 * reviewed-on date when present. The reviewing editor is a named individual
 * and is deliberately NOT named here: this component renders on 1,000+ pages,
 * and naming them on every one publishes a real person at a scale nobody
 * asked for. They are named on the standards page and their profile page.
 *
 * Why this is the highest-leverage E-A-T element on the site: Google's
 * quality raters and AI Overview retrieval both look for a visible byline
 * near the top of an article. Structured data alone is not enough — a
 * human-readable byline is the primary signal.
 *
 * Renders nothing if the page has no author block (drafts, unattributed
 * pages). The editorial gate already noindexes those, so an absent byline
 * is not an E-A-T problem.
 */

import Link from 'next/link';

type AuthorLike = {
  name: string;
  profileUrl?: string;
  credentials?: string;
};

export interface ArticleBylineProps {
  author?: AuthorLike | null;
  /**
   * Whether an editor reviewed this page — deliberately a boolean, not the
   * editor object. Passing the object put their real name and personal
   * profile URL into the RSC payload of every page, so the data shipped in
   * the HTML even after the byline stopped rendering it.
   */
  reviewed?: boolean;
  reviewedAt?: string | null;
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } catch {
    return null;
  }
}

function profileHref(profileUrl: string | undefined, fallbackName: string): string {
  if (profileUrl) {
    // Convert absolute profileUrl back to a site-relative href so the
    // anchor stays clickable on both server-mode and static-export builds.
    return profileUrl.replace(/^https?:\/\/[^/]+\/resources/, '');
  }
  // Best-effort slug fallback.
  return `/authors/${fallbackName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
}

export function ArticleByline({ author, reviewed, reviewedAt }: ArticleBylineProps) {
  if (!author || !author.name) return null;
  const dateStr = formatDate(reviewedAt);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-white/90 mb-6 pb-4 border-b border-b1"
      data-testid="article-byline"
    >
      <span className="text-t2">By</span>
      <a
        href={profileHref(author.profileUrl, author.name)}
        rel="author"
        className="text-white hover:underline font-semibold"
      >
        {author.name}
      </a>
      {/* The editor is a named individual. Naming them on 1,000+ pages, each
          linking their personal profile, publishes a real person's identity at
          a scale the owner did not ask for. The editorial relationship is kept
          — it just points at the standards page instead of the person, and the
          named editor appears only on the few pages listed there. */}
      {reviewed && (
        <>
          <span aria-hidden="true" className="text-white/30">·</span>
          <Link href="/site/methodology" className="text-t2 hover:text-white hover:underline">
            Editorially reviewed
          </Link>
        </>
      )}
      {dateStr && (
        <>
          <span aria-hidden="true" className="text-white/30">·</span>
          <span className="text-t2">
            Reviewed{' '}
            <time dateTime={reviewedAt || undefined} className="text-white">
              {dateStr}
            </time>
          </span>
        </>
      )}
    </div>
  );
}
