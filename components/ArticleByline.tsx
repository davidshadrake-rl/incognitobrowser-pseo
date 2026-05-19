/**
 * Visible article byline.
 *
 * Renders near the H1 of every editorially-promoted content page. Shows
 * the pseudonymous writer ("By Darkpool David") and the LinkedIn-verified
 * editor ("Edited by David Shadrake"), each linking to their /authors/<slug>
 * profile page. Includes a reviewed-on date when present.
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

type AuthorLike = {
  name: string;
  profileUrl?: string;
  credentials?: string;
};

export interface ArticleBylineProps {
  author?: AuthorLike | null;
  editor?: AuthorLike | null;
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

export function ArticleByline({ author, editor, reviewedAt }: ArticleBylineProps) {
  if (!author || !author.name) return null;
  const dateStr = formatDate(reviewedAt);

  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[#B8B8D4] mb-6"
      data-testid="article-byline"
    >
      <span>
        By{' '}
        <a
          href={profileHref(author.profileUrl, author.name)}
          rel="author"
          className="text-white hover:underline font-medium"
        >
          {author.name}
        </a>
      </span>
      {editor && editor.name && (
        <>
          <span aria-hidden="true" className="text-white/30">·</span>
          <span>
            Edited by{' '}
            <a
              href={profileHref(editor.profileUrl, editor.name)}
              className="text-white hover:underline font-medium"
            >
              {editor.name}
            </a>
          </span>
        </>
      )}
      {dateStr && (
        <>
          <span aria-hidden="true" className="text-white/30">·</span>
          <span>
            Reviewed{' '}
            <time dateTime={reviewedAt || undefined}>{dateStr}</time>
          </span>
        </>
      )}
    </div>
  );
}
