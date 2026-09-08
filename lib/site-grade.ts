/**
 * Site Privacy Report Card — grading rubric.
 *
 * Turns a scanner result (the same shape /scan-url returns and the batch
 * scanner writes to data/sites/*.json) into a 0–100 score and an A–F grade.
 *
 * Design goals:
 *   - TRANSPARENT: every deduction is itemised and shown on the page, so a
 *     grade can be argued with (which is the point — arguable pages get
 *     linked and discussed).
 *   - HOMEPAGE-ONLY, first load, no consent clicked: we grade what a site
 *     does to a visitor before they agree to anything. The page says so.
 *   - STABLE: same input → same grade, so monthly re-scans produce honest
 *     "changed since last scan" diffs.
 *
 * Scoring (start at 100, deduct, floor 0):
 *   tracking cookies set before consent   −8 each (cap −32)
 *   high-risk trackers (ad/marketing)     −6 each (cap −30)
 *   analytics trackers                    −3 each (cap −12)
 *   inline pixels (fbq/gtag/twq/…)        −3 each (cap −9)
 *   third-party script domains            −1 each over 5 (cap −15)
 *   not HTTPS                             −25
 *   no HSTS                               −3
 *   no CSP                                −3
 *   no Permissions-Policy                 −1
 * Grade: A ≥90, B ≥78, C ≥62, D ≥45, F otherwise.
 */

export interface ScanSummaryLike {
  cookies?: Array<{ category: string; risk: string }>;
  trackers?: Array<{ category: string; risk: string; name?: string }>;
  inlineTrackers?: string[];
  thirdPartyDomains?: string[];
  security?: { isHTTPS?: boolean; hasCSP?: boolean; hasPermPolicy?: boolean; hasHSTS?: boolean };
}

export interface Deduction {
  reason: string;
  points: number;
  detail?: string;
}

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

export interface GradeResult {
  score: number;
  grade: Grade;
  deductions: Deduction[];
  /** One-line, plain-English summary suitable for a meta description. */
  headline: string;
}

const cap = (n: number, max: number) => Math.min(n, max);

export function gradeSite(r: ScanSummaryLike): GradeResult {
  const deductions: Deduction[] = [];
  const cookies = r.cookies ?? [];
  const trackers = r.trackers ?? [];
  const inline = r.inlineTrackers ?? [];
  const third = r.thirdPartyDomains ?? [];
  const sec = r.security ?? {};

  const trackingCookies = cookies.filter((c) => c.category === 'tracking').length;
  if (trackingCookies) deductions.push({ reason: 'Tracking cookies set before any consent', points: cap(trackingCookies * 8, 32), detail: `${trackingCookies} tracking cookie${trackingCookies === 1 ? '' : 's'}` });

  const adTrackers = trackers.filter((t) => t.category === 'tracking' || t.risk === 'high');
  if (adTrackers.length) deductions.push({ reason: 'Advertising / marketing trackers loaded', points: cap(adTrackers.length * 6, 30), detail: adTrackers.map((t) => t.name).filter(Boolean).slice(0, 6).join(', ') });

  const analytics = trackers.filter((t) => t.category === 'analytics' && t.risk !== 'high');
  if (analytics.length) deductions.push({ reason: 'Analytics trackers loaded', points: cap(analytics.length * 3, 12), detail: analytics.map((t) => t.name).filter(Boolean).slice(0, 6).join(', ') });

  if (inline.length) deductions.push({ reason: 'Inline tracking pixels', points: cap(inline.length * 3, 9), detail: inline.slice(0, 6).join(', ') });

  const extraThird = Math.max(0, third.length - 5);
  if (extraThird) deductions.push({ reason: 'Third-party script domains beyond a reasonable five', points: cap(extraThird, 15), detail: `${third.length} third-party domains` });

  if (sec.isHTTPS === false) deductions.push({ reason: 'Not served over HTTPS', points: 25 });
  if (!sec.hasHSTS) deductions.push({ reason: 'No HSTS (Strict-Transport-Security)', points: 3 });
  if (!sec.hasCSP) deductions.push({ reason: 'No Content-Security-Policy', points: 3 });
  if (!sec.hasPermPolicy) deductions.push({ reason: 'No Permissions-Policy', points: 1 });

  const total = deductions.reduce((s, d) => s + d.points, 0);
  const score = Math.max(0, 100 - total);
  const grade: Grade = score >= 90 ? 'A' : score >= 78 ? 'B' : score >= 62 ? 'C' : score >= 45 ? 'D' : 'F';

  const parts: string[] = [];
  if (trackingCookies) parts.push(`${trackingCookies} tracking cookie${trackingCookies === 1 ? '' : 's'} before consent`);
  if (adTrackers.length) parts.push(`${adTrackers.length} ad tracker${adTrackers.length === 1 ? '' : 's'}`);
  if (third.length) parts.push(`${third.length} third-party domains`);
  const headline = parts.length ? `Grade ${grade}: ${parts.join(', ')} on the homepage.` : `Grade ${grade}: no trackers or tracking cookies detected on the homepage.`;

  return { score, grade, deductions, headline };
}

export const GRADE_LABEL: Record<Grade, string> = {
  A: 'Minimal tracking',
  B: 'Light tracking',
  C: 'Moderate tracking',
  D: 'Heavy tracking',
  F: 'Aggressive tracking',
};
