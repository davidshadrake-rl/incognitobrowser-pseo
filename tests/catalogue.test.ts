/**
 * lib/catalogue — the A–Z + search behaviour shared by every index page.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { filingParts, filterEntries, groupByLetter, letterOf, sortEntries, sortKeyOf, type CatalogueEntry } from '../lib/catalogue';

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

/**
 * The A–Z shows each title split where its filing starts (AtoZCatalogue's
 * FiledTitle): the skipped lead words quiet, the filed words at full
 * strength, so "Complete Guide to Ad Tracking" visibly sits under A.
 */
describe('filingParts — the displayed split matches the filing', () => {
  it('splits off the leading filler, spacing kept, and the filed part starts with the filing letter', () => {
    expect(filingParts('Complete Guide to Ad Tracking')).toEqual({ lead: 'Complete Guide to ', filed: 'Ad Tracking' });
    expect(filingParts('Best CCPA Tools Compared')).toEqual({ lead: 'Best ', filed: 'CCPA Tools Compared' });
    expect(filingParts('How to Stop ISP Tracking')).toEqual({ lead: 'How to ', filed: 'Stop ISP Tracking' });
    expect(filingParts('Complete  Guide   to Browser Privacy')).toEqual({ lead: 'Complete  Guide   to ', filed: 'Browser Privacy' });
  });
  it('leaves a title with no filler whole', () => {
    expect(filingParts('Browser Privacy Audit')).toEqual({ lead: '', filed: 'Browser Privacy Audit' });
    expect(filingParts('2FA Setup Checklist')).toEqual({ lead: '', filed: '2FA Setup Checklist' });
  });
  it('never leaves the filed part empty, and trims outer whitespace', () => {
    expect(filingParts('The Best')).toEqual({ lead: 'The ', filed: 'Best' });
    expect(filingParts('Best')).toEqual({ lead: '', filed: 'Best' });
    expect(filingParts('  The Anonymous Web  ')).toEqual({ lead: 'The ', filed: 'Anonymous Web' });
    expect(filingParts('')).toEqual({ lead: '', filed: '' });
  });
  it('for every real catalogue title: lead + filed is the title, and filed starts with letterOf\'s letter', () => {
    const root = path.join(__dirname, '..', 'data');
    const titles: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.json')) {
          const t = (JSON.parse(fs.readFileSync(p, 'utf-8')) as { title?: unknown }).title;
          if (typeof t === 'string') titles.push(t);
        }
      }
    };
    for (const type of ['guides', 'checklists', 'comparisons', 'templates', 'calculators', 'tools']) walk(path.join(root, type));
    expect(titles.length).toBeGreaterThan(300);
    let split = 0;
    for (const t of titles) {
      const { lead, filed } = filingParts(t);
      expect(lead + filed, t).toBe(t.trim());
      expect(letterOf(filed), t).toBe(letterOf(t));
      if (lead) split++;
    }
    expect(split, 'comparisons and guides open with filler words').toBeGreaterThan(50);
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
