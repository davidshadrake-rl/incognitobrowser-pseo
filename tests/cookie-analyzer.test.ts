/**
 * Cookie & Tracker Scanner: one severity rule (funnel pilot, 2026-09-11).
 *
 * The result bus used its own rule (any tracking cookie = red, any analytics
 * cookie = amber) while the console graded with the score. One
 * SameSite=None cookie scored 85, "A · Excellent", on a green console, while
 * the result CTA under it showed the red line. Now every view (URL scan,
 * pasted cookies, this page's cookies) builds one report with
 * cookiePrivacyScore -> severityFromScore, and the console and the bus both
 * read it. Pure functions, plus a source check that no ad-hoc rule is left.
 *
 * 2026-09-11, second pass: the letter bands moved to the same cuts as the
 * colour (A/B green, C amber, D/F red), and cookie names now come from
 * lib/scanner's one list, so a pasted list of pure advertising cookies can no
 * longer score 100/100 with "0 tracking".
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  categorizeCookie,
  cookieListReport,
  cookiePrivacyScore,
  gradeFromScore,
  parseCookieList,
  urlScanReport,
  type CookieInfo,
  type URLScanResult,
} from '../components/tools/CookieAnalyzerTool';
import { categorizeCookie as scannerCategorize } from '../lib/scanner';
import { severityFromGrade, severityFromScore, type Severity } from '../components/tools/ResultContext';
import { scorecardFigure } from '../lib/scorecard';
import { composeCta, ENGINE_COPY } from '../lib/cta-copy';

const SECURE = { isHTTPS: true, hasCSP: true, hasPermPolicy: true, hasHSTS: true };

function scan(over: Partial<URLScanResult['summary']> = {}, security = SECURE, url = 'https://example.com/'): Pick<URLScanResult, 'url' | 'summary' | 'security'> {
  return {
    url,
    security,
    summary: { totalCookies: 0, trackingCookies: 0, analyticsCookies: 0, functionalCookies: 0, totalTrackers: 0, thirdPartyScripts: 0, highRiskItems: 0, ...over },
  };
}

describe('one severity rule: the score, through severityFromScore', () => {
  it('the pilot case: one high-risk tracking cookie scores 85, and the result bus is green like the console', () => {
    // The pilot's cookie was an unrecognised SameSite=None cookie, which the scanner filed as tracking / high risk.
    const r = urlScanReport(scan({ totalCookies: 1, trackingCookies: 1, highRiskItems: 1 }));
    expect(r.score).toBe(85);
    // Not "A · Excellent": the letter bands were moved to the severity bands
    // on 2026-09-11, so a scan carrying a high-risk tracking cookie cannot be
    // called excellent.
    expect(r.grade).toEqual({ letter: 'B', label: 'Good' });
    expect(r.severity).toBe('green');
    expect(r.result.severity).toBe(severityFromScore(r.score));
    expect(r.result).toMatchObject({ score: 85, grade: 'B' });
  });

  it('the letter and the colour are cut at the same scores: no green C, no amber B', () => {
    // 79 rendered "B · Good" on an amber Warning and 84 rendered the same
    // letter on green, because the letters were cut at 85/70/50/30.
    const byLetter: Record<string, Severity[]> = {};
    for (let score = 0; score <= 100; score++) {
      (byLetter[gradeFromScore(score).letter] ||= []).push(severityFromScore(score));
    }
    for (const [letter, severities] of Object.entries(byLetter)) {
      expect(new Set(severities).size, `${letter} spans ${[...new Set(severities)].join('/')}`).toBe(1);
      expect(severityFromGrade(letter), letter).toBe(severities[0]);
    }
    expect(gradeFromScore(90).letter).toBe('A');
    expect(gradeFromScore(89).letter).toBe('B');
    expect(gradeFromScore(80).letter).toBe('B');
    expect(gradeFromScore(79).letter).toBe('C');
  });

  it('the bus follows the score in every band, never its own count rule', () => {
    const cases: Array<[Partial<URLScanResult['summary']>, typeof SECURE, number]> = [
      [{}, SECURE, 100],
      [{ totalCookies: 2, trackingCookies: 2, highRiskItems: 2 }, SECURE, 70],
      [{ totalTrackers: 3, highRiskItems: 3 }, SECURE, 55],
      [{ totalCookies: 4, trackingCookies: 4, highRiskItems: 4 }, SECURE, 40],
      // No tracking at all, but no HTTPS, CSP or HSTS: the old rule said green.
      [{}, { isHTTPS: false, hasCSP: false, hasPermPolicy: false, hasHSTS: false }, 70],
    ];
    for (const [summary, security, score] of cases) {
      const r = urlScanReport(scan(summary, security));
      expect(r.score, JSON.stringify(summary)).toBe(score);
      expect(r.severity).toBe(severityFromScore(score));
      expect(r.result.severity).toBe(r.severity);
    }
  });

  it('pasted cookies are scored on the same rule, from the cookie points alone', () => {
    const one = cookieListReport(parseCookieList('_fbp=fb.1.123'), 'paste');
    expect(one.score).toBe(cookiePrivacyScore({ highRiskItems: 1, trackingCookies: 1, analyticsCookies: 0, totalTrackers: 0, thirdPartyScripts: 0 }));
    expect(one.score).toBe(85);
    expect(one.severity).toBe('green');
    expect(one.result.severity).toBe('green');

    const four = cookieListReport(parseCookieList('_fbp=1; _fbc=2; fr=3; IDE=4'), 'paste');
    expect(four.score).toBe(40);
    expect(four.result.severity).toBe('red');

    const analytics = cookieListReport(parseCookieList('_ga=1\n_gid=2'), 'paste');
    expect(analytics.score).toBe(94);
    expect(analytics.result.severity).toBe('green');
  });

  it('the list headline and the URL headline carry the score and count in the singular', () => {
    expect(urlScanReport(scan({ totalCookies: 1, trackingCookies: 1, highRiskItems: 1, totalTrackers: 1 })).result.headline)
      .toBe('example.com scores 80/100: 1 tracking cookie and 1 tracker before you click anything');
    // Plain HTTP can't send HSTS either: 100 - 20 - 5.
    expect(urlScanReport(scan({}, { ...SECURE, isHTTPS: false, hasHSTS: false }, 'http://plain.example/')).result.headline)
      .toBe('plain.example scores 75/100: no tracking cookies or trackers before you click anything, and no HTTPS');
    expect(cookieListReport(parseCookieList('_fbp=1; session=2'), 'paste').result.headline)
      .toBe('The pasted cookies score 85/100: 2 cookies, 1 tracking and 0 analytics');
    expect(cookieListReport([], 'browser').result.headline).toBe('This page has no cookies its scripts can read');
    expect(cookieListReport([], 'paste').result.headline).toBe('No cookies found in the pasted text');
  });

  it('the scorecard figure still names the tracking-cookie count, in both modes', () => {
    expect(scorecardFigure('cookie-analyzer', urlScanReport(scan({ totalCookies: 1, trackingCookies: 1, highRiskItems: 1 })).result)).toBe('1 tracking cookie');
    expect(scorecardFigure('cookie-analyzer', cookieListReport(parseCookieList('_fbp=1; _fbc=2'), 'paste').result)).toBe('2 tracking cookies');
  });

  it('the console and the bus read the same report object: no ad-hoc colour rule is left in the tool', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'tools', 'CookieAnalyzerTool.tsx'), 'utf-8');
    // Every console status comes from a report's severity.
    const statuses = [...src.matchAll(/statusFromSeverity\(([^)]*)\)/g)].map((m) => m[1]);
    expect(statuses).toEqual(['urlReport.severity', 'listReport.severity']);
    // Every report() call passes a built report's result (or null).
    const reports = [...src.matchAll(/\breport\(([^;]*)\);/g)].map((m) => m[1]);
    expect(reports).toEqual(['current ? current.result : null']);
    // The old count rules are gone.
    expect(src).not.toMatch(/tracking(?:Cookies|\.length)? > 0 \? 'red'/);
    expect(src).not.toMatch(/severity: [a-z.]+ > 0 \?/i);
  });
});

describe('the result CTA reads right for any result of its colour', () => {
  it('green never calls a site clean: a green result can hold a tracking cookie', () => {
    const green = ENGINE_COPY['cookie-analyzer'].green;
    expect(`${green.headline} ${green.body}`).not.toMatch(/\bclean\b/i);
  });

  it('red and amber make no claim a pasted list or an HTTP-only site would contradict', () => {
    const { red, amber } = ENGINE_COPY['cookie-analyzer'];
    // A pasted list may have been set after consent; an amber can come from a missing HTTPS alone.
    expect(red.headline).not.toMatch(/before you (agree|click)/i);
    expect(amber.headline).not.toMatch(/tracking gets through/i);
    for (const s of ['red', 'amber', 'green'] as const) {
      const cta = composeCta('cookie-analyzer', 'ad-tracking', s);
      expect(cta.body).not.toMatch(/requests like these/);
    }
  });
});

/**
 * The tool kept its own 26-name table until 2026-09-11 and held none of the
 * advertising names, so a paste of nothing but ad cookies was graded a perfect
 * green. Names now come from lib/scanner's one list, which the report cards
 * use too, so all three modes call a cookie the same thing.
 */
describe('advertising cookies cannot score a perfect green', () => {
  const AD_PASTE = '__gads=1; __gpi=2; __eoi=3; _gcl_aw=4; _gcl_dc=5; cto_bundle=6; _pubcid=7; AMCV_X%40AdobeOrg=8';

  it('the verifier\'s paste: 8 advertising cookies are 8 tracking cookies, not "0 tracking" at 100/100', () => {
    const r = cookieListReport(parseCookieList(AD_PASTE), 'paste');
    expect(parseCookieList(AD_PASTE).map((c) => c.category)).toEqual(Array(8).fill('tracking'));
    expect(r.score).toBe(0);
    expect(r.severity).toBe('red');
    expect(r.grade.letter).toBe('F');
    expect(r.result.headline).toBe('The pasted cookies score 0/100: 8 cookies, 8 tracking and 0 analytics');
    expect(r.result.headline).not.toMatch(/0 tracking/);
    expect(r.result.stats).toContainEqual({ label: 'Tracking', value: '8' });
  });

  it('each ad and identity family is named, whichever mode reads it', () => {
    const cases: Array<[string, CookieInfo['category']]> = [
      ['__gads', 'tracking'], ['__gpi', 'tracking'], ['__eoi', 'tracking'],
      ['_gcl_au', 'tracking'], ['_gcl_aw', 'tracking'], ['_gcl_dc', 'tracking'], ['_gac_UA-1-2', 'tracking'],
      ['__adroll_fpc', 'tracking'], ['__ar_v4', 'tracking'], ['cto_bundle', 'tracking'], ['cto_bidid', 'tracking'],
      ['_pubcid', 'tracking'], ['_sharedid', 'tracking'], ['_pcid', 'analytics'],
      ['AMCV_ABC%40AdobeOrg', 'tracking'], ['kndctr_ABC_AdobeOrg_identity', 'tracking'],
      ['_ttp', 'tracking'], ['_scid', 'tracking'], ['_sctr', 'tracking'],
      ['_uetsid', 'tracking'], ['_uetvid', 'tracking'], ['IDE', 'tracking'], ['DSID', 'tracking'], ['test_cookie', 'tracking'],
      ['_rdt_uuid', 'tracking'], ['li_sugr', 'tracking'], ['UserMatchHistory', 'tracking'],
      ['bcookie', 'tracking'], ['bscookie', 'tracking'], ['personalization_id', 'tracking'], ['_pin_unauth', 'tracking'],
      ['ajs_anonymous_id', 'analytics'], ['_hjSessionUser_123', 'analytics'], ['_ga_ABC123', 'analytics'],
    ];
    for (const [name, category] of cases) {
      const c = categorizeCookie(name, 'v');
      expect(c.category, name).toBe(category);
      expect(c.description, name).not.toMatch(/based on naming|could be functional or tracking/);
    }
  });

  it('the same name gets the same verdict here and in the report-card scanner', () => {
    for (const name of ['__gads', 'cto_bundle', '_pubcid', 'AMCV_X%40AdobeOrg', '_ga', '_cfuvid', 'AWSALBCORS', 'PHPSESSID']) {
      const tool = categorizeCookie(name, 'v');
      const card = scannerCategorize(`${name}=v; Path=/`);
      expect(tool.category, name).toBe(card.category);
      expect(tool.risk, name).toBe(card.risk);
      expect(tool.description, name).toBe(card.description);
    }
  });

  it('functional cookies are still functional: the fix does not turn hosting into advertising', () => {
    for (const name of ['__cf_bm', 'AWSALB', 'ak_bmsc', '_pxhd', 'JSESSIONID', 'csrf_token', 'XSRF-TOKEN', 'sessionid']) {
      expect(categorizeCookie(name, 'v').category, name).toBe('functional');
    }
    expect(cookieListReport(parseCookieList('__cf_bm=1; AWSALB=2; JSESSIONID=3'), 'paste').score).toBe(100);
  });
});

describe('cookie names', () => {
  it('"ad" and "stat" count only as whole name parts', () => {
    for (const name of ['admin_session', 'header_pref', 'download_token', 'status', 'loaded']) {
      expect(categorizeCookie(name, '').category, name).not.toBe('tracking');
    }
    expect(categorizeCookie('status', '').category).not.toBe('analytics');
    expect(categorizeCookie('ad_id', '').category).toBe('tracking');
    expect(categorizeCookie('_ads', '').category).toBe('tracking');
    expect(categorizeCookie('site-stats', '').category).toBe('analytics');
  });

  it('blank pieces of a pasted list are not cookies, and prototype names are not known cookies', () => {
    expect(parseCookieList('a=1;;  ;b=2\n\n').map((c) => c.name)).toEqual(['a', 'b']);
    expect(categorizeCookie('constructor', '').category).toBe('unknown');
  });
});
