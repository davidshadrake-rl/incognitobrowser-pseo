/**
 * lib/scanner TRACKER_PATTERNS — the ad, analytics and tracking scripts a
 * report card names.
 *
 * Funnel pilot, 2026-09-11: comScore's beacon (sb.scorecardresearch.com) was
 * not a pattern, so the 12 cards that load it read cleaner than they are. The
 * script domains the 500 stored cards load were listed by how many cards load
 * them and matched by no pattern; the clear ad, analytics and tracking beacons
 * among them became patterns. CDNs, fonts, consent managers, video players,
 * performance monitoring and first-party-looking hosts were left alone. The
 * TOP_40 table records the decision for the 40 most-loaded of those domains.
 */
import { describe, expect, it } from 'vitest';
import { analyzeScan, TRACKER_PATTERNS } from '../lib/scanner';

const matches = (host: string) => TRACKER_PATTERNS.filter((t) => t.pattern.test(host));
const byName = (name: string) => TRACKER_PATTERNS.find((t) => t.name === name);

/** Each pattern added on 2026-09-11 → hosts it must name (from the stored cards where one loads it). */
const ADDED: Record<string, { category: 'tracking' | 'analytics'; risk: 'high' | 'medium' | 'low'; hosts: string[] }> = {
  Quantcast: { category: 'tracking', risk: 'high', hosts: ['pixel.quantserve.com'] },
  'Xandr (Microsoft)': { category: 'tracking', risk: 'high', hosts: ['adsdk.microsoft.com', 'ib.adnxs.com'] },
  'Magnite (Rubicon Project)': { category: 'tracking', risk: 'high', hosts: ['eus.rubiconproject.com'] },
  PubMatic: { category: 'tracking', risk: 'high', hosts: ['ads.pubmatic.com'] },
  'Index Exchange': { category: 'tracking', risk: 'high', hosts: ['as-sec.casalemedia.com', 'js-sec.indexww.com'] },
  'The Trade Desk': { category: 'tracking', risk: 'high', hosts: ['match.adsrvr.org'] },
  LiveIntent: { category: 'tracking', risk: 'high', hosts: ['i.liadm.com'] },
  LiveRamp: { category: 'tracking', risk: 'high', hosts: ['ats-wrapper.privacymanager.io', 'idsync.rlcdn.com'] },
  Permutive: { category: 'tracking', risk: 'high', hosts: ['507b28fb-2ef1-4c34-8bda-ba32030bb199.edge.permutive.app', 'cdn.permutive.com'] },
  'Google Publisher Tag': { category: 'tracking', risk: 'high', hosts: ['www.googletagservices.com'] },
  Freestar: { category: 'tracking', risk: 'high', hosts: ['a.pub.network'] },
  Blockthrough: { category: 'tracking', risk: 'medium', hosts: ['btloader.com'] },
  'Wunderkind (BounceX)': { category: 'tracking', risk: 'high', hosts: ['tag.bounceexchange.com'] },
  Nativo: { category: 'tracking', risk: 'high', hosts: ['s.ntv.io'] },
  Dianomi: { category: 'tracking', risk: 'high', hosts: ['www.dianomi.com'] },
  Yieldlove: { category: 'tracking', risk: 'high', hosts: ['cdn-a.yieldlove.com'] },
  'Relevant Digital': { category: 'tracking', risk: 'high', hosts: ['schibstedno-cdn.relevant-digital.com', 'wetteronline-cdn.relevant-digital.com'] },
  NoBid: { category: 'tracking', risk: 'high', hosts: ['public.servenobid.com'] },
  OneTag: { category: 'tracking', risk: 'high', hosts: ['get.s-onetag.com'] },
  'Equativ (Smart AdServer)': { category: 'tracking', risk: 'high', hosts: ['ced-ns.sascdn.com'] },
  'Amazon Ad Server (Sizmek)': { category: 'tracking', risk: 'high', hosts: ['bs.serving-sys.com'] },
  'Skai (Kenshoo)': { category: 'tracking', risk: 'high', hosts: ['services.xg4ken.com', 'events.xg4ken.com'] },
  'Microsoft Advertising UET': { category: 'tracking', risk: 'high', hosts: ['bat.bing.com'] },
  'Reddit Pixel': { category: 'tracking', risk: 'high', hosts: ['alb.reddit.com'] },
  'Moat (Oracle)': { category: 'tracking', risk: 'medium', hosts: ['z.moatads.com'] },
  DoubleVerify: { category: 'tracking', risk: 'medium', hosts: ['pub.doubleverify.com'] },
  'Integral Ad Science': { category: 'tracking', risk: 'medium', hosts: ['cdn.adsafeprotected.com'] },
  comScore: { category: 'analytics', risk: 'medium', hosts: ['sb.scorecardresearch.com', 'b.scorecardresearch.com', 'census-web.scorecardresearch.com'] },
  Chartbeat: { category: 'analytics', risk: 'medium', hosts: ['static.chartbeat.com', 'ping.chartbeat.net'] },
  'Parse.ly': { category: 'analytics', risk: 'medium', hosts: ['cdn.parsely.com', 'experiments.parsely.com'] },
  'Cxense (Piano)': { category: 'analytics', risk: 'medium', hosts: ['cdn.cxense.com'] },
  'Cloudflare Web Analytics': { category: 'analytics', risk: 'low', hosts: ['static.cloudflareinsights.com'] },
  'Yandex Metrica': { category: 'analytics', risk: 'medium', hosts: ['mc.yandex.ru', 'mc.yandex.com'] },
  'Baidu Tongji': { category: 'analytics', risk: 'medium', hosts: ['hm.baidu.com'] },
  'Top.Mail.Ru': { category: 'analytics', risk: 'medium', hosts: ['top-fwz1.mail.ru'] },
  'Jetpack Stats': { category: 'analytics', risk: 'medium', hosts: ['stats.wp.com'] },
  StatCounter: { category: 'analytics', risk: 'medium', hosts: ['c.statcounter.com'] },
  'Matomo / Piwik PRO': { category: 'analytics', risk: 'low', hosts: ['matomo.openstreetmap.org', 'cdn.matomo.cloud', 'globalsign.containers.piwik.pro'] },
  'Siteimprove Analytics': { category: 'analytics', risk: 'medium', hosts: ['siteimproveanalytics.com'] },
  'Digital Analytics Program': { category: 'analytics', risk: 'medium', hosts: ['dap.digitalgov.gov'] },
  'Adobe Experience Platform Tags': { category: 'analytics', risk: 'medium', hosts: ['assets.adobedtm.com'] },
  'Tealium iQ': { category: 'analytics', risk: 'medium', hosts: ['tags.tiqcdn.com'] },
  Ensighten: { category: 'analytics', risk: 'medium', hosts: ['nexus.ensighten.com'] },
  VWO: { category: 'analytics', risk: 'medium', hosts: ['dev.visualwebsiteoptimizer.com'] },
  Optimizely: { category: 'analytics', risk: 'medium', hosts: ['cdn.optimizely.com'] },
  Kameleoon: { category: 'analytics', risk: 'medium', hosts: ['7foxepcf7f.kameleoon.io'] },
  'Marketo Munchkin': { category: 'analytics', risk: 'medium', hosts: ['munchkin.marketo.net'] },
  'Adobe Marketo Measure (Bizible)': { category: 'analytics', risk: 'medium', hosts: ['cdn.bizible.com'] },
  'Clearbit Reveal': { category: 'analytics', risk: 'medium', hosts: ['reveal.clearbit.com'] },
  Pendo: { category: 'analytics', risk: 'medium', hosts: ['cdn.pendo.io'] },
  'Crazy Egg': { category: 'analytics', risk: 'medium', hosts: ['script.crazyegg.com'] },
  MoEngage: { category: 'analytics', risk: 'medium', hosts: ['cdn.moengage.com'] },
  Sailthru: { category: 'analytics', risk: 'medium', hosts: ['ak.sail-horizon.com'] },
  Mindbox: { category: 'analytics', risk: 'medium', hosts: ['api.s.mindbox.ru'] },
  AppsFlyer: { category: 'analytics', risk: 'medium', hosts: ['websdk.appsflyer.com'] },
};

/**
 * The 40 script domains the most stored cards loaded that no pattern matched
 * on 2026-09-11 (cards loading each in brackets), and what was done: a
 * tracker name, or null where it was left alone and why.
 */
const TOP_40: Array<[host: string, cards: number, tracker: string | null, why?: string]> = [
  ['cdn.cookielaw.org', 38, null, 'OneTrust consent banner'],
  ['static.cloudflareinsights.com', 22, 'Cloudflare Web Analytics'],
  ['www.google.com', 18, null, 'reCAPTCHA, Maps, sign-in: the domain alone does not say which; reCAPTCHA has its own pattern'],
  ['ajax.googleapis.com', 12, null, 'library CDN'],
  ['assets.adobedtm.com', 12, 'Adobe Experience Platform Tags'],
  ['cdn.jsdelivr.net', 12, null, 'library CDN'],
  ['sb.scorecardresearch.com', 12, 'comScore'],
  ['d3e54v103j8qbb.cloudfront.net', 10, null, "Webflow's jQuery CDN"],
  ['cdn.prod.website-files.com', 9, null, 'Webflow asset CDN'],
  ['cdnjs.cloudflare.com', 9, null, 'library CDN'],
  ['www.youtube.com', 8, null, 'video embed, not a beacon'],
  ['mc.yandex.ru', 7, 'Yandex Metrica'],
  ['rum.hlx.page', 7, null, 'Adobe Edge Delivery performance monitoring (like Sentry), not ad or analytics'],
  ['accounts.google.com', 6, null, 'Sign in with Google'],
  ['cdn.sanity.io', 6, null, 'CMS asset CDN'],
  ['dev.visualwebsiteoptimizer.com', 6, 'VWO'],
  ['js.hsforms.net', 6, null, "HubSpot form embed; HubSpot's tracking code (hs-scripts) has its own pattern"],
  ['stats.wp.com', 6, 'Jetpack Stats'],
  ['www.facebook.com', 6, null, "the Pixel's noscript image or a social plugin: the domain alone does not say which; the Pixel has its own pattern"],
  ['www.gstatic.com', 6, null, 'Google static CDN'],
  ['challenges.cloudflare.com', 5, null, 'Cloudflare Turnstile CAPTCHA'],
  ['cmp.osano.com', 5, null, 'Osano consent banner'],
  ['code.jquery.com', 5, null, 'library CDN'],
  ['fast.wistia.com', 5, null, 'video player'],
  ['images.ctfassets.net', 5, null, 'Contentful asset CDN'],
  ['cdn.optimizely.com', 4, 'Optimizely'],
  ['cdn.parsely.com', 4, 'Parse.ly'],
  ['cdn.privacy-mgmt.com', 4, null, 'Sourcepoint consent banner'],
  ['cdn.speedcurve.com', 4, null, 'SpeedCurve performance monitoring, not ad or analytics'],
  ['fundingchoicesmessages.google.com', 4, null, "Google's consent messages"],
  ['g.alicdn.com', 4, null, 'Alibaba CDN, first party on Alibaba sites'],
  ['transcend-cdn.com', 4, null, 'Transcend consent manager'],
  ['cdn.cxense.com', 3, 'Cxense (Piano)'],
  ['cdn.weglot.com', 3, null, 'translation widget'],
  ['experiments.parsely.com', 3, 'Parse.ly'],
  ['http2.mlstatic.com', 3, null, 'Mercado Libre CDN, first party'],
  ['hubspotonwebflow.com', 3, null, 'HubSpot-for-Webflow form app; not clearly a beacon'],
  ['i.ytimg.com', 3, null, 'YouTube thumbnails'],
  ['ic-vt-nss.xhcdn.com', 3, null, 'xHamster CDN, first party'],
  ['player.vimeo.com', 3, null, 'video player'],
];

describe('TRACKER_PATTERNS added 2026-09-11', () => {
  it('each added tracker exists with its category and risk, and names each of its hosts (and only it)', () => {
    for (const [name, want] of Object.entries(ADDED)) {
      const t = byName(name);
      expect(t, name).toBeDefined();
      expect(t!.category, name).toBe(want.category);
      expect(t!.risk, name).toBe(want.risk);
      expect(t!.description.length, name).toBeGreaterThan(15);
      for (const host of want.hosts) expect(matches(host).map((m) => m.name), host).toEqual([name]);
    }
  });

  it("LinkedIn Insight's noscript pixel host now counts as LinkedIn Insight", () => {
    expect(matches('px.ads.linkedin.com').map((m) => m.name)).toEqual(['LinkedIn Insight']);
  });

  it('the Reddit Pixel is named by its ads path, not by any redditstatic.com script', () => {
    expect(matches('www.redditstatic.com')).toEqual([]);
    expect(TRACKER_PATTERNS.filter((t) => t.pattern.test('<script src="https://www.redditstatic.com/ads/pixel.js"></script>')).map((t) => t.name)).toEqual(['Reddit Pixel']);
  });

  it("a vendor's own website or a look-alike host is not the vendor's tracker", () => {
    for (const host of ['www.comscore.com', 'www.quantcast.com', 'www.appsflyer.com', 'www.optimizely.com', 'parse.ly', 'data.pub.network', 'cntv.io', 'yandex.ru', 'www.yandex.ru', 'mail.ru', 'www.bing.com', 'www.linkedin.com', 'www.reddit.com']) {
      expect(matches(host).map((m) => m.name), host).toEqual([]);
    }
  });

  it('every tracker name is unique (cards and TRACKER_FOR_INLINE key on it)', () => {
    const names = TRACKER_PATTERNS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('no pattern is stateful (a /g flag would make .test() skip matches on reuse)', () => {
    for (const t of TRACKER_PATTERNS) expect(t.pattern.flags, t.name).not.toContain('g');
  });
});

describe('the 40 most-loaded unmatched script domains of 2026-09-11', () => {
  it('has 40 entries, most-loaded first', () => {
    expect(TOP_40).toHaveLength(40);
    const counts = TOP_40.map(([, n]) => n);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts);
  });

  it('each is named as decided: a tracker, or left alone', () => {
    for (const [host, , tracker, why] of TOP_40) {
      const names = matches(host).map((m) => m.name);
      if (tracker) expect(names, host).toEqual([tracker]);
      else {
        expect(names, `${host} was left alone (${why})`).toEqual([]);
        expect(why, host).toBeTruthy();
      }
    }
  });

  it('fonts and the big library CDNs stay unmatched', () => {
    for (const host of ['fonts.googleapis.com', 'fonts.gstatic.com', 'unpkg.com', 'stackpath.bootstrapcdn.com', 'cdn.shopify.com', 's.yimg.com']) {
      expect(matches(host), host).toEqual([]);
    }
  });
});

describe('analyzeScan finds the added trackers in page HTML', () => {
  const url = 'https://www.example.test/';
  const scan = (html: string) => analyzeScan(url, new URL(url), new Response(''), html, { maxCookies: 100, maxScriptMatches: 500, maxThirdPartyDomains: 50 });

  it("comScore's beacon script is an analytics tracker", () => {
    const r = scan('<script src="https://sb.scorecardresearch.com/beacon.js"></script>');
    expect(r.trackers.map((t) => [t.name, t.category, t.risk])).toEqual([['comScore', 'analytics', 'medium']]);
    expect(r.thirdPartyDomains).toEqual(['sb.scorecardresearch.com']);
  });

  it("Microsoft's UET snippet is found even though it loads bat.js protocol-relative", () => {
    const html = `<script>(function(w,d,t,r,u){var f,n,i;w[u]=w[u]||[],f=function(){var o={ti:"123"};o.q=w[u],w[u]=new UET(o)},n=d.createElement(t),n.src=r;i=d.getElementsByTagName(t)[0];i.parentNode.insertBefore(n,i)})(window,document,"script","//bat.bing.com/bat.js","uetq");</script>`;
    expect(scan(html).trackers.map((t) => t.name)).toEqual(['Microsoft Advertising UET']);
    expect(scan(html).thirdPartyDomains).toEqual([]); // why a regrade from stored domains can miss it
  });

  it('a page with header bidding lists each exchange once, in TRACKER_PATTERNS order', () => {
    const html = ['https://ib.adnxs.com/x.js', 'https://ads.pubmatic.com/x.js', 'https://js-sec.indexww.com/x.js', 'https://eus.rubiconproject.com/x.js'].map((s) => `<script src="${s}"></script>`).join('');
    const names = scan(html).trackers.map((t) => t.name);
    expect(names).toEqual(['Xandr (Microsoft)', 'Magnite (Rubicon Project)', 'PubMatic', 'Index Exchange']);
  });
});
