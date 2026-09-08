/**
 * lib/catalogue — the A–Z + search behaviour shared by every index page.
 */
import { describe, expect, it } from 'vitest';
import { filterEntries, groupByLetter, letterOf, sortEntries, sortKeyOf, type CatalogueEntry } from '../lib/catalogue';

const E: CatalogueEntry[] = [
  { title: 'Browser Privacy Audit', href: '/a', meta: 'Browser Privacy', badge: 'analyzer', keywords: 'browser-privacy' },
  { title: 'Browser Privacy Audit', href: '/b', meta: 'AI & Machine Learning Privacy', badge: 'analyzer', keywords: 'browser-privacy' },
  { title: 'Cookie & Tracker Scanner', href: '/c', meta: 'Ad Tracking', badge: 'scanner', description: 'Scan any URL for tracking cookies' },
  { title: '2FA Setup Checklist', href: '/d', meta: 'Account Security' },
  { title: 'Éducation à la vie privée', href: '/e' },
  { title: 'anonymous browsing guide', href: '/f', meta: 'Tor' },
];

describe('letterOf', () => {
  it('buckets A–Z case-insensitively and everything else under #', () => {
    expect(letterOf('Browser')).toBe('B');
    expect(letterOf('anonymous')).toBe('A');
    expect(letterOf('2FA')).toBe('#');
    expect(letterOf('  Zed')).toBe('Z');
    expect(letterOf('')).toBe('#');
    expect(letterOf('Éducation')).toBe('E');
  });
});

describe('sortKeyOf — leading filler is ignored for filing, never for display', () => {
  it('strips Best / Complete Guide to / The / How to, and keeps the rest verbatim', () => {
    expect(sortKeyOf('Best Browser Privacy Tools Compared: 2025 Complete Guide')).toBe('Browser Privacy Tools Compared: 2025 Complete Guide');
    expect(sortKeyOf('Complete Guide to Browser Privacy')).toBe('Browser Privacy');
    expect(sortKeyOf('Advanced ISP Tracking Techniques')).toBe('ISP Tracking Techniques');
    expect(sortKeyOf('The Anonymous Web')).toBe('Anonymous Web');
    expect(sortKeyOf('How to Stop ISP Tracking')).toBe('Stop ISP Tracking');
    expect(sortKeyOf('Browser Privacy Audit')).toBe('Browser Privacy Audit');
  });
  it('never strips a title down to nothing', () => {
    expect(sortKeyOf('The Best')).toBe('Best');
    expect(sortKeyOf('Best')).toBe('Best');
  });
  it('letterOf files by the sort key', () => {
    expect(letterOf('Best CCPA Tools Compared')).toBe('C');
    expect(letterOf('Complete Guide to Browser Privacy')).toBe('B');
  });
});

describe('sortEntries / groupByLetter', () => {
  it('sorts case-insensitively, then by meta for duplicate titles, and does not mutate input', () => {
    const copy = [...E];
    const sorted = sortEntries(E);
    expect(E).toEqual(copy);
    expect(sorted.map((e) => e.href)).toEqual(['/d', '/f', '/b', '/a', '/c', '/e']);
  });
  it('groups in # A–Z order with only populated letters', () => {
    const g = groupByLetter(E);
    expect(g.map((x) => x.letter)).toEqual(['#', 'A', 'B', 'C', 'E']); // É files under E
    expect(g.find((x) => x.letter === 'B')!.entries.map((e) => e.href)).toEqual(['/b', '/a']);
  });
});

describe('filterEntries', () => {
  it('empty query returns everything', () => {
    expect(filterEntries(E, '   ')).toHaveLength(E.length);
  });
  it('matches title, meta, badge, description and hidden keywords, case-insensitively', () => {
    expect(filterEntries(E, 'cookie').map((e) => e.href)).toEqual(['/c']);
    expect(filterEntries(E, 'AD TRACKING').map((e) => e.href)).toEqual(['/c']);
    expect(filterEntries(E, 'scanner').map((e) => e.href)).toEqual(['/c']);
    expect(filterEntries(E, 'tracking cookies').map((e) => e.href)).toEqual(['/c']);
    expect(filterEntries(E, 'browser-privacy').map((e) => e.href)).toEqual(['/a', '/b']);
  });
  it('requires every token (AND), in any order', () => {
    expect(filterEntries(E, 'audit machine').map((e) => e.href)).toEqual(['/b']);
    expect(filterEntries(E, 'machine audit').map((e) => e.href)).toEqual(['/b']);
    expect(filterEntries(E, 'audit nothing-like-this')).toEqual([]);
  });
  it('is accent-insensitive', () => {
    expect(filterEntries(E, 'education').map((e) => e.href)).toEqual(['/e']);
  });
});
