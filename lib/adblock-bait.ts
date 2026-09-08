/**
 * lib/adblock-bait — the Ad-Blocker Test catalogue and scoring. Framework-free.
 *
 * How the test proves ad blocking WITHOUT touching an ad network:
 *
 *   Filter lists (EasyList, EasyPrivacy, uBlock's own lists) contain two kinds
 *   of network rule. Host-anchored rules (`||doubleclick.net^`) match a domain;
 *   generic rules (`/gtm.js`, `/pixel.gif?`, `/300x250.$image`) match a URL
 *   pattern on ANY domain, first-party included. Every path below is a
 *   first-party file we serve ourselves under /adtest/ whose URL matches one
 *   of those generic rules — verified against the compiled lists. A blocker
 *   with those lists enabled cancels the request before it leaves the browser;
 *   a browser without one loads a 60-byte script or a 43-byte GIF from us.
 *
 *   Each script bait sets `window.__adtest[<id>] = 1`, so "allowed" means the
 *   script actually ran — a blocker that swaps the response for a neutered stub
 *   (uBlock's redirect resources) still counts as blocked.
 *
 *   Cosmetic baits are class names targeted by generic element-hiding rules
 *   (`##.ad-slot`). A blocker with cosmetic filtering hides them.
 *
 * Honest limits: DNS-level blockers (Pi-hole, NextDNS) block by domain only
 * and will score 0 here even though they stop real ad networks; the test
 * measures URL-pattern filtering, which is what browser blockers do.
 *
 * The rule strings are the actual list entries the path was checked against
 * (options after `$` included), so the UI can show WHY a request is expected
 * to be blocked. Regenerate the bait files after editing the catalogue:
 *   npx tsx scripts/gen-adtest-bait.mjs
 */

export type BaitKind = 'script' | 'image';
export type BaitCategory = 'ads' | 'analytics' | 'social' | 'beacons';

export interface NetworkBait {
  /** Stable id; scripts set window.__adtest[id] = 1 when they run. Lowercase, digits, hyphens. */
  id: string;
  /** First-party path under /adtest/ (the runtime prefixes the deployment's base path). */
  path: string;
  kind: BaitKind;
  /** The generic filter-list rule this path mirrors (EasyList / EasyPrivacy syntax). */
  rule: string;
  /** What a real request at this path would be. */
  label: string;
  category: BaitCategory;
}

export interface CosmeticBait {
  /** Class name a generic element-hiding rule targets. */
  className: string;
  /** The cosmetic rule, e.g. `##.ad-slot`. */
  rule: string;
  label: string;
}

export const BAIT_ROOT = '/adtest';
export const PROBE_TIMEOUT_MS = 3000;
export const COSMETIC_SETTLE_MS = 400;

export const CATEGORY_ORDER: readonly BaitCategory[] = ['ads', 'analytics', 'social', 'beacons'];

export const CATEGORY_LABELS: Record<BaitCategory, string> = {
  ads: 'Advertising',
  analytics: 'Analytics & fingerprinting',
  social: 'Social media pixels',
  beacons: 'Beacons & tracking pixels',
};

export const CATEGORY_BLURBS: Record<BaitCategory, string> = {
  ads: 'Ad-serving scripts, header bidding, native ad units and banner images.',
  analytics: 'Site analytics, tag managers, session replay and fingerprinting libraries.',
  social: 'Conversion pixels from social networks that follow you off-platform.',
  beacons: 'Invisible 1×1 images and event scripts that report what you did.',
};

/**
 * Exactly 50 first-party baits. Every `path` was checked against the compiled
 * EasyList + EasyPrivacy lists (September 2026) as a first-party request on
 * both `/adtest/…` and `/resources/adtest/…` with a `?v=` cache-buster, and
 * matched the generic rule shown with no generic exception.
 */
export const NETWORK_BAITS: readonly NetworkBait[] = [
  // ── Advertising ─────────────────────────────────────────────────────────
  { id: 'gpt', path: '/adtest/gpt.js', kind: 'script', rule: '/gpt.js$script', label: 'Google Publisher Tag loader', category: 'ads' },
  { id: 'prebid', path: '/adtest/prebid.js', kind: 'script', rule: '/prebid.$script,domain=~prebid.org', label: 'Prebid.js header-bidding library', category: 'ads' },
  { id: 'apstag', path: '/adtest/apstag.js', kind: 'script', rule: '/apstag.js$script', label: 'Amazon Publisher Services bidder', category: 'ads' },
  { id: 'pagead-conversion', path: '/adtest/pagead/conversion.js', kind: 'script', rule: '/pagead/conversion.js$script', label: 'Google Ads conversion tag', category: 'ads' },
  { id: 'adserver', path: '/adtest/adserver.js', kind: 'script', rule: '/adserver.$~stylesheet,~xmlhttprequest', label: 'Generic ad-server script', category: 'ads' },
  { id: 'admanager', path: '/adtest/admanager.js', kind: 'script', rule: '/admanager.js$script', label: 'Ad manager script', category: 'ads' },
  { id: 'adengine', path: '/adtest/adengine.js', kind: 'script', rule: '/adengine.js$script', label: 'Ad engine script', category: 'ads' },
  { id: 'nativeads', path: '/adtest/nativeads.js', kind: 'script', rule: '/nativeads.js$script', label: 'Native ad unit loader', category: 'ads' },
  { id: 'popunder', path: '/adtest/popunder1.js', kind: 'script', rule: '/popunder1.js$script', label: 'Pop-under ad script', category: 'ads' },
  { id: 'taboola', path: '/adtest/taboola.js', kind: 'script', rule: '/taboola.js$~xmlhttprequest', label: 'Taboola content-recommendation widget', category: 'ads' },
  { id: 'outbrain', path: '/adtest/outbrain.js', kind: 'script', rule: '/outbrain.js$~xmlhttprequest', label: 'Outbrain content-recommendation widget', category: 'ads' },
  { id: 'criteo', path: '/adtest/criteo.js', kind: 'script', rule: '/criteo.$domain=~criteo.blotout.io|~criteo.github.io|~criteo.investorroom.com', label: 'Criteo retargeting loader', category: 'ads' },
  { id: 'doubleclick', path: '/adtest/js/doubleclick.min.js', kind: 'script', rule: '/js/doubleclick.min.js?v=', label: 'Self-hosted DoubleClick wrapper', category: 'ads' },
  { id: 'ads-banner-300x250', path: '/adtest/ads/banners/300x250.gif', kind: 'image', rule: '/ads/banners/*$image', label: 'Medium-rectangle banner in an /ads/banners/ folder', category: 'ads' },
  { id: 'ad-banner-dir', path: '/adtest/ad_banner/1.gif', kind: 'image', rule: '/ad_banner/*$image', label: 'Banner image in an /ad_banner/ folder', category: 'ads' },
  { id: 'advert-gif', path: '/adtest/advert.gif', kind: 'image', rule: '/advert.$~script,~xmlhttprequest', label: 'Image named advert', category: 'ads' },
  { id: 'affiliates-banner', path: '/adtest/affiliates/banner.gif', kind: 'image', rule: '/affiliates/banner$image', label: 'Affiliate programme banner', category: 'ads' },
  { id: 'sponsored-link', path: '/adtest/sponsored_link.gif', kind: 'image', rule: '/sponsored_link.gif$image', label: 'Sponsored-link image', category: 'ads' },
  { id: '300x250', path: '/adtest/300x250.gif', kind: 'image', rule: '/300x250.$image', label: 'Image named after the 300×250 ad size', category: 'ads' },
  { id: '728x90', path: '/adtest/728x90.gif', kind: 'image', rule: '/728x90.$image', label: 'Image named after the 728×90 leaderboard size', category: 'ads' },

  // ── Analytics & fingerprinting ──────────────────────────────────────────
  { id: 'gtm', path: '/adtest/gtm.js', kind: 'script', rule: '/gtm.js', label: 'Google Tag Manager container', category: 'analytics' },
  { id: 'ga', path: '/adtest/analytics/ga.js', kind: 'script', rule: '/analytics/ga.js', label: 'Google Analytics (classic ga.js)', category: 'analytics' },
  { id: 'utm-gif', path: '/adtest/__utm.gif', kind: 'image', rule: '/__utm.gif', label: 'Google Analytics __utm.gif hit', category: 'analytics' },
  { id: 'matomo', path: '/adtest/matomo.js', kind: 'script', rule: '/matomo.js$domain=~github.com', label: 'Matomo analytics tracker', category: 'analytics' },
  { id: 'piwik', path: '/adtest/piwik.js', kind: 'script', rule: '/piwik.$image,script,domain=~matomo.org|~piwik.org|~piwik.pro|~piwikpro.de', label: 'Piwik (legacy Matomo) tracker', category: 'analytics' },
  { id: 'mixpanel', path: '/adtest/mixpanel.js', kind: 'script', rule: '/mixpanel.$domain=~mixpanel.com', label: 'Mixpanel product analytics', category: 'analytics' },
  { id: 'chartbeat', path: '/adtest/chartbeat.js', kind: 'script', rule: '/chartbeat.js', label: 'Chartbeat real-time audience tracker', category: 'analytics' },
  { id: 'quantcast', path: '/adtest/quantcast.js', kind: 'script', rule: '/quantcast.js', label: 'Quantcast audience measurement', category: 'analytics' },
  { id: 'adobe-analytics', path: '/adtest/adobe-analytics.js', kind: 'script', rule: '/adobe-analytics.js', label: 'Adobe Analytics (Omniture)', category: 'analytics' },
  { id: 'yandex-metrika', path: '/adtest/yandex-metrika.js', kind: 'script', rule: '/yandex-metrika.js', label: 'Yandex Metrika tracker', category: 'analytics' },
  { id: 'statcounter', path: '/adtest/statcounter.js', kind: 'script', rule: '/statcounter.js', label: 'StatCounter visitor counter', category: 'analytics' },
  { id: 'plausible', path: '/adtest/plausible.js', kind: 'script', rule: '/plausible.js$domain=~plausible.io', label: 'Plausible analytics script', category: 'analytics' },
  { id: 'fingerprint', path: '/adtest/fingerprint.js', kind: 'script', rule: '/fingerprint.js^$domain=~github.com', label: 'Browser fingerprinting library', category: 'analytics' },
  { id: 'segmentio', path: '/adtest/segmentio.js', kind: 'script', rule: '/segmentio.js', label: 'Segment customer-data pipeline', category: 'analytics' },

  // ── Social media pixels ─────────────────────────────────────────────────
  { id: 'fbevents', path: '/adtest/fbevents.js', kind: 'script', rule: '/fbevents.js', label: 'Meta (Facebook) Pixel core script', category: 'social' },
  { id: 'facebook-pixel', path: '/adtest/facebook-pixel.js', kind: 'script', rule: '/facebook-pixel.js', label: 'Facebook pixel plugin script', category: 'social' },
  { id: 'fb-pixel-tracking', path: '/adtest/fb-pixel-tracking.js', kind: 'script', rule: '/fb-pixel-tracking.js', label: 'Facebook pixel event tracking', category: 'social' },
  { id: 'pinterest-pixels', path: '/adtest/pinterest-pixels.js', kind: 'script', rule: '/pinterest-pixels.js', label: 'Pinterest conversion pixels', category: 'social' },
  { id: 'social-tracking', path: '/adtest/social_tracking.js', kind: 'script', rule: '/social_tracking.js', label: 'Social share-button tracking', category: 'social' },
  { id: 'social-tracking-min', path: '/adtest/socialtracking.min.js', kind: 'script', rule: '/socialtracking.min.js', label: 'Social interaction tracker (minified)', category: 'social' },

  // ── Beacons & tracking pixels ───────────────────────────────────────────
  { id: 'pixel-gif', path: '/adtest/pixel.gif', kind: 'image', rule: '/pixel.gif?', label: 'Tracking pixel with a query string', category: 'beacons' },
  { id: 'beacon-gif', path: '/adtest/beacon.gif', kind: 'image', rule: '/beacon.gif?', label: 'Beacon image with a query string', category: 'beacons' },
  { id: '1x1-gif', path: '/adtest/1x1.gif', kind: 'image', rule: '/1x1.gif?', label: '1×1 image with a query string', category: 'beacons' },
  { id: 'tracking-pixel', path: '/adtest/tracking_pixel.gif', kind: 'image', rule: '/tracking_pixel', label: 'Image named tracking_pixel', category: 'beacons' },
  { id: 'event-gif', path: '/adtest/event.gif', kind: 'image', rule: '/event.gif?', label: 'Event-logging pixel', category: 'beacons' },
  { id: 'collect-gif', path: '/adtest/collect.gif', kind: 'image', rule: '/collect.gif?', label: 'Data-collection pixel', category: 'beacons' },
  { id: 'impression-gif', path: '/adtest/impression.gif', kind: 'image', rule: '/impression.gif?', label: 'Ad-impression pixel', category: 'beacons' },
  { id: 'comscore-beacon', path: '/adtest/scorecardresearch/beacon.js', kind: 'script', rule: '/beacon.js', label: 'comScore / ScorecardResearch beacon', category: 'beacons' },
  { id: 'event-tracking', path: '/adtest/event-tracking.js', kind: 'script', rule: '/event-tracking.js', label: 'Event-tracking script', category: 'beacons' },
  { id: 'clicktracking', path: '/adtest/clicktracking.js', kind: 'script', rule: '/clicktracking.js', label: 'Click-tracking script', category: 'beacons' },
];

/**
 * Class names with a bare generic element-hiding rule in the current EasyList
 * (easylist_general_hide.txt). The old "adsbox"/"ad-banner" classics were
 * removed from EasyList years ago and are NOT reliable any more.
 */
export const COSMETIC_BAITS: readonly CosmeticBait[] = [
  { className: 'ad-slot', rule: '##.ad-slot', label: 'Ad slot' },
  { className: 'ad_unit', rule: '##.ad_unit', label: 'Ad unit (underscore)' },
  { className: 'ad-unit', rule: '##.ad-unit', label: 'Ad unit (hyphen)' },
  { className: 'sponsored-links', rule: '##.sponsored-links', label: 'Sponsored links' },
  { className: 'sponsored-ad', rule: '##.sponsored-ad', label: 'Sponsored ad' },
  { className: 'ad_banner', rule: '##.ad_banner', label: 'Ad banner' },
  { className: 'google-ad', rule: '##.google-ad', label: 'Google ad' },
  { className: 'ad-leaderboard', rule: '##.ad-leaderboard', label: 'Leaderboard ad' },
  { className: 'ad-rectangle', rule: '##.ad-rectangle', label: 'Rectangle ad' },
  { className: 'ad-300x250', rule: '##.ad-300x250', label: '300×250 ad' },
  { className: 'dfp-ad', rule: '##.dfp-ad', label: 'DFP ad container' },
  { className: 'ad-wrapper', rule: '##.ad-wrapper', label: 'Ad wrapper' },
];

/** The canonical 43-byte transparent 1×1 GIF89a. */
export const GIF_1X1_BYTES: readonly number[] = [
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, // "GIF89a"
  0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, // 1×1, global colour table of 2
  0xff, 0xff, 0xff, 0x00, 0x00, 0x00, // white, black
  0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, // graphic control: transparent index 0
  0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, // image descriptor
  0x02, 0x02, 0x44, 0x01, 0x00, // LZW data
  0x3b, // trailer
];

/** Same GIF as base64, for tests and for anyone who wants to eyeball it. */
export const GIF_1X1_BASE64 = 'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';

/** The payload of every script bait: proves the script ran (a blocker stub would not set it). */
export function baitScriptSource(id: string): string {
  return `window.__adtest=(window.__adtest||{});window.__adtest['${id}']=1;`;
}

/**
 * The static export is served under /resources (WordPress-layered deploy);
 * server-mode deploys (Vercel, the Pro site, local dev) serve from the root.
 * Resolved from the page's own pathname so one bundle works in both.
 */
export function basePathFrom(pathname: string): string {
  return pathname === '/resources' || pathname.startsWith('/resources/') ? '/resources' : '';
}

/**
 * Probe URL: base path + bait path + a cache-buster. The `?v=` query is
 * deliberate — several generic rules (`/pixel.gif?`, `/js/doubleclick.min.js?v=`)
 * only match when a query string is present, and it defeats the HTTP cache so
 * a re-run really re-requests.
 */
export function baitUrl(base: string, bait: Pick<NetworkBait, 'path'>, runId: string | number): string {
  return `${base}${bait.path}?v=${runId}`;
}

export type BlockingSeverity = 'green' | 'amber' | 'red';

export interface BlockingScore {
  blocked: number;
  allowed: number;
  total: number;
  /** 0–100, rounded. */
  percent: number;
  severity: BlockingSeverity;
}

export function blockedPercent(blocked: number, total: number): number {
  if (total <= 0) return 0;
  const b = Math.max(0, Math.min(blocked, total));
  return Math.round((b / total) * 100);
}

/** green ≥ 90 % blocked, amber 50–89 %, red < 50 %. */
export function severityForPercent(percent: number): BlockingSeverity {
  if (percent >= 90) return 'green';
  if (percent >= 50) return 'amber';
  return 'red';
}

export function scoreAdBlocking(blocked: number, total: number): BlockingScore {
  const t = Math.max(0, total);
  const b = Math.max(0, Math.min(blocked, t));
  const percent = blockedPercent(b, t);
  return { blocked: b, allowed: t - b, total: t, percent, severity: severityForPercent(percent) };
}

/** Result-bus headline: the visitor's own number. */
export function headlineFor(score: BlockingScore): string {
  if (score.total > 0 && score.allowed === 0) return `Your browser blocked all ${score.total} ad and tracker requests`;
  return `Your browser let ${score.allowed} of ${score.total} ad and tracker requests through`;
}

/** Plain-English verdict for the score card. */
export function verdictFor(score: BlockingScore, hiddenElements: number, cosmeticTotal: number): string {
  if (score.total === 0) return 'No requests were probed.';
  const cosmetic = cosmeticTotal > 0
    ? hiddenElements === cosmeticTotal
      ? ` It also hid every one of the ${cosmeticTotal} ad-shaped page elements.`
      : hiddenElements === 0
        ? ` None of the ${cosmeticTotal} ad-shaped page elements were hidden, so cosmetic filtering is off or unsupported.`
        : ` It hid ${hiddenElements} of ${cosmeticTotal} ad-shaped page elements.`
    : '';
  if (score.allowed === 0) {
    return `Excellent — every one of the ${score.total} bait requests was stopped before it left your browser.${cosmetic}`;
  }
  if (score.severity === 'green') {
    return `Strong protection: ${score.blocked} of ${score.total} requests were blocked and only ${score.allowed} slipped through — check the table for the pattern your lists miss.${cosmetic}`;
  }
  if (score.severity === 'amber') {
    return `Partial protection: ${score.allowed} of ${score.total} ad and tracker requests got through. A blocker is running but its filter lists have gaps — make sure EasyPrivacy (or an equivalent tracking list) is enabled alongside EasyList.${cosmetic}`;
  }
  if (score.blocked === 0) {
    return `No ad blocking detected: all ${score.total} bait requests loaded. Either no blocker is installed, it is paused for this site, or it blocks by domain only (DNS-level blockers cannot see URL patterns).${cosmetic}`;
  }
  return `Weak protection: ${score.allowed} of ${score.total} requests got through. Something is filtering, but most generic ad and tracker patterns are not being blocked.${cosmetic}`;
}

export interface CategorySummary {
  category: BaitCategory;
  label: string;
  blocked: number;
  total: number;
}

/** Per-category blocked/total, in display order, from the ids that were blocked. */
export function summarizeByCategory(blockedIds: Iterable<string>, baits: readonly NetworkBait[] = NETWORK_BAITS): CategorySummary[] {
  const blocked = new Set(blockedIds);
  return CATEGORY_ORDER.map((category) => {
    const inCategory = baits.filter((b) => b.category === category);
    return {
      category,
      label: CATEGORY_LABELS[category],
      total: inCategory.length,
      blocked: inCategory.filter((b) => blocked.has(b.id)).length,
    };
  });
}
