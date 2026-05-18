/**
 * Editorial gate tests.
 *
 * These enforce the contract that protects the site from the "scaled
 * content abuse" pattern Google's Helpful Content classifier targets:
 *
 *   - draft pages MUST NOT appear in the sitemap
 *   - draft pages MUST emit noindex,follow
 *   - a page with status='published' but no named author is invalid
 *     (treated as not-published for indexing purposes)
 *
 * If anyone tries to flip a page to 'published' without an author block,
 * `isPublished()` returns false and these tests stay green by design.
 */
import { describe, it, expect } from 'vitest';
import { isPublished } from '../lib/content';

describe('isPublished editorial gate', () => {
  it('returns false for null/undefined', () => {
    expect(isPublished(null)).toBe(false);
    expect(isPublished(undefined)).toBe(false);
  });

  it('returns false for status=draft (even with an author)', () => {
    expect(
      isPublished({
        editorial: { status: 'draft' },
        author: { name: 'Real Person' },
      })
    ).toBe(false);
  });

  it("returns false for status='reviewed' (interim state, not indexable)", () => {
    expect(
      isPublished({
        editorial: { status: 'reviewed' },
        author: { name: 'Real Person' },
      })
    ).toBe(false);
  });

  it('returns false for status=published WITHOUT author', () => {
    expect(
      isPublished({
        editorial: { status: 'published' },
        author: null,
      })
    ).toBe(false);
  });

  it('returns false for status=published with empty author name', () => {
    expect(
      isPublished({
        editorial: { status: 'published' },
        author: { name: '' },
      })
    ).toBe(false);
  });

  it('returns TRUE only when status=published AND author has a name', () => {
    expect(
      isPublished({
        editorial: { status: 'published' },
        author: {
          name: 'David Shadrake',
          bio: 'Security engineer',
          credentials: '10 years infosec',
        },
      })
    ).toBe(true);
  });

  it('returns false when editorial is missing entirely (legacy file)', () => {
    expect(isPublished({ author: { name: 'X' } } as never)).toBe(false);
  });
});
