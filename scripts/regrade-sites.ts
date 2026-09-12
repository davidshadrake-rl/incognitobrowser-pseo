/**
 * Site Privacy Report Cards — re-grade the stored cards WITHOUT rescanning.
 *
 * Run it after a change to what lib/scanner.ts counts (KNOWN_COOKIES,
 * KNOWN_COOKIE_PATTERNS, TRACKER_PATTERNS) or to lib/site-grade.ts's rubric,
 * so data/sites/*.json follows the rules the methodology page describes.
 * Written 2026-09-11 for the funnel pilot's fixes: load-balancer, CDN and
 * bot-protection cookies stopped counting as tracking cookies, comScore and
 * 54 more ad and analytics scripts started counting as trackers, and the
 * headline stopped saying "no trackers" beside a tracker.
 *
 * Per card:
 *   - cookies: one cookie set several times in the same response is collapsed
 *     to one, by lib/scanner's dedupeCookies (name + domain + path, the last
 *     one kept, as a browser does), the same rule analyzeScan now applies to a
 *     fresh scan. Every remaining cookie is then classified again by
 *     categorizeCookie(), from a Set-Cookie line rebuilt out of what the card kept (name,
 *     Expires, Max-Age, Secure, HttpOnly, SameSite). Cards never keep cookie
 *     values, so a rule that read the value could not be replayed; none does
 *     (on 2026-09-11 the rebuilt lines reproduced the stored category of all
 *     1,092 stored cookies under the old rules).
 *   - trackers: the stored trackers, plus every TRACKER_PATTERNS entry that
 *     matches one of the stored third-party script domains. This only
 *     APPROXIMATES a rescan: a rescan matches the patterns against the whole
 *     page HTML, so it also finds trackers named by a path (linkedin.com/px),
 *     an inline snippet, or a protocol-relative script (//bat.bing.com) that
 *     the stored domain list does not have. It never drops a stored tracker.
 *   - scan.summary, the grade, its deductions and the headline are computed
 *     again (gradeSite). scannedAt and history are left alone: nobody visited
 *     the page again. summary.thirdPartyScripts is kept too (the scan counted
 *     domains before capping the stored list).
 *   - editorial.updatedAt is stamped with REGRADED_AT on any card this
 *     rewrites, so a card's modified date can follow the day its grade
 *     changed rather than the day it was scanned. reviewedAt is not touched.
 *
 * A file is rewritten only when it changes, keys in their original order,
 * in the format scripts/scan-sites.ts writes (2-space JSON, trailing newline).
 *
 * Usage:
 *   npx tsx scripts/regrade-sites.ts [--dry-run] [--report <file>] [--whatif-samesite <file>]
 *
 *   --report            churn report (old → new grade counts, and every card
 *                       whose grade or headline changed, with the reason);
 *                       printed to stdout when omitted.
 *   --whatif-samesite   also write what would change if an unrecognized
 *                       SameSite=None cookie counted as 'unknown' instead of
 *                       'tracking'. Computed only; never written to the cards.
 */
import fs from 'node:fs';
import path from 'node:path';
import { categorizeCookie, dedupeCookies, SAMESITE_NONE_GUESS, TRACKER_PATTERNS } from '../lib/scanner';
import { gradeSite, type GradeResult } from '../lib/site-grade';
import { stampUpdatedAt } from './stamp-updated';

/**
 * The date a re-graded card is stamped with, in editorial.updatedAt (placed
 * by the same stampUpdatedAt every other data/ file uses: right after
 * reviewedAt, and reviewedAt is never touched).
 *
 * A card whose grade, cookies or trackers this script rewrites was last
 * changed today, not on the day it was scanned. "Homepage scanned <date>"
 * keeps reading scannedAt, which is still true: nobody visited the site again.
 */
export const REGRADED_AT = '2026-09-11';

export interface StoredCookie {
  cookieName: string;
  name: string;
  category: string;
  risk: string;
  description: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  domain: string;
  path: string;
  maxAge: string | null;
  expires: string | null;
}

export interface StoredTracker {
  name: string;
  category: string;
  risk: string;
  description: string;
}

export interface StoredCard {
  domain: string;
  grade: GradeResult;
  scan: {
    cookies: StoredCookie[];
    trackers: StoredTracker[];
    inlineTrackers: string[];
    thirdPartyDomains: string[];
    security: { isHTTPS: boolean; hasCSP: boolean; hasPermPolicy: boolean; hasHSTS: boolean };
    summary: { totalCookies: number; trackingCookies: number; analyticsCookies: number; functionalCookies: number; totalTrackers: number; thirdPartyScripts: number; highRiskItems: number };
    [key: string]: unknown;
  };
  history?: Array<{ scannedAt?: string; grade?: string; score?: number }>;
  [key: string]: unknown;
}

export interface CookieChange {
  cookieName: string;
  from: string;
  to: string;
  /** categorizeCookie's name for it now ("AWS Load Balancer", "Unknown", …). */
  as: string;
}

export interface CardChange {
  domain: string;
  cookies: CookieChange[];
  /** Stored Set-Cookie lines that were the same cookie set again (name + domain + path). */
  droppedDuplicates: number;
  addedTrackers: StoredTracker[];
  before: Pick<GradeResult, 'grade' | 'score' | 'headline'>;
  after: Pick<GradeResult, 'grade' | 'score' | 'headline'>;
  /** Anything in the card differs (a cookie's description counts). */
  changed: boolean;
}

export interface RegradeOptions {
  /** What-if only: an unrecognized SameSite=None cookie counts as 'unknown', not 'tracking'. */
  sameSiteNoneAsUnknown?: boolean;
}

/** The Set-Cookie line the scanner would have seen, minus the value, which cards never keep. */
export function setCookieLine(c: Pick<StoredCookie, 'cookieName' | 'expires' | 'maxAge' | 'secure' | 'httpOnly' | 'sameSite'>): string {
  const parts = [`${c.cookieName}=x`];
  if (c.expires) parts.push(`Expires=${c.expires}`);
  if (c.maxAge) parts.push(`Max-Age=${c.maxAge}`);
  if (c.secure) parts.push('Secure');
  if (c.httpOnly) parts.push('HttpOnly');
  if (c.sameSite && c.sameSite !== 'not set') parts.push(`SameSite=${c.sameSite}`);
  return parts.join('; ');
}

const UNKNOWN_COOKIE = { name: 'Unknown', category: 'unknown', risk: 'low', description: 'Purpose unknown — could be functional or tracking' } as const;

const pick = (g: GradeResult) => ({ grade: g.grade, score: g.score, headline: g.headline });

/** Re-grade one card. Returns a new object; the input is not modified. */
export function regradeCard(input: StoredCard, opts: RegradeOptions = {}): { card: StoredCard; change: CardChange } {
  const card = JSON.parse(JSON.stringify(input)) as StoredCard;
  const scan = card.scan;

  // Same rule as analyzeScan: one cookie per name + domain + path.
  const kept = dedupeCookies(scan.cookies);
  const droppedDuplicates = scan.cookies.length - kept.length;
  scan.cookies = kept;

  const cookies: CookieChange[] = [];
  for (const c of scan.cookies) {
    const found = categorizeCookie(setCookieLine(c));
    const r = opts.sameSiteNoneAsUnknown && found.name === SAMESITE_NONE_GUESS ? UNKNOWN_COOKIE : found;
    if (r.category !== c.category) cookies.push({ cookieName: c.cookieName, from: c.category, to: r.category, as: r.name });
    // Assigned in place so the cookie keeps its key order.
    c.name = r.name;
    c.category = r.category;
    c.risk = r.risk;
    c.description = r.description;
  }

  // Approximates a rescan (see the header): stored trackers + patterns that match a stored script domain.
  const have = new Set(scan.trackers.map((t) => t.name));
  const addedTrackers = TRACKER_PATTERNS
    .filter((t) => !have.has(t.name) && scan.thirdPartyDomains.some((d) => t.pattern.test(d)))
    .map(({ name, category, risk, description }) => ({ name, category, risk, description }));
  if (addedTrackers.length) {
    // In TRACKER_PATTERNS order, as analyzeScan lists them.
    const order = new Map(TRACKER_PATTERNS.map((t, i) => [t.name, i]));
    const rank = (name: string) => order.get(name) ?? Number.MAX_SAFE_INTEGER;
    scan.trackers = [...scan.trackers, ...addedTrackers].sort((a, b) => rank(a.name) - rank(b.name));
  }

  const s = scan.summary;
  s.totalCookies = scan.cookies.length;
  s.trackingCookies = scan.cookies.filter((c) => c.category === 'tracking').length;
  s.analyticsCookies = scan.cookies.filter((c) => c.category === 'analytics').length;
  s.functionalCookies = scan.cookies.filter((c) => c.category === 'functional').length;
  s.totalTrackers = scan.trackers.length;
  s.highRiskItems = scan.cookies.filter((c) => c.risk === 'high').length + scan.trackers.filter((t) => t.risk === 'high').length;

  card.grade = gradeSite(scan);

  // Measured before the stamp, so the stamp is never what makes a card
  // "changed" — a second run over a stamped card rewrites nothing.
  const changed = JSON.stringify(card) !== JSON.stringify(input);
  const out = changed ? (stampUpdatedAt(card, REGRADED_AT).json as StoredCard) : card;

  return {
    card: out,
    change: {
      domain: card.domain,
      cookies,
      droppedDuplicates,
      addedTrackers,
      before: pick(input.grade),
      after: pick(card.grade),
      changed,
    },
  };
}

// --- reports ---------------------------------------------------------------------

const gradeLabel = (g: Pick<GradeResult, 'grade' | 'score'>) => `${g.grade} ${g.score}`;

/** The parts of a headline change that come from the headline rule itself, not from new findings. */
function headlineRuleReasons(c: CardChange): string[] {
  const was = c.before.headline;
  const now = c.after.headline;
  const why: string[] = [];
  if (/\d analytics trackers?\b/.test(now) && !/\d analytics trackers?\b/.test(was)) why.push('the headline now counts analytics trackers');
  if (/\d tracking pixels?\b/.test(now) && !/\d tracking pixels?\b/.test(was)) why.push('the headline now counts tracking pixels that no tracker already covers');
  if (/no ad or analytics trackers/.test(now) && !/no ad or analytics trackers/.test(was)) why.push('"no trackers" now reads "no ad or analytics trackers"');
  return why;
}

function reasons(c: CardChange): string[] {
  const out: string[] = [];
  if (c.droppedDuplicates) out.push(`duplicate Set-Cookie lines collapsed (same name, domain and path): ${c.droppedDuplicates}`);
  if (c.cookies.length) out.push(`cookies: ${c.cookies.map((k) => `${k.cookieName} ${k.from} → ${k.to} (${k.as})`).join('; ')}`);
  if (c.addedTrackers.length) out.push(`trackers found on stored script domains: ${c.addedTrackers.map((t) => `+ ${t.name} (${t.category})`).join('; ')}`);
  if (c.before.headline !== c.after.headline) {
    const rule = headlineRuleReasons(c);
    if (rule.length) out.push(`headline rule: ${rule.join('; ')}`);
    else if (!out.length) out.push('headline rule');
  }
  return out;
}

function transitions(changes: CardChange[]): string[] {
  const counts = new Map<string, number>();
  for (const c of changes) {
    const k = `${c.before.grade} → ${c.after.grade}`;
    counts.set(k, (counts.get(k) || 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `  ${k}: ${n}`);
}

function tally<T>(items: T[], key: (t: T) => string): string[] {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(key(i), (counts.get(key(i)) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, n]) => `  ${String(n).padStart(4)}  ${k}`);
}

export function churnReport(changes: CardChange[], historyCards: Set<string> = new Set()): string {
  const gradeMoved = changes.filter((c) => c.before.grade !== c.after.grade);
  const scoreMoved = changes.filter((c) => c.before.score !== c.after.score);
  const headlineMoved = changes.filter((c) => c.before.headline !== c.after.headline);
  const listed = changes.filter((c) => c.before.grade !== c.after.grade || c.before.headline !== c.after.headline);
  const deduped = changes.filter((c) => c.droppedDuplicates);
  const allCookies = changes.flatMap((c) => c.cookies);
  const allTrackers = changes.flatMap((c) => c.addedTrackers.map((t) => ({ t, domain: c.domain })));
  const mixedHistory = scoreMoved.filter((c) => historyCards.has(c.domain));
  const lines = [
    'Report-card regrade (no rescan): scripts/regrade-sites.ts',
    `Cards: ${changes.length}. Files changed: ${changes.filter((c) => c.changed).length}. Grade changed: ${gradeMoved.length}. Score changed: ${scoreMoved.length}. Headline changed: ${headlineMoved.length}.`,
    '',
    `Duplicate Set-Cookie lines collapsed (one cookie set several times counts once): ${deduped.reduce((n, c) => n + c.droppedDuplicates, 0)} on ${deduped.length} card(s).`,
    ...deduped.map((c) => `  ${c.domain}: ${c.droppedDuplicates}`),
    '',
    'Grades, old → new (every card):',
    ...transitions(changes),
    '',
    `Cookies re-classified (${allCookies.length}), by old → new category and what they are now:`,
    ...tally(allCookies, (k) => `${k.from} → ${k.to}  ${k.as}`),
    '',
    `Trackers added from stored script domains (${allTrackers.length}), by tracker:`,
    ...tally(allTrackers, ({ t }) => `${t.name} (${t.category}, ${t.risk})`),
    '',
    mixedHistory.length
      ? `WARNING: ${mixedHistory.length} card(s) with a history entry changed score, so their "Changed since" line now compares grades from two rubrics: ${mixedHistory.map((c) => c.domain).join(', ')}`
      : `Cards with a history entry (${[...historyCards].join(', ') || 'none'}): none changed score, so no "Changed since" line mixes rubrics.`,
    '',
    `Every card whose grade or headline changed (${listed.length}):`,
  ];
  for (const c of listed) {
    lines.push('', `${c.domain}  ${gradeLabel(c.before)} → ${gradeLabel(c.after)}`);
    for (const r of reasons(c)) lines.push(`  ${r}`);
    if (c.before.headline !== c.after.headline) {
      lines.push(`  was: ${c.before.headline}`, `  now: ${c.after.headline}`);
    }
  }
  return lines.join('\n') + '\n';
}

export function whatIfReport(changes: CardChange[]): string {
  const gradeMoved = changes.filter((c) => c.before.grade !== c.after.grade);
  const scoreMoved = changes.filter((c) => c.before.score !== c.after.score);
  const affected = changes.filter((c) => c.cookies.length);
  const allCookies = changes.flatMap((c) => c.cookies);
  const lines = [
    'WHAT-IF, NOT APPLIED: an unrecognized SameSite=None cookie counts as "unknown" instead of "tracking".',
    'Baseline is the regraded cards (new known-cookie list and trackers). Nothing here was written to data/sites.',
    '',
    `Cards carrying at least one such cookie today: ${affected.length}. Cookies involved: ${allCookies.length}.`,
    `Grade would change: ${gradeMoved.length}. Score would change: ${scoreMoved.length}.`,
    '',
    'Grades, today → what-if (every card):',
    ...transitions(changes),
    '',
    'Every card whose score would change:',
  ];
  for (const c of scoreMoved) {
    lines.push('', `${c.domain}  ${gradeLabel(c.before)} → ${gradeLabel(c.after)}`, `  cookies that would stop counting: ${c.cookies.map((k) => k.cookieName).join(', ')}`);
  }
  lines.push(
    '',
    `Decision for the owner: keep publishing an unrecognized SameSite=None cookie as a "tracking cookie before consent" (today, ${allCookies.length} cookies on ${affected.length} cards), or count it as "unknown" (${gradeMoved.length} cards change grade, ${scoreMoved.length} change score)?`,
  );
  return lines.join('\n') + '\n';
}

// --- main ------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const reportPath = opt('report');
  const whatIfPath = opt('whatif-samesite');
  const dir = path.resolve(__dirname, '..', 'data', 'sites');

  const changes: CardChange[] = [];
  const whatIf: CardChange[] = [];
  const historyCards = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.json')).sort()) {
    const file = path.join(dir, f);
    const raw = fs.readFileSync(file, 'utf8');
    const { card, change } = regradeCard(JSON.parse(raw) as StoredCard);
    changes.push(change);
    if (card.history?.length) historyCards.add(card.domain);
    const out = JSON.stringify(card, null, 2) + '\n';
    if (out !== raw && !dryRun) fs.writeFileSync(file, out);
    if (whatIfPath) whatIf.push(regradeCard(card, { sameSiteNoneAsUnknown: true }).change);
  }

  const report = churnReport(changes, historyCards);
  if (reportPath) fs.writeFileSync(reportPath, report);
  else process.stdout.write(report);
  if (whatIfPath) fs.writeFileSync(whatIfPath, whatIfReport(whatIf));
  console.error(`${dryRun ? '[dry run] would rewrite' : 'rewrote'} ${changes.filter((c) => c.changed).length} of ${changes.length} cards`);
}

// Only when run as a script: tests import the functions above.
if (/regrade-sites\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) main();
