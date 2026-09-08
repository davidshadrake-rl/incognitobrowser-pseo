/**
 * A–Z catalogue helpers — pure, framework-free, unit-tested.
 *
 * Every index page (guides, checklists, comparisons, templates, calculators,
 * tools on both tiers, report cards, glossary) renders the same catalogue:
 * a search box, a clickable letter bar, and entries grouped by first letter.
 * The grouping and the filter live here so the client component stays thin
 * and the behaviour is testable without a DOM.
 */

export interface CatalogueEntry {
  /** Display title; the letter group is derived from its first character. */
  title: string;
  href: string;
  description?: string;
  /** Secondary line, e.g. the niche name — also disambiguates duplicate titles. */
  meta?: string;
  /** Small chip, e.g. difficulty, tool type. */
  badge?: string;
  /** Report-card letter grade — rendered as the coloured GradeBadge instead of a text chip. */
  grade?: 'A' | 'B' | 'C' | 'D' | 'F';
  /** Extra searchable text that is not displayed (engine id, category, aliases). */
  keywords?: string;
}

export const LETTERS = ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'] as const;

/**
 * Leading filler words ignored when filing a title, the way a library
 * catalogue ignores "The". Without this every comparison ("Best …") lands
 * under B and most guides ("Complete Guide to …", "Advanced …") under C/A,
 * which makes a letter bar useless. Display titles are never changed.
 */
const LEADING_FILLER = new Set(['the', 'a', 'an', 'best', 'top', 'complete', 'advanced', 'ultimate', 'essential', 'free', 'your', 'how', 'to', 'guide', 'guides']);

/** The part of a title we file and sort by: the title minus leading filler words (falls back to the whole title). */
export function sortKeyOf(title: string): string {
  const words = title.trim().split(/\s+/);
  let i = 0;
  while (i < words.length - 1 && LEADING_FILLER.has(words[i].toLowerCase().replace(/[^a-z]/g, ''))) i++;
  return words.slice(i).join(' ') || title.trim();
}

/** Letter bucket for a title: A–Z, or '#' for anything else (digits, symbols). */
export function letterOf(title: string): string {
  // File by the sort key (leading filler ignored); strip diacritics so 'Éducation' files under E, not under #.
  const c = (sortKeyOf(title)[0] || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
  return c >= 'A' && c <= 'Z' ? c : '#';
}

/** Stable alphabetical order: title, then meta, so duplicate titles sit together in a predictable order. */
export function sortEntries<T extends CatalogueEntry>(entries: T[]): T[] {
  return [...entries].sort((a, b) => sortKeyOf(a.title).localeCompare(sortKeyOf(b.title), 'en', { sensitivity: 'base' }) || (a.meta || '').localeCompare(b.meta || '', 'en'));
}

/** Entries grouped by letter, in LETTERS order, only letters that have entries. */
export function groupByLetter<T extends CatalogueEntry>(entries: T[]): Array<{ letter: string; entries: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const e of sortEntries(entries)) {
    const l = letterOf(e.title);
    if (!buckets.has(l)) buckets.set(l, []);
    buckets.get(l)!.push(e);
  }
  return LETTERS.filter((l) => buckets.has(l)).map((l) => ({ letter: l, entries: buckets.get(l)! }));
}

function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Case- and accent-insensitive search. Every whitespace-separated token in
 * the query must appear somewhere in title + meta + badge + description +
 * keywords. An empty query matches everything.
 */
export function filterEntries<T extends CatalogueEntry>(entries: T[], query: string): T[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return entries;
  return entries.filter((e) => {
    const hay = normalize([e.title, e.meta, e.badge, e.description, e.keywords].filter(Boolean).join(' '));
    return tokens.every((t) => hay.includes(t));
  });
}
