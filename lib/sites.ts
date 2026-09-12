/**
 * Site Privacy Report Cards — data access.
 *
 * data/sites/<domain>.json is produced offline by scripts/scan-sites.ts and
 * committed; nothing here touches the network. Pages read through these
 * helpers only.
 */
import fs from 'fs';
import path from 'path';
import type { GradeResult } from './site-grade';
import type { SiteCategory } from './site-categories';
import type { EditableContent } from './content';

const SITES_DIR = path.join(process.cwd(), 'data', 'sites');

export interface SiteHistoryEntry {
  scannedAt: string;
  grade?: string;
  score?: number;
  summary?: SiteReport['scan']['summary'];
  /** The rubric that produced this grade, when the scan that stored it recorded one. */
  rubricVersion?: string;
}

export interface SiteReport extends EditableContent {
  domain: string;
  finalUrl: string;
  title: string;
  category: { category: SiteCategory; label: string; niche: string };
  scannedAt: string;
  grade: GradeResult;
  /** The rubric the current grade was produced under, when the card records one. */
  rubricVersion?: string;
  scan: {
    status: number;
    cookies: Array<{ cookieName: string; name: string; category: string; risk: string; description: string; secure: boolean; httpOnly: boolean; sameSite: string; domain: string; path: string; maxAge: string | null; expires: string | null }>;
    trackers: Array<{ name: string; category: string; risk: string; description: string }>;
    inlineTrackers: string[];
    thirdPartyDomains: string[];
    security: { isHTTPS: boolean; hasCSP: boolean; hasPermPolicy: boolean; hasHSTS: boolean };
    summary: { totalCookies: number; trackingCookies: number; analyticsCookies: number; functionalCookies: number; totalTrackers: number; thirdPartyScripts: number; highRiskItems: number };
  };
  history: SiteHistoryEntry[];
}

let cache: SiteReport[] | null = null;

export function getAllSites(): SiteReport[] {
  if (cache) return cache;
  if (!fs.existsSync(SITES_DIR)) return (cache = []);
  cache = fs
    .readdirSync(SITES_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(SITES_DIR, f), 'utf-8')) as SiteReport)
    .filter((s) => s && s.domain && s.grade)
    .sort((a, b) => a.domain.localeCompare(b.domain));
  return cache;
}

export function getSite(domain: string): SiteReport | null {
  const fp = path.join(SITES_DIR, `${domain}.json`);
  if (!fs.existsSync(fp)) return null;
  return JSON.parse(fs.readFileSync(fp, 'utf-8')) as SiteReport;
}

/** Same-category siblings, nearest by score, excluding self. */
export function getSiblingSites(site: SiteReport, limit = 6): SiteReport[] {
  return getAllSites()
    .filter((s) => s.domain !== site.domain && s.category.category === site.category.category)
    .sort((a, b) => Math.abs(a.grade.score - site.grade.score) - Math.abs(b.grade.score - site.grade.score))
    .slice(0, limit);
}

export function getSitesByCategory(): Record<string, SiteReport[]> {
  const out: Record<string, SiteReport[]> = {};
  for (const s of getAllSites()) (out[s.category.category] ||= []).push(s);
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.grade.score - b.grade.score);
  return out;
}

export function getExtremes(n = 10): { worst: SiteReport[]; best: SiteReport[] } {
  const all = [...getAllSites()].sort((a, b) => a.grade.score - b.grade.score);
  return { worst: all.slice(0, n), best: all.slice(-n).reverse() };
}

export function gradeDistribution(): Record<string, number> {
  const d: Record<string, number> = { A: 0, B: 0, C: 0, D: 0, F: 0 };
  for (const s of getAllSites()) d[s.grade.grade] = (d[s.grade.grade] || 0) + 1;
  return d;
}

/**
 * The rubric the published grades were produced under (lib/site-grade.ts plus
 * what lib/scanner.ts counts). BUMP BOTH OF THESE whenever those rules change,
 * so a grade from the old rubric is never published as a change in the site.
 *
 * On 2026-09-11 the rubric changed (infrastructure cookies stopped counting as
 * tracking cookies, 55 more scripts started counting as trackers, one cookie
 * set several times started counting once) and every card was re-graded from
 * its stored scan. cnn.com then read "Changed since September 8, 2026: D → F",
 * which CNN had not done: the rubric had changed, not the site.
 */
export const RUBRIC_VERSION = '2026-09-11';
/** Scans from before this ran under an older rubric, so their grades can't be compared with today's. */
export const RUBRIC_UPDATED_AT = '2026-09-11T00:00:00.000Z';
/**
 * Two scans less than this apart are one batch, not a change over time.
 * scripts/scan-sites.ts once wrote the same site twice a second apart, leaving
 * a "previous grade" that is really the current one.
 */
export const SAME_BATCH_MS = 24 * 60 * 60 * 1000;

/**
 * Can this history entry's grade be compared with the card's current grade?
 * Only when both were produced by the same rubric and by two different scans.
 * A card and an entry that both name a rubric are compared on that; otherwise
 * the entry has to be a scan from after the last rubric update.
 */
export function isComparableHistory(site: SiteReport, entry: SiteHistoryEntry | undefined): boolean {
  if (!entry || entry.grade === undefined || entry.score === undefined || !entry.scannedAt) return false;
  const then = Date.parse(entry.scannedAt);
  const now = Date.parse(site.scannedAt);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return false;
  if (now - then < SAME_BATCH_MS) return false;
  if (entry.rubricVersion && site.rubricVersion) return entry.rubricVersion === site.rubricVersion;
  return then >= Date.parse(RUBRIC_UPDATED_AT);
}

/**
 * "Changed since last scan" — null unless a previous scan is genuinely
 * comparable (same rubric, different scan) and the grade or score moved.
 * A grade that moved because the rubric moved is not a change in the site.
 */
export function gradeChange(site: SiteReport): { from: string; to: string; scoreDelta: number; since: string } | null {
  const prev = [...(site.history || [])].reverse().find((e) => isComparableHistory(site, e));
  if (!prev || prev.grade === undefined || prev.score === undefined) return null;
  if (prev.grade === site.grade.grade && prev.score === site.grade.score) return null;
  return { from: prev.grade, to: site.grade.grade, scoreDelta: site.grade.score - prev.score, since: prev.scannedAt };
}

/** Report cards are automated output — published means status only; there is no human author to require. */
export function isSitePublished(site: SiteReport | null | undefined): boolean {
  return !!site && site.editorial?.status === 'published';
}

export function domainToSlug(domain: string): string {
  return domain; // dots are fine in a path segment; kept explicit for future changes
}
