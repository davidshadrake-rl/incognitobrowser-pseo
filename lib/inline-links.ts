/**
 * Inline editorial links (DESIGN-SPEC 5.6): weave a content page's
 * `relatedLinks[]` into its own prose instead of dropping them into a
 * "see also" card. Satisfies the owner's global pSEO rule (~/.claude/CLAUDE.md
 * "Editorial → pSEO inline linking"): 2-4 inline `<a>` per guide, anchor text
 * drawn from a phrase that already exists in the sentence.
 *
 * For each link, find the longest 2-4-word run of its title that appears
 * (case-insensitively, whole-word) inside a given block of text, and wrap
 * only the FIRST such occurrence. A link with no match anywhere is left for
 * the caller to append as a plain sentence instead of a card.
 *
 * SECURITY: this module never builds or returns an HTML string, and nothing
 * here is ever handed to dangerouslySetInnerHTML. `weaveLinks` returns plain
 * data — a list of string segments and `{ text, href }` anchor segments —
 * for the caller to render as ordinary React children, which escapes text
 * content automatically. There is no template concatenation of `text` or
 * `link.title`/`link.url` at any point, so content-JSON strings (including
 * ones containing `<`, `>` or `"`) cannot inject markup or attributes; the
 * worst a hostile title/url could do is render as inert visible text or an
 * inert link target, and `isSafeHref` below refuses to turn a link into an
 * anchor at all unless its URL is a same-site path or an http(s) URL, so a
 * `javascript:`/`data:` URL in content data never becomes a clickable href.
 * See tests/inline-links.test.ts and the extended cases in
 * tests/xss-protection.test.ts.
 */

export interface InlineLink {
  title: string;
  url: string;
  type?: string;
}

/** A run of plain text, or a run of text that should render as an anchor. */
export interface AnchorSegment {
  text: string;
  href: string;
  type?: string;
}

export type WeaveSegment = string | AnchorSegment;

export interface WeaveResult {
  /** `text`, in order, with each matched link's first occurrence replaced
   * by an anchor segment. Concatenating every segment's text reproduces
   * `text` exactly — segments only ever split it, never alter it. */
  segments: WeaveSegment[];
  /** Links that found (and were given) a match in this text. */
  matched: InlineLink[];
  /** Links with no safe match in this text — caller's job to try the next
   * block of text, or fall back to an appended sentence. */
  unmatched: InlineLink[];
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function titleWords(title: string): string[] {
  return title.trim().split(/\s+/).filter(Boolean);
}

/** Same-site path or absolute http(s) URL only — never javascript:, data:, etc. */
export function isSafeHref(url: string): boolean {
  if (!url) return false;
  if (url.startsWith('/')) return true;
  return /^https?:\/\//i.test(url);
}

/**
 * The longest (4, then 3, then 2 word) contiguous run of `title`'s words
 * that occurs in `text` as a case-insensitive whole-word match. Among runs
 * of the same length, the one that occurs earliest in `text` wins.
 */
function findBestMatch(text: string, title: string): { index: number; length: number } | null {
  const words = titleWords(title);
  const maxN = Math.min(4, words.length);
  for (let n = maxN; n >= 2; n--) {
    let best: { index: number; length: number } | null = null;
    for (let start = 0; start + n <= words.length; start++) {
      const phrase = words.slice(start, start + n).map(escapeRegExp).join('\\s+');
      // Lookaround word boundaries (not \b) so a run flush against
      // punctuation ("...VPN." or "(VPN)") still counts as whole-word.
      const re = new RegExp(`(?<![a-zA-Z0-9])${phrase}(?![a-zA-Z0-9])`, 'i');
      const m = re.exec(text);
      if (m && (best === null || m.index < best.index)) {
        best = { index: m.index, length: m[0].length };
      }
    }
    if (best) return best;
  }
  return null;
}

/**
 * Wrap the first match of each link's title inside `text`. Non-overlapping
 * only: once a span of `text` is claimed by one link, a later link whose
 * only match overlaps that span is reported unmatched for this call (never
 * double-wrapped, never nested).
 */
export function weaveLinks(text: string, links: InlineLink[]): WeaveResult {
  if (!text) return { segments: [], matched: [], unmatched: [...links] };

  const claims: { start: number; end: number; link: InlineLink }[] = [];
  const matched: InlineLink[] = [];
  const unmatched: InlineLink[] = [];

  for (const link of links) {
    if (!link || !link.title || !link.url || !isSafeHref(link.url)) {
      if (link) unmatched.push(link);
      continue;
    }
    const found = findBestMatch(text, link.title);
    if (!found) {
      unmatched.push(link);
      continue;
    }
    const start = found.index;
    const end = found.index + found.length;
    const overlapsExisting = claims.some((c) => start < c.end && end > c.start);
    if (overlapsExisting) {
      unmatched.push(link);
      continue;
    }
    claims.push({ start, end, link });
    matched.push(link);
  }

  claims.sort((a, b) => a.start - b.start);

  const segments: WeaveSegment[] = [];
  let cursor = 0;
  for (const c of claims) {
    if (c.start > cursor) segments.push(text.slice(cursor, c.start));
    segments.push({ text: text.slice(c.start, c.end), href: c.link.url, type: c.link.type });
    cursor = c.end;
  }
  if (cursor < text.length) segments.push(text.slice(cursor));
  if (segments.length === 0) segments.push(text);

  return { segments, matched, unmatched };
}

/**
 * One sentence for a link that matched nowhere, appended in place of a card.
 *
 * Varied deterministically by the link's own title: a single fixed phrasing
 * put the identical sentence on 104 of 132 guides, which reads as generated
 * and is the exact copy-density signal section 7 warns about. The hash keeps
 * a given link phrased the same way on every page it appears, so builds stay
 * reproducible and diffs stay quiet.
 */
const UNMATCHED_LEAD_INS = [
  ' For the mechanism behind this, see ',
  ' The detail lives in ',
  ' Worth reading alongside this: ',
  ' This is covered end to end in ',
  ' For a step-by-step version, see ',
];

export function unmatchedLinkSentence(link: InlineLink): WeaveSegment[] {
  let h = 0;
  for (let i = 0; i < link.title.length; i++) h = (h * 31 + link.title.charCodeAt(i)) >>> 0;
  const lead = UNMATCHED_LEAD_INS[h % UNMATCHED_LEAD_INS.length];
  return [lead, { text: link.title, href: link.url, type: link.type }, '.'];
}
