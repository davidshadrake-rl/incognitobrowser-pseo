/**
 * lib/inline-links.ts (DESIGN-SPEC 5.6). weaveLinks never builds an HTML
 * string — it returns plain string/anchor-data segments for the caller to
 * render as React children — so there is no markup-injection surface to
 * test for escaping; instead these tests assert the matching/claiming logic
 * (no match, one match, overlapping titles, no double-wrap, text preserved
 * exactly) and that an unsafe href never becomes an anchor.
 */
import { describe, expect, it } from 'vitest';
import { weaveLinks, unmatchedLinkSentence, isSafeHref, type InlineLink } from '../lib/inline-links';

/** Concatenate every segment's text, ignoring which are anchors. */
function flatten(segments: ReturnType<typeof weaveLinks>['segments']): string {
  return segments.map((s) => (typeof s === 'string' ? s : s.text)).join('');
}

describe('weaveLinks', () => {
  it('no match: text passes through as a single segment, link is unmatched', () => {
    const links: InlineLink[] = [{ title: 'Password Security Guide', url: '/guides/password-security', type: 'internal' }];
    const result = weaveLinks('This sentence has nothing to do with any of that.', links);
    expect(result.segments).toEqual(['This sentence has nothing to do with any of that.']);
    expect(result.matched).toEqual([]);
    expect(result.unmatched).toEqual(links);
  });

  it('one match: wraps the longest run and preserves the rest of the text verbatim', () => {
    const links: InlineLink[] = [{ title: 'Email Privacy Best Practices', url: '/guides/email-privacy', type: 'internal' }];
    const text = 'Read our email privacy best practices before you set up filters.';
    const result = weaveLinks(text, links);
    expect(result.matched).toEqual(links);
    expect(result.unmatched).toEqual([]);
    expect(flatten(result.segments)).toBe(text);
    const anchor = result.segments.find((s): s is { text: string; href: string } => typeof s !== 'string');
    expect(anchor).toBeDefined();
    expect(anchor!.href).toBe('/guides/email-privacy');
    // 4-word run preferred over any shorter run also present in the title.
    expect(anchor!.text.toLowerCase()).toBe('email privacy best practices');
  });

  it('matches case-insensitively and only wraps the first occurrence', () => {
    const links: InlineLink[] = [{ title: 'Password Security', url: '/guides/password-security', type: 'internal' }];
    const text = 'PASSWORD SECURITY matters. Read about password security again later.';
    const result = weaveLinks(text, links);
    const anchors = result.segments.filter((s) => typeof s !== 'string');
    expect(anchors.length).toBe(1);
    expect((anchors[0] as { text: string }).text).toBe('PASSWORD SECURITY');
  });

  it('overlapping titles: the second link is left unmatched rather than nested or double-wrapped', () => {
    // "Password Security Guide" and "Security Guide for Teams" both want the
    // word run "Security Guide" out of the same text — only the first link
    // (processed in order) may claim it; the second is reported unmatched.
    const links: InlineLink[] = [
      { title: 'Password Security Guide', url: '/guides/password-security', type: 'internal' },
      { title: 'Security Guide for Teams', url: '/guides/security-teams', type: 'internal' },
    ];
    const text = 'Every team should read the password security guide for teams before onboarding.';
    const result = weaveLinks(text, links);
    expect(result.matched.map((l) => l.url)).toEqual(['/guides/password-security']);
    expect(result.unmatched.map((l) => l.url)).toEqual(['/guides/security-teams']);
    const anchors = result.segments.filter((s) => typeof s !== 'string') as { text: string; href: string }[];
    expect(anchors.length).toBe(1);
    // No anchor text nests another anchor's text or duplicates a span.
    expect(anchors[0].text.toLowerCase()).toContain('password security guide');
    expect(flatten(result.segments)).toBe(text);
  });

  it('never double-wraps: two links whose titles both match are each wrapped exactly once, non-overlapping', () => {
    const links: InlineLink[] = [
      { title: 'Email Privacy', url: '/guides/email-privacy', type: 'internal' },
      { title: 'Password Security', url: '/guides/password-security', type: 'internal' },
    ];
    const text = 'This guide covers email privacy and password security in one pass.';
    const result = weaveLinks(text, links);
    expect(result.matched.length).toBe(2);
    const anchors = result.segments.filter((s) => typeof s !== 'string') as { text: string; href: string }[];
    expect(anchors.length).toBe(2);
    expect(flatten(result.segments)).toBe(text);
  });

  it('does not corrupt surrounding text: segments concatenate back to the exact original string', () => {
    const links: InlineLink[] = [
      { title: 'Two Factor Authentication', url: '/guides/2fa', type: 'internal' },
      { title: 'Nothing Matches Here At All', url: '/guides/nowhere', type: 'internal' },
    ];
    const text = "Turn on two factor authentication first, then review your recovery codes & backup email.";
    const result = weaveLinks(text, links);
    expect(flatten(result.segments)).toBe(text);
  });

  it('an unsafe href (javascript:) is never turned into an anchor', () => {
    const links: InlineLink[] = [{ title: 'Click This Link Now', url: 'javascript:alert(1)', type: 'internal' }];
    const text = 'Do not click this link now, or ever.';
    const result = weaveLinks(text, links);
    expect(result.segments.every((s) => typeof s === 'string')).toBe(true);
    expect(result.unmatched).toEqual(links);
  });

  it('empty text: every link is unmatched, no segments', () => {
    const links: InlineLink[] = [{ title: 'Anything', url: '/guides/anything', type: 'internal' }];
    const result = weaveLinks('', links);
    expect(result.segments).toEqual([]);
    expect(result.unmatched).toEqual(links);
  });
});

describe('isSafeHref', () => {
  it('accepts same-site paths and http(s) URLs', () => {
    expect(isSafeHref('/guides/foo')).toBe(true);
    expect(isSafeHref('https://example.com/x')).toBe(true);
    expect(isSafeHref('http://example.com/x')).toBe(true);
  });
  it('rejects dangerous or empty schemes', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html,<script>1</script>')).toBe(false);
    expect(isSafeHref('')).toBe(false);
  });
});

describe('unmatchedLinkSentence', () => {
  const link: InlineLink = { title: 'Google Safe Browsing', url: 'https://safebrowsing.google.com', type: 'external' };
  const render = (l: InlineLink) =>
    unmatchedLinkSentence(l).map((s) => (typeof s === 'string' ? s : s.text)).join('');

  it('builds a plain-data sentence carrying the link as its own anchor segment', () => {
    const segments = unmatchedLinkSentence(link);
    expect(render(link)).toMatch(/^ .+ Google Safe Browsing\.$/);
    const anchor = segments.find((s): s is { text: string; href: string } => typeof s !== 'string');
    expect(anchor?.href).toBe('https://safebrowsing.google.com');
    expect(anchor?.text).toBe('Google Safe Browsing');
  });

  it('is deterministic for a given link, so builds stay reproducible', () => {
    expect(render(link)).toBe(render(link));
  });

  it('varies phrasing across links, so one sentence does not repeat corpus-wide', () => {
    const titles = ['Alpha Guide', 'Beta Handbook', 'Gamma Checklist', 'Delta Reference', 'Epsilon Primer',
                    'Zeta Overview', 'Eta Walkthrough', 'Theta Notes', 'Iota Manual', 'Kappa Digest'];
    const leads = new Set(
      titles.map((t) => render({ title: t, url: '/guides/x/y', type: 'internal' }).replace(t + '.', '').trim()),
    );
    expect(leads.size).toBeGreaterThan(1);
  });
});
