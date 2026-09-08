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
}

export interface SiteReport extends EditableContent {
  domain: string;
  finalUrl: string;
  title: string;
  category: { category: SiteCategory; label: string; niche: string };
  scannedAt: string;
  grade: GradeResult;
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

/** "Changed since last scan" — null when there's no prior scan or nothing changed. */
export function gradeChange(site: SiteReport): { from: string; to: string; scoreDelta: number; since: string } | null {
  const prev = site.history?.[site.history.length - 1];
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
