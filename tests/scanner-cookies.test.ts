/**
 * lib/scanner categorizeCookie — which cookies a report card may publish as
 * "tracking cookies before consent".
 *
 * Funnel pilot, 2026-09-11: any SameSite=None cookie, and any name containing
 * uid/visitor/track, was filed as tracking, so load-balancer, CDN and
 * bot-protection cookies were published as tracking (AWSALBCORS on cnbc.com,
 * Cloudflare's _cfuvid, the only "tracking cookie" on mediatek.com). Those are
 * now known by name and looked up before any heuristic. The SameSite=None
 * heuristic itself is unchanged until the owner decides (see the what-if in
 * scripts/regrade-sites.ts).
 */
import { describe, expect, it } from 'vitest';
import { analyzeScan, categorizeCookie, cookieIdentity, dedupeCookies, KNOWN_COOKIE_PATTERNS, KNOWN_COOKIES, SAMESITE_NONE_GUESS } from '../lib/scanner';

/** A cross-site-capable cookie, the shape that used to be called tracking. */
const crossSite = (name: string) => `${name}=v; Expires=Tue, 15 Sep 2026 02:34:23 GMT; Path=/; Secure; HttpOnly; SameSite=None`;

/** Every infrastructure cookie added 2026-09-11, with what it must be called. */
const INFRA_EXACT: Record<string, string> = {
  AWSALB: 'AWS Load Balancer',
  AWSALBCORS: 'AWS Load Balancer',
  AWSALBTG: 'AWS Load Balancer',
  AWSALBTGCORS: 'AWS Load Balancer',
  AWSELB: 'AWS Load Balancer',
  AWSELBCORS: 'AWS Load Balancer',
  _cfuvid: 'Cloudflare',
  __cfruid: 'Cloudflare',
  __cflb: 'Cloudflare',
  __cf_bm: 'Cloudflare',
  cf_clearance: 'Cloudflare',
  ARRAffinity: 'Azure App Service',
  ARRAffinitySameSite: 'Azure App Service',
  ak_bmsc: 'Akamai Bot Manager',
  _abck: 'Akamai Bot Manager',
  bm_sz: 'Akamai Bot Manager',
  bm_sv: 'Akamai Bot Manager',
  bm_mi: 'Akamai Bot Manager',
  bm_s: 'Akamai Bot Manager',
  bm_so: 'Akamai Bot Manager',
  AKA_A2: 'Akamai',
  datadome: 'DataDome',
  _pxhd: 'HUMAN (PerimeterX)',
  _pxvid: 'HUMAN (PerimeterX)',
  _px2: 'HUMAN (PerimeterX)',
  _px3: 'HUMAN (PerimeterX)',
  JSESSIONID: 'Java Session',
  PHPSESSID: 'PHP Session',
  'ASP.NET_SessionId': 'ASP.NET Session',
};

/** Names with a site, pool or policy id, as the stored cards and vendors spell them. */
const INFRA_PATTERNED: Record<string, string> = {
  BIGipServerpool_www_443: 'F5 BIG-IP',
  'BIGipServer~Common~web-pool': 'F5 BIG-IP',
  TS0121e8f2: 'F5 BIG-IP Advanced WAF', // unesco.org
  TS0150e4de: 'F5 BIG-IP Advanced WAF', // achmea.nl
  TS01c766e6: 'F5 BIG-IP Advanced WAF', // zilverenkruis.nl
  TS7f23b040029: 'F5 BIG-IP Advanced WAF', // unesco.org
  TSddf441ed027: 'F5 BIG-IP Advanced WAF', // achmea.nl
  visid_incap_2377603: 'Imperva', // apa.org
  incap_ses_188_2377603: 'Imperva',
  nlbi_661214: 'Imperva', // elconfidencial.com
  nlbi_661214_2147483392: 'Imperva',
  cf_chl_rc_ni: 'Cloudflare',
  cf_chl_2: 'Cloudflare',
  akaalb_prod_dual: 'Akamai', // lowes.com
  akavpau_WaitingRoomController: 'Akamai', // lenovo.com
  akacd_pr_lgcom_us: 'Akamai', // lg.com
  akaas_CNBC_AudienceSegmentation: 'Akamai', // cnbc.com
  'NSC_MC_dxu-bfn-xfc_XBG-IUUQ': 'Citrix NetScaler', // trendmicro.com
  qrator_ssid2: 'Qrator Labs', // moskva.mts.ru
  __ddg1_: 'DDoS-Guard',
  __ddg10_: 'DDoS-Guard',
  __ddgid_: 'DDoS-Guard',
  __ddgmark_: 'DDoS-Guard',
  ASPSESSIONIDQQGGRRST: 'ASP Session',
  // HUMAN (PerimeterX) is a family, not the four names that were listed by
  // hand: _pxde, _pxcts and _pxff_* were deducted for as "Unknown Tracker".
  _pxde: 'HUMAN (PerimeterX)',
  _pxcts: 'HUMAN (PerimeterX)',
  _pxff_cc: 'HUMAN (PerimeterX)',
};

/**
 * Advertising and cross-site identity cookies, added 2026-09-11. A pasted list
 * of nothing but these scored 100/100 and "0 tracking" in the Cookie & Tracker
 * Scanner, and the report cards published them as the anonymous
 * "Third-Party Cookie" or, without SameSite=None, missed them entirely.
 */
const AD_EXACT: Record<string, string> = {
  __gads: 'Google Ad Manager',
  __gpi: 'Google Ad Manager',
  __eoi: 'Google Ads',
  _gcl_au: 'Google Ads',
  _gcl_aw: 'Google Ads',
  _gcl_dc: 'Google Ads',
  _gcl_gb: 'Google Ads',
  IDE: 'Google DoubleClick',
  DSID: 'Google DoubleClick',
  test_cookie: 'Google DoubleClick',
  _uetsid: 'Microsoft Ads',
  _uetvid: 'Microsoft Ads',
  _uetmsclkid: 'Microsoft Ads',
  ANONCHK: 'Microsoft/Bing',
  SRM_B: 'Microsoft/Bing',
  MUID: 'Microsoft/Bing',
  _fbp: 'Facebook',
  _fbc: 'Facebook',
  fr: 'Facebook',
  _ttp: 'TikTok',
  _tt_enable_cookie: 'TikTok',
  _scid: 'Snapchat',
  _scid_r: 'Snapchat',
  _sctr: 'Snapchat',
  sc_at: 'Snapchat',
  _rdt_uuid: 'Reddit',
  bcookie: 'LinkedIn',
  bscookie: 'LinkedIn',
  li_sugr: 'LinkedIn',
  UserMatchHistory: 'LinkedIn',
  personalization_id: 'X (Twitter)',
  guest_id_ads: 'X (Twitter)',
  guest_id_marketing: 'X (Twitter)',
  _pin_unauth: 'Pinterest',
  _pinterest_ct_ua: 'Pinterest',
  _epik: 'Pinterest',
  cto_bundle: 'Criteo',
  cto_bidid: 'Criteo',
  __ar_v4: 'AdRoll',
  _pubcid: 'PubCommon ID',
  _lc2_fpi: 'LiveIntent',
  __qca: 'Quantcast',
  uuid2: 'Xandr (Microsoft)',
  anj: 'Xandr (Microsoft)',
  TDID: 'The Trade Desk',
  demdex: 'Adobe Audience Manager',
  dextp: 'Adobe Audience Manager',
  everest_cookie: 'Adobe Advertising Cloud', // airbnb.com set this and the card called it "Unknown"
  s_ecid: 'Adobe Experience Cloud',
};

/** Advertising and identity families with an account, container or org id in the name. */
const AD_PATTERNED: Record<string, string> = {
  _gcl_ls: 'Google Ads',
  '_gac_UA-12345-6': 'Google Ads',
  _gac_gb_ABCDEF: 'Google Ads',
  cto_tld_test: 'Criteo',
  __adroll: 'AdRoll',
  __adroll_fpc: 'AdRoll',
  __adroll_shared: 'AdRoll',
  _pubcid_exp: 'PubCommon ID',
  _sharedid: 'SharedID (Prebid)',
  _sharedid_cst: 'SharedID (Prebid)',
  panoramaId: 'Lotame',
  panoramaId_expiry: 'Lotame',
  panoramaIdType: 'Lotame',
  'AMCV_1234567890ABCDEF%40AdobeOrg': 'Adobe Experience Cloud',
  'AMCVS_1234567890ABCDEF%40AdobeOrg': 'Adobe Experience Cloud',
  kndctr_F0935E09512D2C270A490D4D_AdobeOrg_identity: 'Adobe Experience Platform', // nike.com
  kndctr_F0935E09512D2C270A490D4D_AdobeOrg_cluster: 'Adobe Experience Platform',
};

/** Analytics families with a property or site id in the name. */
const ANALYTICS_PATTERNED: Record<string, string> = {
  mp_0123abcd_mixpanel: 'Mixpanel',
  _ga_ABCD1234EF: 'Google Analytics',
  _gat_gtag_UA_12345_6: 'Google Analytics',
  '__utma': 'Google Analytics',
  __utmz: 'Google Analytics',
  _hjSessionUser_1234567: 'Hotjar',
  _hjSession_1234567: 'Hotjar',
  _hjAbsoluteSessionInProgress: 'Hotjar',
  'intercom-id-abc12345': 'Intercom',
  'intercom-session-abc12345': 'Intercom',
  _ym_uid: 'Yandex Metrica',
  _ym_isad: 'Yandex Metrica',
  Hm_lvt_0123456789abcdef: 'Baidu Tongji',
  Hm_lpvt_0123456789abcdef: 'Baidu Tongji',
  _vwo_uuid_v2: 'VWO',
  _vis_opt_s: 'VWO',
  '_pk_id.1.a1b2': 'Matomo',
  '_pk_ses.1.a1b2': 'Matomo',
  '_sp_id.1fff': 'Snowplow',
  '_sp_ses.1fff': 'Snowplow',
};

describe('categorizeCookie — load-balancer, CDN, bot-protection and session cookies', () => {
  it('each known infrastructure cookie is functional even when it is SameSite=None', () => {
    for (const [cookie, name] of Object.entries({ ...INFRA_EXACT, ...INFRA_PATTERNED })) {
      const r = categorizeCookie(crossSite(cookie));
      expect(r.name, cookie).toBe(name);
      expect(r.category, cookie).toBe('functional');
      expect(r.risk, cookie).toBe('low');
    }
  });

  it('the two published examples from the pilot are no longer tracking', () => {
    // cnbc.com and mediatek.com, as their stored cards record them.
    expect(categorizeCookie('AWSALBCORS=x; Expires=Tue, 15 Sep 2026 02:34:23 GMT; Path=/; SameSite=None; Secure').category).toBe('functional');
    expect(categorizeCookie('_cfuvid=x; Path=/; Domain=www.mediatek.com; HttpOnly; Secure; SameSite=None').category).toBe('functional');
  });

  it('a known name wins over the name heuristics ("uid" in _cfuvid, "_px" in _pxhd, "session" in ASP.NET_SessionId)', () => {
    expect(categorizeCookie('_cfuvid=x').name).toBe('Cloudflare');
    expect(categorizeCookie('_pxhd=x; SameSite=Lax').name).toBe('HUMAN (PerimeterX)');
    expect(categorizeCookie('ASP.NET_SessionId=x').name).toBe('ASP.NET Session');
  });

  it('every exact name added on 2026-09-11 is in KNOWN_COOKIES, and every pattern is exercised above', () => {
    for (const name of [...Object.keys(INFRA_EXACT), ...Object.keys(AD_EXACT)]) {
      if (/^_px(?:de|ff_)/.test(name)) continue; // the PerimeterX family is known by pattern
      expect(Object.keys(KNOWN_COOKIES), name).toContain(name);
    }
    const samples = [...Object.keys(INFRA_PATTERNED), ...Object.keys(AD_PATTERNED), ...Object.keys(ANALYTICS_PATTERNED)];
    for (const { pattern } of KNOWN_COOKIE_PATTERNS) {
      expect(samples.some((s) => pattern.test(s)), `no sample for ${pattern}`).toBe(true);
    }
  });

  it('patterns are anchored and case-sensitive: look-alike names are not swept in', () => {
    for (const name of ['TSID', 'TS01', 'tS0121e8f2', 'xAWSALB', 'AWSALB2', 'bigipserver_pool', 'my_akaalb_x', 'nlbi', 'incap_x', '__ddg1', 'mp']) {
      const r = categorizeCookie(crossSite(name));
      expect(r.category, name).toBe('tracking'); // falls through to the SameSite=None heuristic
      expect(r.name, name).toBe(SAMESITE_NONE_GUESS);
    }
  });

  it('Mixpanel keeps its prefix rule after moving to KNOWN_COOKIE_PATTERNS', () => {
    expect(categorizeCookie('mp_0123abcd_mixpanel=x').name).toBe('Mixpanel');
    expect(categorizeCookie('mp_0123abcd_mixpanel=x').category).toBe('analytics');
  });

  it('the whole HUMAN (PerimeterX) family is functional, not just the four names listed by hand', () => {
    for (const name of ['_pxhd', '_pxvid', '_px2', '_px3', '_pxde', '_pxcts', 'pxcts', '_pxff_cc', '_pxff_tcp_rtt']) {
      const r = categorizeCookie(crossSite(name));
      expect(r.name, name).toBe('HUMAN (PerimeterX)');
      expect(r.category, name).toBe('functional');
    }
  });

  it('"_px" is no longer a tracking name heuristic: only the three names the methodology publishes are', () => {
    // app/site/methodology/page.tsx publishes "uid", "visitor" and "track". A
    // deduction the published rules cannot explain is not one we may publish.
    expect(categorizeCookie('sub_pxy=x').category).toBe('unknown');
    expect(categorizeCookie('sub_pxy=x').name).toBe('Unknown');
    for (const name of ['visitor_id', 'my_uid', 'tracker_a']) {
      expect(categorizeCookie(`${name}=x`).category, name).toBe('tracking');
    }
  });

  it('returns exactly the published fields (no pattern or info objects leak into a card)', () => {
    for (const cookie of ['BIGipServerpool=x', '_cfuvid=x', 'unknown_thing=x', 'visitor_id=x']) {
      expect(Object.keys(categorizeCookie(cookie)).sort(), cookie).toEqual(['category', 'cookieName', 'description', 'name', 'risk']);
    }
  });

  it('Object.prototype names are not known cookies', () => {
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const r = categorizeCookie(`${name}=x`);
      expect(typeof r.category, name).toBe('string');
      expect(typeof r.description, name).toBe('string');
    }
  });

  it('every known cookie has a vendor name, a real category and a description', () => {
    const entries = [...Object.entries(KNOWN_COOKIES), ...KNOWN_COOKIE_PATTERNS.map((p) => [String(p.pattern), p.info] as const)];
    for (const [key, info] of entries) {
      expect(info.name.length, key).toBeGreaterThan(1);
      expect(['tracking', 'analytics', 'functional'], key).toContain(info.category);
      expect(['high', 'medium', 'low'], key).toContain(info.risk);
      expect(info.description.length, key).toBeGreaterThan(10);
    }
  });
});

/**
 * The mirror of the block above: infrastructure cookies must not be called
 * tracking, and advertising cookies must not escape being called tracking.
 * Before 2026-09-11 a name like __gads, cto_bundle or _pubcid was only ever
 * caught by the SameSite=None guess — so a first-party ad cookie without that
 * attribute was published as "Unknown", and the Cookie & Tracker Scanner gave
 * a list of nothing but ad cookies a perfect 100.
 */
describe('categorizeCookie — advertising and cross-site identity cookies', () => {
  const firstParty = (name: string) => `${name}=v; Path=/; Secure; SameSite=Lax`;

  it('every advertising and identity cookie is named by its vendor, with no SameSite=None to fall back on', () => {
    for (const [cookie, vendor] of Object.entries({ ...AD_EXACT, ...AD_PATTERNED })) {
      const r = categorizeCookie(firstParty(cookie));
      expect(r.name, cookie).toBe(vendor);
      expect(r.category, cookie).toBe('tracking');
      expect(r.name, cookie).not.toBe(SAMESITE_NONE_GUESS);
    }
  });

  it('the verifier\'s case: a first-party list of pure advertising cookies is all tracking, none "Unknown"', () => {
    const pasted = ['__gads', '__gpi', '__eoi', '_gcl_aw', '_gcl_dc', 'cto_bundle', '_pubcid', 'AMCV_X%40AdobeOrg'];
    const got = pasted.map((n) => categorizeCookie(firstParty(n)));
    expect(got.map((c) => c.category)).toEqual(Array(8).fill('tracking'));
    expect(got.filter((c) => c.risk === 'high')).toHaveLength(8);
  });

  it('analytics families with a property id in the name are analytics, not "Unknown" or SameSite guesses', () => {
    for (const [cookie, vendor] of Object.entries(ANALYTICS_PATTERNED)) {
      const r = categorizeCookie(firstParty(cookie));
      expect(r.name, cookie).toBe(vendor);
      expect(r.category, cookie).toBe('analytics');
    }
  });

  it('a known advertising name wins over a long expiry and over SameSite=None, and keeps its own risk', () => {
    const long = categorizeCookie('__gads=v; Max-Age=31536000');
    expect(long.name).toBe('Google Ad Manager');
    expect(long.category).toBe('tracking');
    expect(categorizeCookie(crossSite('cto_bundle')).name).toBe('Criteo');
    // DoubleClick's cookie-support probe is a real ad-domain cookie, but it is
    // a 15-minute check, not an identifier: it is not a high-risk item.
    expect(categorizeCookie(firstParty('test_cookie')).risk).toBe('low');
  });

  it('look-alike names are not swept into an ad vendor', () => {
    for (const name of ['gads', 'my__gads', 'cto', 'ctostore', 'AMCV', 'amcv_x', 'kndctr', 'panorama', '_pub', '_ga', '_gat']) {
      const r = categorizeCookie(firstParty(name));
      expect(['Google Ad Manager', 'Criteo', 'Adobe Experience Cloud', 'Adobe Experience Platform', 'Lotame', 'PubCommon ID'], name)
        .not.toContain(r.name);
    }
    // _ga and _gat are Google Analytics by exact name, which is the point of the two above.
    expect(categorizeCookie(firstParty('_ga')).name).toBe('Google Analytics');
    expect(categorizeCookie(firstParty('_gat')).category).toBe('analytics');
  });
});

describe('categorizeCookie — heuristics still apply to cookies nobody has identified', () => {
  it('an unrecognized SameSite=None cookie is still tracking (owner decision pending, not changed here)', () => {
    const r = categorizeCookie(crossSite('SecGpc'));
    expect(r.category).toBe('tracking');
    expect(r.name).toBe(SAMESITE_NONE_GUESS);
  });

  it('name heuristics and the long-lived rule are unchanged', () => {
    expect(categorizeCookie('visitor_id=x').category).toBe('tracking');
    expect(categorizeCookie('my_session=x').category).toBe('functional');
    expect(categorizeCookie('prefs=x; Max-Age=31536000').category).toBe('analytics');
    expect(categorizeCookie('prefs=x').category).toBe('unknown');
  });
});

describe('analyzeScan counts infrastructure cookies as functional', () => {
  it('a response setting only load-balancer and CDN cookies has no tracking cookies', () => {
    const headers = new Headers();
    headers.append('set-cookie', 'AWSALB=a; Expires=Tue, 15 Sep 2026 02:34:23 GMT; Path=/');
    headers.append('set-cookie', 'AWSALBCORS=a; Expires=Tue, 15 Sep 2026 02:34:23 GMT; Path=/; SameSite=None; Secure');
    headers.append('set-cookie', '_cfuvid=b; Path=/; HttpOnly; Secure; SameSite=None');
    headers.append('set-cookie', 'akaas_CNBC_AudienceSegmentation=c; Path=/; SameSite=None; Secure');
    const url = 'https://www.example.test/';
    const r = analyzeScan(url, new URL(url), new Response('', { headers }), '<html></html>', { maxCookies: 100, maxScriptMatches: 500, maxThirdPartyDomains: 50 });
    expect(r.cookies.map((c) => c.category)).toEqual(['functional', 'functional', 'functional', 'functional']);
    expect(r.summary.trackingCookies).toBe(0);
    expect(r.summary.functionalCookies).toBe(4);
    expect(r.summary.highRiskItems).toBe(0);
  });
});

/**
 * One cookie set several times is one cookie. lowes.com's card published
 * "8 tracking cookies before consent" for a single EPID cookie the response
 * set eight times with different Expires values (22 duplicate tracking
 * cookies across 10 cards, 64 duplicate Set-Cookie lines across 21).
 */
describe('analyzeScan counts a cookie set several times once', () => {
  const LIMITS = { maxCookies: 100, maxScriptMatches: 500, maxThirdPartyDomains: 50 };
  const scanWith = (lines: string[]) => {
    const headers = new Headers();
    for (const l of lines) headers.append('set-cookie', l);
    const url = 'https://www.lowes.test/';
    return analyzeScan(url, new URL(url), new Response('', { headers }), '<html></html>', LIMITS);
  };

  it('collapses the same name, domain and path to one cookie and counts it once', () => {
    const epid = (expires: string) => `EPID=v; Expires=${expires}; Path=/; Domain=.lowes.test; Secure; SameSite=None`;
    const r = scanWith([
      epid('Fri, 05-Sep-2036 13:41:19 GMT'),
      ...Array(7).fill(epid('Tue, 27-Oct-2037 05:41:19 GMT')),
    ]);
    expect(r.cookies).toHaveLength(1);
    expect(r.summary.totalCookies).toBe(1);
    expect(r.summary.trackingCookies).toBe(1);
    expect(r.summary.highRiskItems).toBe(1);
  });

  it('keeps the last Set-Cookie for a name, at the position the name first appeared', () => {
    const r = scanWith([
      'EPID=v; Expires=Fri, 05-Sep-2036 13:41:19 GMT; Path=/; Domain=.lowes.test; Secure; SameSite=None',
      'region=CA; Path=/',
      'EPID=v; Expires=Tue, 27-Oct-2037 05:41:19 GMT; Path=/; Domain=.lowes.test; Secure; SameSite=None',
    ]);
    expect(r.cookies.map((c) => c.cookieName)).toEqual(['EPID', 'region']);
    expect(r.cookies[0].expires).toBe('Tue, 27-Oct-2037 05:41:19 GMT');
  });

  it('keeps cookies that differ in name, domain or path, and is case-insensitive on the domain only', () => {
    const r = scanWith([
      'id=1; Path=/',
      'id=2; Path=/account',
      'id=3; Domain=other.lowes.test; Path=/',
      'ID=4; Path=/',
      'id=5; Domain=WWW.LOWES.TEST; Path=/',
    ]);
    // id=5 repeats the host-only id (same domain, different case); the rest are four distinct cookies.
    expect(r.cookies.map((c) => `${c.cookieName}|${c.domain}|${c.path}`)).toEqual([
      'id|WWW.LOWES.TEST|/',
      'id|www.lowes.test|/account',
      'id|other.lowes.test|/',
      'ID|www.lowes.test|/',
    ]);
  });

  it('does not merge a host-only cookie with the same name set for a leading-dot domain', () => {
    // Browsers keep these apart (RFC 6265bis makes the host-only flag part of
    // the identity), and a stored card can't tell one from the other, so the
    // safe direction is to count them separately.
    const r = scanWith(['McKa82ms=a; Path=/', 'McKa82ms=b; Domain=.lowes.test; Path=/']);
    expect(r.cookies.map((c) => c.domain)).toEqual(['www.lowes.test', '.lowes.test']);
  });

  it('dedupeCookies and cookieIdentity ignore attributes that are not part of a cookie identity', () => {
    const base = { cookieName: 'EPID', domain: '.lowes.test', path: '/' };
    expect(cookieIdentity(base)).toBe(cookieIdentity({ ...base, domain: '.LOWES.test' }));
    expect(cookieIdentity(base)).not.toBe(cookieIdentity({ ...base, domain: 'lowes.test' }));
    expect(cookieIdentity(base)).not.toBe(cookieIdentity({ ...base, path: '/a' }));
    expect(dedupeCookies([{ ...base, expires: 'a' }, { ...base, expires: 'b' }])).toEqual([{ ...base, expires: 'b' }]);
    expect(dedupeCookies([])).toEqual([]);
  });
});
