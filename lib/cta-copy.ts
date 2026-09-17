/**
 * What is left of the old result box's copy (ResultCta, removed 2026-09-16,
 * when the ask moved into the result card). The card's words, and the rules
 * for what may be claimed for Incognito Pro, are lib/card-copy.ts.
 *
 *   reportCardLine      a report card's line, picked from its scan
 *   PRO_HANDOFF_TITLE   the Pro tool page a free tool's result links to
 *   IN_APP_COPY.button  the upgrade button inside the app
 */
import type { Severity } from '@/components/tools/ResultContext';
import { GRADE_LABEL, type Grade } from '@/lib/site-grade';

/** A report card's line by colour, when the scan doesn't decide the wording. */
const REPORT_CARD_LINE: Record<Severity, string> = {
  red: 'This site tracks you before you click anything.',
  amber: 'This site tracks more than it needs to.',
  green: 'A clean site, which most are not.',
  info: 'Take this protection with you.',
};

/**
 * The report-card line, picked from the scan instead of the letter. Every A
 * and B used to get "A clean site. Most are not." — including 133 cards
 * listing ad trackers or tracking cookies right above it (CTO review
 * 2026-09-10). "Clean" now needs no tracking cookies and no trackers of any
 * kind (the count the page lists under "Trackers loaded on the homepage"),
 * so it can never contradict that list; otherwise the line says what loads.
 * One sentence: it is the result card's meaning (lib/card-copy.ts reportCardCopy).
 */
export function reportCardLine(grade: Grade, severity: Severity, found: { trackingCookies: number; trackers: number; pixels?: number }): { headline: string } {
  if (severity !== 'green') return { headline: REPORT_CARD_LINE[severity] };
  const { trackingCookies, trackers, pixels = 0 } = found;
  if (!trackingCookies && !trackers && !pixels) return { headline: REPORT_CARD_LINE.green };
  const count = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '');
  const parts = [count(trackers, 'tracker', 'trackers'), count(pixels, 'tracking pixel', 'tracking pixels'), count(trackingCookies, 'tracking cookie', 'tracking cookies')].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return { headline: `${GRADE_LABEL[grade]}, but still ${list} before you click anything.` };
}

/**
 * The Pro tool pages a free tool's result links to, by path on the Pro site,
 * with the page's own title. The link used to read "Pro version of this
 * check" and opened a different tool on 3 of the 4 pages that showed it, so
 * it now names where it goes. Titles match data/tools/<niche>/<slug>.json
 * (tests/proof-route.test.ts checks it); a link with no entry here is not shown.
 */
export const PRO_HANDOFF_TITLE: Record<string, string> = {
  '/tools/ad-tracking/cookie-tracker-scanner': 'Cookie & Tracker Scanner',
  '/tools/vpn-privacy/browser-leak-test': 'Browser Leak Test',
};

export function proHandoffTitle(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    // Suffix match: NEXT_PUBLIC_PRO_URL may one day carry a path prefix.
    const p = new URL(url).pathname.replace(/\/$/, '');
    const key = Object.keys(PRO_HANDOFF_TITLE).find((k) => p === k || p.endsWith(k));
    return key ? PRO_HANDOFF_TITLE[key] : undefined;
  } catch {
    return undefined;
  }
}

/** The upgrade button for a visitor who is already inside the free Incognito Browser app. */
export const IN_APP_COPY = {
  button: 'Upgrade to Pro',
};
