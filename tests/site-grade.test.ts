/**
 * lib/site-grade — the Report Card rubric must be transparent, monotonic,
 * and stable (same input → same grade) because the grades are published
 * and meant to be argued with.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { gradeSite } from '../lib/site-grade';
import { categorize } from '../lib/site-categories';
import { regradeCard, REGRADED_AT, setCookieLine, type StoredCard } from '../scripts/regrade-sites';

const clean = { cookies: [], trackers: [], inlineTrackers: [], thirdPartyDomains: [], security: { isHTTPS: true, hasCSP: true, hasPermPolicy: true, hasHSTS: true } };

describe('gradeSite', () => {
  it('a clean, well-configured site is an A with no deductions', () => {
    const g = gradeSite(clean);
    expect(g.score).toBe(100);
    expect(g.grade).toBe('A');
    expect(g.deductions).toEqual([]);
    expect(g.headline).toMatch(/Grade A/);
  });

  it('missing security headers cost a little, not HTTPS costs a lot', () => {
    expect(gradeSite({ ...clean, security: { isHTTPS: true, hasCSP: false, hasPermPolicy: false, hasHSTS: false } }).score).toBe(93);
    expect(gradeSite({ ...clean, security: { isHTTPS: false, hasCSP: true, hasPermPolicy: true, hasHSTS: true } }).score).toBe(75);
  });

  it('tracking cookies before consent are the heaviest per-item deduction, and capped', () => {
    const one = gradeSite({ ...clean, cookies: [{ category: 'tracking', risk: 'high' }] });
    expect(one.score).toBe(92);
    const many = gradeSite({ ...clean, cookies: Array(10).fill({ category: 'tracking', risk: 'high' }) });
    expect(many.score).toBe(68); // capped at −32
  });

  it('ad trackers, analytics, inline pixels and third parties all deduct with caps', () => {
    const g = gradeSite({
      ...clean,
      trackers: [
        { category: 'tracking', risk: 'high', name: 'Facebook Pixel' },
        { category: 'tracking', risk: 'high', name: 'Criteo' },
        { category: 'analytics', risk: 'medium', name: 'Hotjar' },
      ],
      inlineTrackers: ['Facebook Pixel (inline)'],
      thirdPartyDomains: Array.from({ length: 12 }, (_, i) => `cdn${i}.example`),
    });
    // 100 − 12 (2 ad) − 3 (1 analytics) − 3 (1 inline) − 7 (12−5 third parties) = 75 → C (B needs ≥78)
    expect(g.score).toBe(75);
    expect(g.grade).toBe('C');
    expect(g.deductions.map((d) => d.reason)).toEqual([
      'Advertising / marketing trackers loaded',
      'Analytics trackers loaded',
      'Inline tracking pixels',
      'Third-party script domains beyond a reasonable five',
    ]);
  });

  it('is monotonic: adding a tracker never raises the score', () => {
    const base = gradeSite({ ...clean, trackers: [{ category: 'tracking', risk: 'high' }] });
    const more = gradeSite({ ...clean, trackers: [{ category: 'tracking', risk: 'high' }, { category: 'tracking', risk: 'high' }] });
    expect(more.score).toBeLessThanOrEqual(base.score);
  });

  it('floors at 0 and grades F for an aggressive site', () => {
    const g = gradeSite({
      cookies: Array(10).fill({ category: 'tracking', risk: 'high' }),
      trackers: Array(10).fill({ category: 'tracking', risk: 'high', name: 'x' }),
      inlineTrackers: ['a', 'b', 'c', 'd'],
      thirdPartyDomains: Array.from({ length: 40 }, (_, i) => `t${i}.example`),
      security: { isHTTPS: false, hasCSP: false, hasPermPolicy: false, hasHSTS: false },
    });
    expect(g.score).toBe(0);
    expect(g.grade).toBe('F');
  });

  it('is deterministic', () => {
    const input = { ...clean, trackers: [{ category: 'analytics', risk: 'medium', name: 'GA' }] };
    expect(gradeSite(input)).toEqual(gradeSite(input));
  });

  it('the headline counts in the singular for one of anything', () => {
    // 103 published cards read "1 third-party domains" (funnel pilot check, 2026-09-10).
    expect(gradeSite({ ...clean, thirdPartyDomains: ['cdn.example'] }).headline).toBe('Grade A: 1 third-party domain on the homepage.');
    expect(gradeSite({ ...clean, thirdPartyDomains: ['a.example', 'b.example'] }).headline).toBe('Grade A: 2 third-party domains on the homepage.');
  });

  it('no stored card headline says "1 third-party domains"', () => {
    const dir = path.join(process.cwd(), 'data', 'sites');
    const bad = fs.readdirSync(dir).filter((f) => /(?<!\d)1 third-party domains\b/.test(fs.readFileSync(path.join(dir, f), 'utf-8')));
    expect(bad).toEqual([]);
  });
});

describe('gradeSite headline — its "none detected" line is only printed when true', () => {
  const NONE = 'no ad or analytics trackers or tracking cookies detected on the homepage.';

  it('a site whose only tracker is functional (firefox.com: Sentry) is not called tracker-free', () => {
    const g = gradeSite({ ...clean, trackers: [{ name: 'Sentry', category: 'functional', risk: 'low' }] });
    expect(g.headline).toBe(`Grade A: ${NONE}`);
    expect(g.headline).not.toMatch(/\bno trackers\b/);
  });

  it('analytics trackers are counted, so Google Analytics with no third-party domain is not "none detected" (starlink.com)', () => {
    const g = gradeSite({ ...clean, trackers: [{ name: 'Google Analytics / GTM', category: 'analytics', risk: 'medium' }] });
    expect(g.headline).toBe('Grade A: 1 analytics tracker on the homepage.');
    expect(gradeSite({ ...clean, trackers: [{ name: 'a', category: 'analytics', risk: 'medium' }, { name: 'b', category: 'analytics', risk: 'low' }] }).headline).toBe('Grade A: 2 analytics trackers on the homepage.');
  });

  it('an inline pixel counts when its tag is not already a tracker, and not twice when it is', () => {
    expect(gradeSite({ ...clean, inlineTrackers: ['Google gtag (inline)'] }).headline).toBe('Grade A: 1 tracking pixel on the homepage.');
    const both = gradeSite({ ...clean, trackers: [{ name: 'Google Analytics / GTM', category: 'analytics', risk: 'medium' }], inlineTrackers: ['Google gtag (inline)'] });
    expect(both.headline).toBe('Grade A: 1 analytics tracker on the homepage.');
    // A label with no known tag always counts, as on the report card page.
    expect(gradeSite({ ...clean, trackers: [{ category: 'analytics', risk: 'medium' }], inlineTrackers: ['Something (inline)'] }).headline).toBe('Grade A: 1 analytics tracker, 1 tracking pixel on the homepage.');
  });

  it('lists every kind of finding that costs points, in rubric order', () => {
    const g = gradeSite({
      ...clean,
      cookies: [{ category: 'tracking', risk: 'high' }, { category: 'functional', risk: 'low' }],
      trackers: [
        { name: 'Criteo', category: 'tracking', risk: 'high' },
        { name: 'Hotjar', category: 'analytics', risk: 'medium' },
        { name: 'Sentry', category: 'functional', risk: 'low' },
      ],
      inlineTrackers: ['Facebook Pixel (inline)'],
      thirdPartyDomains: ['a.example', 'b.example'],
    });
    expect(g.headline).toBe(`Grade ${g.grade}: 1 tracking cookie before consent, 1 ad tracker, 1 analytics tracker, 1 tracking pixel, 2 third-party domains on the homepage.`);
  });

  it('no stored card claims "no trackers", and a stored "none detected" line always matches its own findings', () => {
    for (const s of storedCards()) {
      expect(s.grade.headline, s.domain).not.toMatch(/\bno trackers\b/);
      if (s.grade.headline.endsWith(NONE)) {
        const counted = s.scan.trackers.filter((t) => t.category !== 'functional' || t.risk === 'high');
        expect(counted, s.domain).toEqual([]);
        expect(s.scan.cookies.filter((c) => c.category === 'tracking'), s.domain).toEqual([]);
        expect(s.scan.inlineTrackers, s.domain).toEqual([]);
        expect(s.scan.thirdPartyDomains, s.domain).toEqual([]);
      }
    }
  });
});

function storedCards(): StoredCard[] {
  const dir = path.join(process.cwd(), 'data', 'sites');
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as StoredCard);
}

/** cnbc.com's card as the 2026-09-08 scan stored it, trimmed, with comScore's beacon in its script domains. */
function oldCard(): StoredCard {
  const cookie = (cookieName: string, sameSite: string, category: string, name: string, risk: string, description: string, expires: string | null) => ({
    cookieName, name, category, risk, description, secure: sameSite === 'None', httpOnly: false, sameSite, domain: 'www.cnbc.com', path: '/', maxAge: null, expires,
  });
  return {
    domain: 'cnbc.test',
    finalUrl: 'https://www.cnbc.test/',
    title: 'CNBC',
    scannedAt: '2026-09-08T02:34:10.697Z',
    grade: {
      score: 80,
      grade: 'B',
      deductions: [
        { reason: 'Tracking cookies set before any consent', points: 16, detail: '2 tracking cookies' },
        { reason: 'No HSTS (Strict-Transport-Security)', points: 3 },
        { reason: 'No Permissions-Policy', points: 1 },
      ],
      headline: 'Grade B: 2 tracking cookies before consent, 3 third-party domains on the homepage.',
    },
    scan: {
      status: 200,
      cookies: [
        cookie('AWSALB', 'not set', 'unknown', 'Unknown', 'low', 'Purpose unknown — could be functional or tracking', 'Tue, 15 Sep 2026 02:34:23 GMT'),
        cookie('AWSALBCORS', 'None', 'tracking', 'Third-Party Cookie', 'high', 'SameSite=None allows cross-site tracking', 'Tue, 15 Sep 2026 02:34:23 GMT'),
        cookie('region', 'not set', 'unknown', 'Unknown', 'low', 'Purpose unknown — could be functional or tracking', 'Mon, 07-Dec-2026 02:34:23 GMT'),
        cookie('akaas_CNBC_AudienceSegmentation', 'None', 'tracking', 'Third-Party Cookie', 'high', 'SameSite=None allows cross-site tracking', 'Thu, 08 Oct 2026 02:34:23 GMT'),
        cookie('mystery', 'None', 'tracking', 'Third-Party Cookie', 'high', 'SameSite=None allows cross-site tracking', null),
      ],
      trackers: [{ name: 'reCAPTCHA', category: 'functional', risk: 'medium', description: 'Google reCAPTCHA — bot protection that also sends data to Google' }],
      inlineTrackers: [],
      thirdPartyDomains: ['assets.adobedtm.com', 'image.cnbcfm.com', 'sb.scorecardresearch.com'],
      security: { isHTTPS: true, hasCSP: true, hasPermPolicy: false, hasHSTS: false },
      summary: { totalCookies: 5, trackingCookies: 3, analyticsCookies: 0, functionalCookies: 0, totalTrackers: 1, thirdPartyScripts: 3, highRiskItems: 3 },
    },
    history: [],
    editorial: { status: 'published' },
    author: null,
  };
}

describe('scripts/regrade-sites — re-grading a stored card without rescanning', () => {
  it('rebuilds a Set-Cookie line from what a card stores, without the value it never stores', () => {
    const c = oldCard().scan.cookies[1];
    expect(setCookieLine(c)).toBe('AWSALBCORS=x; Expires=Tue, 15 Sep 2026 02:34:23 GMT; Secure; SameSite=None');
    expect(setCookieLine({ ...c, sameSite: 'not set', secure: false, httpOnly: true, expires: null, maxAge: '120' })).toBe('AWSALBCORS=x; Max-Age=120; HttpOnly');
  });

  it('re-classifies cookies, adds trackers found on stored script domains, and recomputes summary, grade and headline', () => {
    const before = oldCard();
    const { card, change } = regradeCard(before);
    expect(card.scan.cookies.map((c) => [c.cookieName, c.category, c.name])).toEqual([
      ['AWSALB', 'functional', 'AWS Load Balancer'],
      ['AWSALBCORS', 'functional', 'AWS Load Balancer'],
      ['region', 'unknown', 'Unknown'],
      ['akaas_CNBC_AudienceSegmentation', 'functional', 'Akamai'],
      ['mystery', 'tracking', 'Third-Party Cookie'], // unrecognized SameSite=None: unchanged rule
    ]);
    // Stored trackers kept, new ones merged in TRACKER_PATTERNS order.
    expect(card.scan.trackers.map((t) => t.name)).toEqual(['comScore', 'Adobe Experience Platform Tags', 'reCAPTCHA']);
    expect(card.scan.summary).toEqual({ totalCookies: 5, trackingCookies: 1, analyticsCookies: 0, functionalCookies: 3, totalTrackers: 3, thirdPartyScripts: 3, highRiskItems: 1 });
    expect(card.grade).toEqual(gradeSite(card.scan));
    expect(card.grade.headline).toBe('Grade B: 1 tracking cookie before consent, 2 analytics trackers, 3 third-party domains on the homepage.');
    expect(change.cookies.map((k) => `${k.cookieName}:${k.from}>${k.to}`)).toEqual(['AWSALB:unknown>functional', 'AWSALBCORS:tracking>functional', 'akaas_CNBC_AudienceSegmentation:tracking>functional']);
    expect(change.addedTrackers.map((t) => t.name)).toEqual(['comScore', 'Adobe Experience Platform Tags']);
    expect(change.before).toEqual({ grade: 'B', score: 80, headline: before.grade.headline });
    expect(change.after).toEqual({ grade: card.grade.grade, score: card.grade.score, headline: card.grade.headline });
    expect(change.changed).toBe(true);
  });

  it('keeps every key in its place, leaves scannedAt, history and the input alone, and is idempotent', () => {
    const before = oldCard();
    const snapshot = JSON.stringify(before);
    const { card } = regradeCard(before);
    expect(JSON.stringify(before)).toBe(snapshot);
    expect(Object.keys(card)).toEqual(Object.keys(before));
    expect(Object.keys(card.scan)).toEqual(Object.keys(before.scan));
    expect(Object.keys(card.scan.summary)).toEqual(Object.keys(before.scan.summary));
    expect(Object.keys(card.grade)).toEqual(Object.keys(before.grade));
    card.scan.cookies.forEach((c, i) => expect(Object.keys(c)).toEqual(Object.keys(before.scan.cookies[i])));
    expect(card.scannedAt).toBe(before.scannedAt);
    expect(card.history).toEqual(before.history);
    const again = regradeCard(card);
    expect(again.change.changed).toBe(false);
    expect(JSON.stringify(again.card)).toBe(JSON.stringify(card));
  });

  it('counts a cookie the response set several times once, as analyzeScan now does', () => {
    // lowes.com set EPID eight times and its card read "8 tracking cookies
    // before consent". Same rule as lib/scanner's dedupeCookies: name +
    // domain + path, the last one kept, at the first one's position.
    const before = oldCard();
    const epid = (expires: string) => ({ ...before.scan.cookies[4], cookieName: 'EPID', expires });
    before.scan.cookies = [epid('Fri, 05-Sep-2036 13:41:19 GMT'), before.scan.cookies[2], ...Array.from({ length: 7 }, () => epid('Tue, 27-Oct-2037 05:41:19 GMT'))];
    const { card, change } = regradeCard(before);
    expect(change.droppedDuplicates).toBe(7);
    expect(card.scan.cookies.map((c) => c.cookieName)).toEqual(['EPID', 'region']);
    expect(card.scan.cookies[0].expires).toBe('Tue, 27-Oct-2037 05:41:19 GMT');
    expect(card.scan.summary.totalCookies).toBe(2);
    expect(card.scan.summary.trackingCookies).toBe(1);
    expect(card.grade.headline).toContain('1 tracking cookie before consent');
  });

  it('leaves a card whose cookies are all distinct alone', () => {
    expect(regradeCard(oldCard()).change.droppedDuplicates).toBe(0);
  });

  it('stamps editorial.updatedAt on a card it rewrites, right after reviewedAt, and never touches reviewedAt', () => {
    // A re-graded card was last changed the day the rules changed, not the day
    // it was scanned; "Homepage scanned <date>" still reads scannedAt.
    const before = oldCard();
    before.editorial = { status: 'published', reviewedAt: '2026-09-08T02:34:10.697Z', reviewedBy: 'David Shadrake' };
    const { card, change } = regradeCard(before);
    expect(change.changed).toBe(true);
    const editorial = card.editorial as Record<string, string>;
    expect(Object.keys(editorial)).toEqual(['status', 'reviewedAt', 'updatedAt', 'reviewedBy']);
    expect(editorial.updatedAt).toBe(REGRADED_AT);
    expect(editorial.reviewedAt).toBe('2026-09-08T02:34:10.697Z');
    expect(card.scannedAt).toBe(before.scannedAt);
  });

  it('does not stamp a card it does not rewrite: the stamp never makes a card look changed', () => {
    const { card } = regradeCard(oldCard());
    const again = regradeCard(card);
    expect(again.change.changed).toBe(false);
    expect(JSON.stringify(again.card)).toBe(JSON.stringify(card));
    // A card that was already current before any stamp existed stays unstamped.
    const current = JSON.parse(JSON.stringify(card)) as StoredCard;
    delete (current.editorial as Record<string, unknown>).updatedAt;
    expect((regradeCard(current).card.editorial as Record<string, unknown>).updatedAt).toBeUndefined();
  });

  it('every stored card that differs from its last review carries the 2026-09-11 stamp', () => {
    const unstamped = storedCards()
      .filter((s) => regradeCard(s).change.changed)
      .map((s) => s.domain);
    expect(unstamped).toEqual([]);
    const stamps = new Set(storedCards().map((s) => (s.editorial as { updatedAt?: string } | undefined)?.updatedAt).filter(Boolean));
    expect([...stamps]).toEqual([REGRADED_AT]);
  });

  it('the SameSite what-if only reclassifies cookies the SameSite=None guess called tracking', () => {
    const { card } = regradeCard(oldCard());
    const whatIf = regradeCard(card, { sameSiteNoneAsUnknown: true });
    expect(whatIf.change.cookies).toEqual([{ cookieName: 'mystery', from: 'tracking', to: 'unknown', as: 'Unknown' }]);
    expect(whatIf.card.scan.summary.trackingCookies).toBe(0);
    expect(whatIf.change.after.score).toBe(card.grade.score + 8);
  });

  it('every stored card is already regraded: its cookies, trackers, summary and grade follow the current rules', () => {
    // Fails after a change to lib/scanner's cookie or tracker rules or to the
    // rubric until `npx tsx scripts/regrade-sites.ts` is run.
    const stale = storedCards().filter((s) => regradeCard(s).change.changed).map((s) => s.domain);
    expect(stale).toEqual([]);
  });
});

describe('categorize', () => {
  it('files a site by what it is, not a word inside its name', () => {
    // "love" in ilovepdf.com filed a PDF tool under Dating.
    expect(categorize('ilovepdf.com').category).toBe('tech');
    expect(categorize('www.ilovepdf.com').category).toBe('tech');
    expect(categorize('windowsupdate.com').category).not.toBe('dating');
    expect(categorize('tinder.com').category).toBe('dating');
    expect(categorize('elitesingles.com').category).toBe('dating');
  });
});
