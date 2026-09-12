/**
 * data/sites — the 500 report cards are files whose names become URL paths.
 * Pins: lowercase, no "www.", filename == domain field, no case-duplicates.
 * (Two cards once shipped as Princeton.EDU and WWW.garmin.com — audit 2026-09-08.)
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { getAllSites, gradeChange, isComparableHistory, RUBRIC_UPDATED_AT, RUBRIC_VERSION, SAME_BATCH_MS, type SiteHistoryEntry, type SiteReport } from '../lib/sites';

const dir = path.join(process.cwd(), 'data', 'sites');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));

describe('data/sites filenames and domains', () => {
  it('has the expected number of cards', () => {
    expect(files.length).toBeGreaterThanOrEqual(500);
  });
  it('every filename is lowercase, has no www. prefix, and matches its domain field', () => {
    for (const f of files) {
      expect(f, f).toMatch(/^[a-z0-9.-]+\.json$/);
      expect(f.startsWith('www.'), f).toBe(false);
      const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as { domain: string };
      expect(j.domain, f).toBe(f.replace(/\.json$/, ''));
    }
  });
  it('has no case-insensitive duplicate domains', () => {
    const seen = new Map<string, string>();
    for (const f of files) {
      const k = f.toLowerCase();
      expect(seen.has(k), `${f} duplicates ${seen.get(k)}`).toBe(false);
      seen.set(k, f);
    }
  });
});

/**
 * "Changed since <date>: D → F" is a claim about the site, so it may only
 * compare two scans graded by the same rubric.
 *
 * On 2026-09-11 the rubric changed and every card was re-graded from its
 * stored scan. cnn.com's card then read "Changed since September 8, 2026:
 * D → F (−3 points)" in red, beside "Homepage scanned September 8, 2026" —
 * CNN had done nothing; Optimizely had started counting. Its history entry,
 * and google.com's and wikipedia.org's, were duplicates of the current scan
 * from the same batch, one second earlier; those three were removed.
 */
const site = (over: Partial<SiteReport> = {}): SiteReport =>
  ({ domain: 'x.test', scannedAt: '2026-10-08T02:00:00.000Z', grade: { grade: 'F', score: 43 }, history: [], ...over }) as SiteReport;
const entry = (over: Partial<SiteHistoryEntry> = {}): SiteHistoryEntry =>
  ({ scannedAt: '2026-09-08T02:00:00.000Z', grade: 'D', score: 46, ...over });

describe('gradeChange only compares two scans from one rubric', () => {
  it('ignores a scan from before the rubric update: that grade came from other rules', () => {
    expect(isComparableHistory(site(), entry())).toBe(false);
    expect(gradeChange(site({ history: [entry()] }))).toBeNull();
  });

  it('ignores a second scan from the same batch, whatever its date', () => {
    const s = site({ scannedAt: '2026-10-08T02:34:10.697Z' });
    expect(isComparableHistory(s, entry({ scannedAt: '2026-10-08T02:34:09.702Z' }))).toBe(false);
    expect(isComparableHistory(s, entry({ scannedAt: '2026-10-07T14:00:00.000Z' }))).toBe(false); // under a day
    expect(isComparableHistory(s, entry({ scannedAt: '2026-10-07T02:00:00.000Z' }))).toBe(true);
    expect(Date.parse(RUBRIC_UPDATED_AT)).toBeLessThan(Date.parse('2026-10-07T02:00:00.000Z'));
    expect(SAME_BATCH_MS).toBe(24 * 60 * 60 * 1000);
  });

  it('reports a real change between two scans under the current rubric', () => {
    const change = gradeChange(site({ history: [entry({ scannedAt: '2026-09-12T02:00:00.000Z' })] }));
    expect(change).toEqual({ from: 'D', to: 'F', scoreDelta: -3, since: '2026-09-12T02:00:00.000Z' });
  });

  it('says nothing when a comparable scan found the same grade and score', () => {
    expect(gradeChange(site({ history: [entry({ scannedAt: '2026-09-12T02:00:00.000Z', grade: 'F', score: 43 })] }))).toBeNull();
  });

  it('takes the newest comparable scan, skipping entries from another rubric', () => {
    const s = site({ history: [entry({ scannedAt: '2026-09-12T02:00:00.000Z', grade: 'C', score: 65 }), entry()] });
    expect(gradeChange(s)?.since).toBe('2026-09-12T02:00:00.000Z');
  });

  it('when both name a rubric, the rubric decides, not the date', () => {
    const s = site({ rubricVersion: RUBRIC_VERSION, history: [entry({ scannedAt: '2026-09-12T02:00:00.000Z', rubricVersion: '2026-12-01' })] });
    expect(gradeChange(s)).toBeNull();
    expect(gradeChange(site({ rubricVersion: RUBRIC_VERSION, history: [entry({ scannedAt: '2026-09-12T02:00:00.000Z', rubricVersion: RUBRIC_VERSION })] }))).not.toBeNull();
    // A pre-update scan stays out even if it claims today's rubric version on a card that names none.
    expect(isComparableHistory(site(), entry({ rubricVersion: RUBRIC_VERSION }))).toBe(false);
  });

  it('ignores an entry with no grade, score or date, and an unparseable date', () => {
    expect(isComparableHistory(site(), undefined)).toBe(false);
    expect(isComparableHistory(site(), entry({ grade: undefined }))).toBe(false);
    expect(isComparableHistory(site(), entry({ score: undefined }))).toBe(false);
    expect(isComparableHistory(site(), entry({ scannedAt: '' }))).toBe(false);
    expect(isComparableHistory(site(), entry({ scannedAt: 'last Tuesday' }))).toBe(false);
    expect(isComparableHistory(site({ scannedAt: 'soon' }), entry({ scannedAt: '2026-09-12T02:00:00.000Z' }))).toBe(false);
  });
});

describe('the published cards', () => {
  const sites = getAllSites();

  it('publishes no grade change between two rubrics or inside one scan batch', () => {
    for (const s of sites) {
      const change = gradeChange(s);
      if (!change) continue;
      expect(Date.parse(change.since), `${s.domain}: "changed since" a pre-rubric scan`).toBeGreaterThanOrEqual(Date.parse(RUBRIC_UPDATED_AT));
      expect(Date.parse(s.scannedAt) - Date.parse(change.since), `${s.domain}: "changed since" the same scan batch`).toBeGreaterThanOrEqual(SAME_BATCH_MS);
    }
  });

  it('keeps no history entry that is really the current scan run again', () => {
    for (const s of sites) {
      for (const h of s.history || []) {
        expect(Date.parse(s.scannedAt) - Date.parse(h.scannedAt), `${s.domain} keeps a same-batch history entry (${h.scannedAt})`).toBeGreaterThanOrEqual(SAME_BATCH_MS);
      }
    }
  });

  it('counts a cookie set several times once', () => {
    for (const s of sites) {
      const ids = s.scan.cookies.map((c) => `${c.cookieName}|${c.domain.toLowerCase()}|${c.path}`);
      expect(new Set(ids).size, `${s.domain} publishes the same cookie more than once`).toBe(ids.length);
    }
  });
});
