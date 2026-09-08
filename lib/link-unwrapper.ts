/**
 * Link Unwrapper — "what does this link know about you?"
 *
 * Pure parsing logic, framework-free, no network. Given a URL pasted from an
 * email, SMS, ad or social post it:
 *
 *   1. Peels redirect wrappers (Google, Facebook, Safe Links, Proofpoint, …)
 *      iteratively, up to MAX_HOPS, purely by decoding the wrapper's own
 *      query/path — nothing is ever fetched.
 *   2. Classifies every query (and fragment) parameter on the final URL as
 *      identity-level (singles out a person or click), campaign-level
 *      (describes the campaign, not the person) or kept (unknown — no claim).
 *   3. Builds a clean URL with tracking parameters removed, and a severity /
 *      headline / share text for the result bus.
 *
 * Everything exported here is deterministic: same input → same output.
 */

export const MAX_HOPS = 5;
export const MAX_INPUT_LENGTH = 4096;

export type ParamClass = 'identity' | 'campaign' | 'kept';
export type LinkSeverity = 'red' | 'amber' | 'green';

export interface TrackerDef {
  vendor: string;
  cls: 'identity' | 'campaign';
  /** One plain-English sentence: what this parameter reveals. */
  reveals: string;
}

const ID = 'identity' as const;
const CAMP = 'campaign' as const;
const t = (vendor: string, cls: 'identity' | 'campaign', reveals: string): TrackerDef => ({ vendor, cls, reveals });

const UTM = 'UTM / Google Analytics';
const GADS = 'Google Ads';
const META = 'Facebook (Meta)';
const HUB = 'HubSpot';
const MC = 'Mailchimp';
const LI = 'LinkedIn';
const EBAY = 'eBay Partner Network';

/**
 * Known tracking parameters. Keys are matched exactly first, then
 * case-insensitively, so `ScCid` and `sccid` both resolve.
 */
export const TRACKING_PARAMS: Record<string, TrackerDef> = {
  // ── UTM family (campaign-level) ─────────────────────────────────────────
  utm_source: t(UTM, CAMP, 'Names the site, newsletter or app the sender expected you to click from.'),
  utm_medium: t(UTM, CAMP, 'Records the channel (email, social, paid ad, QR code) the link was distributed through.'),
  utm_campaign: t(UTM, CAMP, 'Ties your visit to a named marketing campaign so it can be reported on.'),
  utm_term: t(UTM, CAMP, 'Stores the paid search keyword or audience segment the link was bought for.'),
  utm_content: t(UTM, CAMP, 'Identifies which button, image or link variant you clicked inside the same message.'),
  utm_id: t(UTM, CAMP, 'A campaign ID that joins your visit to the campaign cost and audience data in analytics.'),
  ga_source: t(UTM, CAMP, 'Legacy Google Analytics campaign source, the same as utm_source.'),
  ga_medium: t(UTM, CAMP, 'Legacy Google Analytics campaign medium, the same as utm_medium.'),
  ga_campaign: t(UTM, CAMP, 'Legacy Google Analytics campaign name, the same as utm_campaign.'),
  _ga: t('Google Analytics', ID, 'Your Google Analytics client ID, copied across domains so your sessions on both sites can be stitched together.'),
  _gl: t('Google Analytics', ID, 'A Google Analytics cross-domain linker carrying your client ID and session details to the next site.'),

  // ── Ad platform click IDs (identity-level) ─────────────────────────────
  fbclid: t(META, ID, 'A unique Facebook click ID that lets Meta match your visit to the ad you clicked and to your Facebook profile.'),
  gclid: t(GADS, ID, 'A unique Google Ads click ID that links this visit to your ad click and your signed-in Google activity.'),
  gbraid: t(GADS, ID, 'A per-click Google Ads identifier used for iOS app-to-web tracking when device IDs are unavailable.'),
  wbraid: t(GADS, ID, 'A per-click Google Ads identifier used for web-to-app measurement on iOS.'),
  dclid: t('Google Marketing Platform', ID, 'A Display & Video 360 / Campaign Manager click ID that ties the visit to a specific ad impression served to you.'),
  gclsrc: t(GADS, CAMP, 'Says which Google system (Ads, Search Ads 360) generated the click ID travelling with it.'),
  srsltid: t('Google Merchant Center', ID, 'A Google Shopping click ID that links your visit to a specific product-listing click.'),
  msclkid: t('Microsoft Advertising', ID, 'A unique Microsoft (Bing) Ads click ID used to attribute your visit and later purchases to you.'),
  ttclid: t('TikTok', ID, 'A TikTok click ID that lets TikTok match your visit and purchases back to your TikTok account.'),
  twclid: t('X (Twitter)', ID, 'An X click ID that links this visit to your X account and the promoted post you clicked.'),
  li_fat_id: t(LI, ID, 'A LinkedIn first-party ad tracking ID that ties your visit to your LinkedIn profile and the ad you clicked.'),
  yclid: t('Yandex', ID, 'A unique Yandex click ID that attributes your visit to a Yandex ad click.'),
  epik: t('Pinterest', ID, 'A Pinterest click ID (Enhanced Match) used to tie your visit to your Pinterest account.'),
  pp: t('Pinterest', CAMP, 'A Pinterest promoted-pin flag recording that the click came from a paid pin.'),
  sc_cid: t('Snapchat', ID, 'A Snapchat click ID used to match your visit to the Snap ad you clicked.'),
  ScCid: t('Snapchat', ID, 'A Snapchat click ID used to match your visit to the Snap ad you clicked.'),
  rb_clickid: t('Rakuten Advertising', ID, 'A Rakuten affiliate click ID tying this visit to one specific click for commission tracking.'),
  irclickid: t('Impact', ID, 'An Impact affiliate click ID that tracks you from this click through to any purchase.'),
  cjevent: t('CJ Affiliate', ID, 'A CJ affiliate click ID that tracks you from this click through to any purchase.'),
  awc: t('Awin', ID, 'An Awin affiliate click ID that tracks you from this click through to any purchase.'),
  sscid: t('ShareASale', ID, 'A ShareASale affiliate click ID that tracks you from this click through to any purchase.'),
  tduid: t('Tradedoubler', ID, 'A Tradedoubler affiliate click ID that tracks you from this click through to any purchase.'),
  ef_id: t('Adobe Advertising', ID, 'An Adobe Advertising click ID that ties the visit to the ad you clicked.'),

  // ── Ad platform campaign descriptors (campaign-level) ──────────────────
  campaign_id: t('Ad platform', CAMP, 'A campaign ID passed through from an ad platform for attribution.'),
  ad_id: t('Ad platform', CAMP, 'The specific ad creative you clicked, passed through for attribution.'),
  adset_id: t(META, CAMP, 'The Meta ad set (audience and budget group) you were targeted under.'),
  adgroupid: t(GADS, CAMP, 'The Google Ads ad group that targeted you.'),
  keyword: t('Paid search', CAMP, 'The search term you typed that triggered the ad, passed on to the site.'),
  matchtype: t(GADS, CAMP, 'Whether your search matched the ad keyword exactly, by phrase or broadly.'),
  device: t('Ad platform', CAMP, 'The device type (mobile, desktop, tablet) you were targeted on.'),
  placement: t('Ad platform', CAMP, 'The site, app or feed position where the ad you clicked was shown.'),
  cmpid: t('Generic campaign tag', CAMP, 'A campaign ID tying your visit to a marketing effort.'),
  ncid: t('Publisher newsletter', CAMP, 'A publisher newsletter campaign code identifying the mailing this came from.'),
  s_cid: t('Adobe Analytics', CAMP, 'An Adobe Analytics campaign ID identifying the marketing effort behind this link.'),
  s_kwcid: t('Adobe Analytics', CAMP, 'An Adobe Analytics paid-search campaign and keyword code.'),
  wt_mc: t('Webtrends', CAMP, 'A Webtrends marketing campaign code.'),
  at_medium: t('AT Internet (Piano)', CAMP, 'The AT Internet marketing channel for the link.'),
  at_campaign: t('AT Internet (Piano)', CAMP, 'The AT Internet campaign name for the link.'),
  sc_campaign: t('Amazon Web Services', CAMP, 'An AWS marketing campaign identifier for the link.'),
  sc_channel: t('Amazon Web Services', CAMP, 'The AWS marketing channel (email, social, blog) the link was distributed on.'),
  spm: t('Alibaba', CAMP, 'An Alibaba page-position code recording exactly where on the page you clicked.'),
  _openstat: t('Yandex', CAMP, 'A Yandex Openstat campaign code describing the ad, source and placement.'),

  // ── Social share tracking ──────────────────────────────────────────────
  igshid: t('Instagram', ID, 'An Instagram share ID that identifies the account or session that shared the link.'),
  igsh: t('Instagram', ID, 'An Instagram share token that identifies the sharer and the share event.'),
  ref_src: t('X (Twitter)', CAMP, 'Tells the site the click came from X and which X surface it was embedded in.'),
  ref_url: t('X (Twitter)', CAMP, 'Records the page the embedded X content was shown on.'),
  si: t('YouTube / Spotify', ID, 'A share identifier that ties everyone who opens the link back to the account that shared it.'),
  trk: t(LI, CAMP, 'A LinkedIn tracking code recording which LinkedIn surface or feature the link was clicked from.'),
  trkCampaign: t(LI, CAMP, 'The LinkedIn campaign name this link is attributed to.'),

  // ── Email / marketing automation ───────────────────────────────────────
  mc_cid: t(MC, CAMP, 'The Mailchimp campaign ID for the email this link came from.'),
  mc_eid: t(MC, ID, 'Your unique Mailchimp subscriber ID; the site can learn exactly which email address clicked.'),
  _hsenc: t(HUB, ID, 'An encrypted HubSpot token identifying you as one specific contact in the sender CRM.'),
  _hsmi: t(HUB, CAMP, 'The HubSpot email send ID for the message this link came from.'),
  hsCtaTracking: t(HUB, CAMP, 'Identifies the HubSpot call-to-action button you clicked so clicks can be attributed to it.'),
  __hssc: t(HUB, ID, 'HubSpot session data carried across domains so your session can be continued and counted.'),
  __hstc: t(HUB, ID, 'The HubSpot visitor tracking cookie, including your unique visitor token and first-visit timestamp.'),
  __hsfp: t(HUB, ID, 'A HubSpot browser fingerprint hash used to recognise your device across sites.'),
  vero_id: t('Vero', ID, 'Your unique Vero customer ID, identifying you as one specific email recipient.'),
  vero_conv: t('Vero', ID, 'A Vero conversion token tying this visit back to the exact message that was sent to you.'),
  mkt_tok: t('Marketo', ID, 'A Marketo token that identifies you as a specific lead and the email that was sent to you.'),
  oly_anon_id: t('Omeda', ID, 'An Omeda anonymous visitor ID used to recognise you across the publisher sites.'),
  oly_enc_id: t('Omeda', ID, 'An encrypted Omeda customer ID that identifies you as a known subscriber.'),
  ck_subscriber_id: t('Kit (ConvertKit)', ID, 'Your unique Kit subscriber ID; the site can learn which email address clicked.'),
  vgo_ee: t('ActiveCampaign', ID, 'An encrypted ActiveCampaign contact token that identifies you as one specific email recipient.'),
  _kx: t('Klaviyo', ID, 'A Klaviyo identity token that links this visit to your customer profile and email address.'),
  ss_source: t('Squarespace', CAMP, 'The Squarespace email campaign source for this link.'),
  ss_campaign_id: t('Squarespace', CAMP, 'The Squarespace email campaign ID for this link.'),

  // ── Deep-link / app attribution ────────────────────────────────────────
  _branch_match_id: t('Branch', ID, 'A Branch deep-link match ID used to fingerprint your device and keep tracking you after an app install.'),
  _branch_referrer: t('Branch', CAMP, 'Encoded Branch referral data describing who sent you and from which channel.'),

  // ── eBay Partner Network ───────────────────────────────────────────────
  mkevt: t(EBAY, ID, 'Marks this as a tracked eBay affiliate click so your later purchases can be credited to the referrer.'),
  mkcid: t(EBAY, CAMP, 'The eBay Partner Network channel ID for the affiliate link.'),
  mkrid: t(EBAY, CAMP, 'The eBay rotation ID identifying the affiliate site and region.'),
  campid: t(EBAY, CAMP, 'The eBay Partner Network campaign ID for the affiliate.'),
  toolid: t(EBAY, CAMP, 'The eBay Partner Network tool that generated the link.'),
  customid: t(EBAY, ID, 'A custom affiliate ID that publishers can set per user or per email to identify who clicked.'),
};

const LOWER_LOOKUP: Record<string, TrackerDef> = {};
for (const k of Object.keys(TRACKING_PARAMS)) LOWER_LOOKUP[k.toLowerCase()] = TRACKING_PARAMS[k];

const GENERIC_UTM: TrackerDef = t(UTM, CAMP, 'A custom UTM campaign field describing where and why the link was sent.');

/** Look up a parameter name; exact match, then case-insensitive, then the utm_* prefix rule. */
export function lookupParam(key: string): TrackerDef | null {
  if (Object.prototype.hasOwnProperty.call(TRACKING_PARAMS, key)) return TRACKING_PARAMS[key];
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(LOWER_LOOKUP, lower)) return LOWER_LOOKUP[lower];
  if (lower.startsWith('utm_')) return GENERIC_UTM;
  return null;
}

// ── Low-level helpers ────────────────────────────────────────────────────

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function parseHttpUrl(s: string): URL | null {
  try {
    const u = new URL(s);
    if ((u.protocol === 'http:' || u.protocol === 'https:') && u.hostname) return u;
    return null;
  } catch {
    return null;
  }
}

/** Decode standard or URL-safe base64 to a UTF-8 string, or null if it is not valid base64. */
export function base64Decode(input: string): string | null {
  const norm = input.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (!norm || !/^[A-Za-z0-9+/]+$/.test(norm)) return null;
  if (norm.length % 4 === 1) return null;
  const padded = norm + '='.repeat((4 - (norm.length % 4)) % 4);
  try {
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * Turn a redirect parameter value into an absolute http(s) URL if it is one:
 * as-is, percent-decoded (once or twice), or base64 / base64url encoded.
 */
export function decodeTarget(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const candidates = [raw, safeDecode(raw), safeDecode(safeDecode(raw))];
  for (const c of candidates) {
    const s = c.trim();
    if (/^https?:\/\//i.test(s)) {
      const u = parseHttpUrl(s);
      if (u) return u.href;
    }
  }
  const trimmed = raw.trim();
  if (trimmed.length >= 12) {
    const decoded = base64Decode(trimmed);
    if (decoded && /^https?:\/\//i.test(decoded)) {
      const u = parseHttpUrl(decoded.trim());
      if (u) return u.href;
    }
  }
  return null;
}

// ── Redirect wrappers ────────────────────────────────────────────────────

export interface Hop {
  url: string;
  host: string;
  /** Vendor name when this hop is a redirect wrapper pointing at the next hop. */
  wrapper?: string;
}

export interface UnwrapResult {
  hops: Hop[];
  finalUrl: string;
  redirectCount: number;
  hitHopLimit: boolean;
  /** A wrapper we recognised but could not decode; the wrapped host is shown when it can be read. */
  opaque?: { vendor: string; wrappedHost?: string };
}

interface WrapperMatch {
  vendor: string;
  target: string | null;
  wrappedHost?: string;
}

/** Proofpoint URL Defense v2: `-` was `%`, `_` was `/`. */
export function decodeProofpointV2(u: string): string | null {
  const swapped = u.replace(/-/g, '%').replace(/_/g, '/');
  const decoded = safeDecode(swapped);
  const url = parseHttpUrl(decoded);
  return url ? url.href : null;
}

const V3_RUN_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Proofpoint URL Defense v3: `__url__;payload!!…`. Special characters in the
 * URL are replaced by `*` (one char) or `**X` (a run of N chars, N encoded by X)
 * and the replaced characters are base64url-encoded in the payload.
 */
export function decodeProofpointV3(href: string): { url: string | null; wrappedHost?: string } {
  const m = /\/v3\/__(.+?)__;([A-Za-z0-9_-]*)/.exec(href);
  if (!m) return { url: null };
  const encodedUrl = safeDecode(m[1]);
  const hostMatch = /^https?:\/\/([^/?#*]+)/i.exec(encodedUrl);
  const wrappedHost = hostMatch ? hostMatch[1].toLowerCase() : undefined;
  const dec = m[2] ? base64Decode(m[2]) : '';
  if (dec === null) return { url: null, wrappedHost };
  let i = 0;
  let bad = false;
  const out = encodedUrl.replace(/\*(\*.)?/g, (tok) => {
    if (tok === '*') {
      if (i >= dec.length) {
        bad = true;
        return '';
      }
      return dec[i++];
    }
    const n = V3_RUN_CHARS.indexOf(tok[2]) + 2;
    if (n < 2 || i + n > dec.length) {
      bad = true;
      return '';
    }
    const run = dec.slice(i, i + n);
    i += n;
    return run;
  });
  if (bad) return { url: null, wrappedHost };
  const u = parseHttpUrl(out);
  return { url: u ? u.href : null, wrappedHost };
}

const GENERIC_PATH = /\/(redirect|redir|click|track|link)/i;
const GENERIC_KEYS = ['u', 'url', 'redirect', 'redirect_url', 'target', 'dest', 'destination', 'to', 'goto', 'link', 'r', 'q'];

function firstTarget(sp: URLSearchParams, keys: string[]): string | null {
  for (const k of keys) {
    const v = decodeTarget(sp.get(k));
    if (v) return v;
  }
  return null;
}

/** Identify a redirect wrapper and decode its destination. Null when the URL is not a wrapper. */
export function matchWrapper(u: URL): WrapperMatch | null {
  const host = u.hostname.toLowerCase();
  const path = u.pathname;
  const sp = u.searchParams;

  // Proofpoint URL Defense
  if (host === 'urldefense.proofpoint.com' || host === 'urldefense.com') {
    if (path.startsWith('/v2/url')) {
      const raw = sp.get('u');
      return { vendor: 'Proofpoint', target: raw ? decodeProofpointV2(raw) : null };
    }
    if (path.startsWith('/v3/')) {
      const r = decodeProofpointV3(u.href);
      return { vendor: 'Proofpoint', target: r.url, wrappedHost: r.wrappedHost };
    }
    return null;
  }

  // Microsoft Safe Links
  if (host.endsWith('.safelinks.protection.outlook.com')) {
    return { vendor: 'Microsoft Safe Links', target: firstTarget(sp, ['url']) };
  }

  // Google (google.com, google.co.uk, google.de, …) /url?q= or url=
  if (/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && path === '/url') {
    return { vendor: 'Google', target: firstTarget(sp, ['q', 'url']) };
  }

  // Facebook / Messenger link shim
  if ((host === 'l.facebook.com' || host === 'lm.facebook.com' || host === 'l.messenger.com') && path === '/l.php') {
    return { vendor: 'Facebook', target: firstTarget(sp, ['u']) };
  }

  // Instagram link shim
  if (host === 'l.instagram.com') {
    return { vendor: 'Instagram', target: firstTarget(sp, ['u']) };
  }

  // LinkedIn
  if (/(^|\.)linkedin\.com$/.test(host) && path.startsWith('/redir/redirect')) {
    return { vendor: 'LinkedIn', target: firstTarget(sp, ['url']) };
  }

  // YouTube
  if (/(^|\.)youtube\.com$/.test(host) && path === '/redirect') {
    return { vendor: 'YouTube', target: firstTarget(sp, ['q']) };
  }

  // Tumblr
  if (host === 't.umblr.com' && path === '/redirect') {
    return { vendor: 'Tumblr', target: firstTarget(sp, ['z']) };
  }

  // VK
  if (host === 'away.vk.com' && path === '/away.php') {
    return { vendor: 'VK', target: firstTarget(sp, ['to']) };
  }

  // Bing search result click: u=a1<base64url>
  if (/(^|\.)bing\.com$/.test(host) && path.startsWith('/ck/a')) {
    const raw = sp.get('u') || '';
    const stripped = raw.startsWith('a1') ? raw.slice(2) : raw;
    return { vendor: 'Bing', target: decodeTarget(stripped) };
  }

  // Slack
  if (host === 'slack-redir.net' && path === '/link') {
    return { vendor: 'Slack', target: firstTarget(sp, ['url']) };
  }

  // Reddit outbound
  if (host === 'out.reddit.com') {
    return { vendor: 'Reddit', target: firstTarget(sp, ['url']) };
  }

  // Generic: any host with a redirect-ish path and a known key holding an absolute URL
  if (GENERIC_PATH.test(path)) {
    const target = firstTarget(sp, GENERIC_KEYS);
    if (target) return { vendor: 'Generic redirect', target };
  }

  return null;
}

/** Peel redirect wrappers iteratively, purely by parsing. Never fetches. */
export function unwrapRedirects(startUrl: string, maxHops: number = MAX_HOPS): UnwrapResult {
  const hops: Hop[] = [];
  const seen = new Set<string>([startUrl]);
  let current = startUrl;
  let hitHopLimit = false;
  let opaque: UnwrapResult['opaque'];

  for (let i = 0; ; i++) {
    const u = parseHttpUrl(current);
    if (!u) {
      hops.push({ url: current, host: '' });
      break;
    }
    const match = matchWrapper(u);
    if (!match) {
      hops.push({ url: current, host: u.hostname });
      break;
    }
    if (!match.target) {
      hops.push({ url: current, host: u.hostname, wrapper: match.vendor });
      opaque = { vendor: match.vendor, wrappedHost: match.wrappedHost };
      break;
    }
    if (seen.has(match.target)) {
      // Self-referencing or cyclic wrapper: treat this hop as the end of the line.
      hops.push({ url: current, host: u.hostname });
      break;
    }
    if (i >= maxHops) {
      hops.push({ url: current, host: u.hostname, wrapper: match.vendor });
      hitHopLimit = true;
      break;
    }
    hops.push({ url: current, host: u.hostname, wrapper: match.vendor });
    seen.add(match.target);
    current = match.target;
  }

  return {
    hops,
    finalUrl: hops[hops.length - 1].url,
    redirectCount: hops.length - 1,
    hitHopLimit,
    opaque,
  };
}

/** Shorteners and mail-gateway hosts whose destination cannot be read without fetching. */
const OPAQUE_HOSTS = new Set([
  't.co', 'bit.ly', 'lnkd.in', 'goo.gl', 'tinyurl.com', 'ow.ly', 'buff.ly', 'rb.gy', 'cutt.ly',
  'is.gd', 'tiny.cc', 'rebrand.ly', 'shorturl.at', 'amzn.to', 'trib.al', 'dlvr.it', 'lnk.to',
]);

export function isOpaqueRedirector(host: string): boolean {
  const h = host.toLowerCase();
  if (OPAQUE_HOSTS.has(h)) return true;
  if (h.endsWith('.ct.sendgrid.net')) return true;
  if (/^protect-[a-z0-9]+\.mimecast\.com$/.test(h)) return true;
  if (/^[a-z0-9-]+\.mkt\d+\.com$/.test(h)) return true;
  return false;
}

// ── Parameter classification + clean URL ─────────────────────────────────

export interface ClassifiedParam {
  key: string;
  value: string;
  cls: ParamClass;
  vendor?: string;
  reveals?: string;
  where: 'query' | 'fragment';
}

interface RawPair {
  raw: string;
  key: string;
  value: string;
}

function splitPairs(qs: string): RawPair[] {
  if (!qs) return [];
  return qs
    .split('&')
    .filter((s) => s.length > 0)
    .map((raw) => {
      const eq = raw.indexOf('=');
      const k = eq < 0 ? raw : raw.slice(0, eq);
      const v = eq < 0 ? '' : raw.slice(eq + 1);
      return { raw, key: safeDecode(k.replace(/\+/g, ' ')), value: safeDecode(v.replace(/\+/g, ' ')) };
    });
}

/** Split a fragment (without `#`) into a non-param prefix and any key=value pairs it carries. */
function splitFragment(hash: string): { prefix: string; pairs: RawPair[] } {
  if (!hash) return { prefix: '', pairs: [] };
  const q = hash.indexOf('?');
  if (q >= 0) return { prefix: hash.slice(0, q + 1), pairs: splitPairs(hash.slice(q + 1)) };
  if (/^[^=&]+=[^&]*(&[^&]*)*$/.test(hash)) return { prefix: '', pairs: splitPairs(hash) };
  return { prefix: hash, pairs: [] };
}

export interface ParamAnalysis {
  params: ClassifiedParam[];
  cleanUrl: string;
  removedCount: number;
  keptCount: number;
}

/** Classify every query and fragment parameter on `finalUrl` and build the clean URL. */
export function analyzeParams(finalUrl: string): ParamAnalysis {
  const u = parseHttpUrl(finalUrl);
  if (!u) return { params: [], cleanUrl: finalUrl, removedCount: 0, keptCount: 0 };

  const params: ClassifiedParam[] = [];
  const keptQuery: string[] = [];
  const keptFrag: string[] = [];
  let removed = 0;

  for (const p of splitPairs(u.search.slice(1))) {
    const def = lookupParam(p.key);
    if (def) {
      params.push({ key: p.key, value: p.value, cls: def.cls, vendor: def.vendor, reveals: def.reveals, where: 'query' });
      removed++;
    } else {
      params.push({ key: p.key, value: p.value, cls: 'kept', where: 'query' });
      keptQuery.push(p.raw);
    }
  }

  const { prefix, pairs: fragPairs } = splitFragment(u.hash.slice(1));
  for (const p of fragPairs) {
    const def = lookupParam(p.key);
    if (def) {
      params.push({ key: p.key, value: p.value, cls: def.cls, vendor: def.vendor, reveals: def.reveals, where: 'fragment' });
      removed++;
    } else {
      params.push({ key: p.key, value: p.value, cls: 'kept', where: 'fragment' });
      keptFrag.push(p.raw);
    }
  }

  const search = keptQuery.length ? '?' + keptQuery.join('&') : '';
  let hash = '';
  if (prefix || keptFrag.length) {
    let h = prefix + keptFrag.join('&');
    if (h.endsWith('?') && keptFrag.length === 0) h = h.slice(0, -1);
    hash = h ? '#' + h : '';
  }

  return {
    params,
    cleanUrl: u.origin + u.pathname + search + hash,
    removedCount: removed,
    keptCount: keptQuery.length + keptFrag.length,
  };
}

// ── Input normalisation ──────────────────────────────────────────────────

export type NormalizedInput = { ok: true; url: string } | { ok: false; error: string };

export function normalizeInput(raw: string): NormalizedInput {
  let s = (raw || '').trim();
  if (!s) return { ok: false, error: 'Paste a link to unwrap.' };
  if (s.length > MAX_INPUT_LENGTH) {
    return { ok: false, error: `That input is ${s.length} characters long; the limit is ${MAX_INPUT_LENGTH}. Paste a single link.` };
  }
  s = s.replace(/^<+|>+$/g, '').replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (!s) return { ok: false, error: 'Paste a link to unwrap.' };

  const scheme = /^([a-z][a-z0-9+.-]*):(\/\/)?/i.exec(s);
  const NON_WEB = /^(mailto|tel|sms|javascript|data|ftp|file|ws|wss|blob|about|chrome|intent)$/i;
  if (scheme && (scheme[2] || NON_WEB.test(scheme[1]))) {
    const sc = scheme[1].toLowerCase();
    if (sc !== 'http' && sc !== 'https') {
      return { ok: false, error: `${sc}: links are not supported. Paste an http or https link.` };
    }
  } else if (s.startsWith('//')) {
    s = 'https:' + s;
  } else {
    s = 'https://' + s;
  }

  const u = parseHttpUrl(s);
  if (!u) return { ok: false, error: 'That does not look like a valid web address. Check for stray spaces or missing characters.' };
  return { ok: true, url: u.href };
}

// ── Full analysis ────────────────────────────────────────────────────────

export interface LinkStat {
  label: string;
  value: string;
}

export interface LinkAnalysis {
  ok: true;
  input: string;
  startUrl: string;
  hops: Hop[];
  redirectCount: number;
  hitHopLimit: boolean;
  opaqueWrapper?: { vendor: string; wrappedHost?: string };
  hiddenDestination?: { host: string };
  finalUrl: string;
  finalHost: string;
  params: ClassifiedParam[];
  trackerCount: number;
  identityCount: number;
  campaignCount: number;
  keptCount: number;
  vendors: string[];
  identityVendors: string[];
  cleanUrl: string;
  removedCount: number;
  charsRemoved: number;
  severity: LinkSeverity;
  headline: string;
  detail: string;
  shareText: string;
  stats: LinkStat[];
}

export interface LinkError {
  ok: false;
  error: string;
}

export type LinkResult = LinkAnalysis | LinkError;

const plural = (n: number, one: string, many?: string) => `${n} ${n === 1 ? one : many ?? one + 's'}`;

function uniq(list: string[]): string[] {
  const out: string[] = [];
  for (const s of list) if (!out.includes(s)) out.push(s);
  return out;
}

export function analyzeLink(raw: string): LinkResult {
  const norm = normalizeInput(raw);
  if (!norm.ok) return { ok: false, error: norm.error };

  const unwrap = unwrapRedirects(norm.url);
  const finalUrl = unwrap.finalUrl;
  const finalParsed = parseHttpUrl(finalUrl);
  const finalHost = finalParsed ? finalParsed.hostname : '';
  const pa = analyzeParams(finalUrl);

  const identity = pa.params.filter((p) => p.cls === 'identity');
  const campaign = pa.params.filter((p) => p.cls === 'campaign');
  const trackers = identity.length + campaign.length;
  const vendors = uniq([...identity, ...campaign].map((p) => p.vendor || 'Unknown'));
  const identityVendors = uniq(identity.map((p) => p.vendor || 'Unknown'));
  const redirects = unwrap.redirectCount;
  const hidden = finalHost && isOpaqueRedirector(finalHost) ? { host: finalHost } : undefined;
  // Any redirect layer counts as wrapping: decoded hops, a wrapper we could not
  // decode, or a shortener whose destination is unknowable without fetching.
  const wrapped = redirects > 0 || !!unwrap.opaque || !!hidden;

  const severity: LinkSeverity = identity.length > 0 ? 'red' : trackers > 0 || wrapped ? 'amber' : 'green';

  let headline: string;
  if (trackers > 0) {
    headline = `This link carried ${plural(trackers, 'tracker')} from ${plural(vendors.length, 'vendor')}`;
    if (redirects > 0) headline += ` across ${plural(redirects, 'redirect')}`;
  } else if (redirects > 0) {
    headline = `This link passed through ${plural(redirects, 'redirect')} but carried no trackers`;
  } else if (unwrap.opaque) {
    headline = `This link is wrapped by ${unwrap.opaque.vendor} and could not be fully decoded`;
  } else if (hidden) {
    headline = `This link hides its destination behind ${hidden.host}`;
  } else {
    headline = 'This link is clean';
  }

  let detail: string;
  let shareText: string;
  if (identity.length > 0) {
    const who = identityVendors.join(', ');
    detail = `${plural(identity.length, 'identity-level ID')} (${who}) can tie this click to you personally.`;
    shareText = `${headline}. ${identity.length === 1 ? '1 of them was an identity-level click ID' : `${identity.length} of them were identity-level click IDs`} (${who}) that ties the click to me personally. Unwrapped and cleaned it before opening.`;
  } else if (trackers > 0) {
    detail = `Campaign tags only. They describe the campaign, not you, but they still tell ${finalHost} exactly where the link came from.`;
    shareText = `${headline}. Campaign tags only, but they still tell ${finalHost} where I came from. Cleaned it before opening.`;
  } else if (redirects > 0) {
    detail = 'Every redirect hop logs your click before sending you on. No tracking parameters reached the destination.';
    shareText = `${headline}. Each hop logged my click on the way through. Unwrapped it before opening.`;
  } else if (unwrap.opaque) {
    detail = unwrap.opaque.wrappedHost
      ? `The wrapper hides the full destination, but it points at ${unwrap.opaque.wrappedHost}.`
      : 'The wrapper encodes its destination in a form that cannot be decoded without fetching it.';
    shareText = `${headline}. The destination is hidden inside the wrapper.`;
  } else if (hidden) {
    detail = `${hidden.host} logs every click and only reveals the real destination when you open it, so any trackers waiting there are still unknown. This tool never fetches.`;
    shareText = `${headline}. Shorteners log every click and hide what is waiting on the other side.`;
  } else {
    detail = 'No redirect wrappers and no tracking parameters found.';
    shareText = 'This link is clean: no redirect wrappers, no tracking parameters. Rare.';
  }

  return {
    ok: true,
    input: raw.trim(),
    startUrl: norm.url,
    hops: unwrap.hops,
    redirectCount: redirects,
    hitHopLimit: unwrap.hitHopLimit,
    opaqueWrapper: unwrap.opaque,
    hiddenDestination: hidden,
    finalUrl,
    finalHost,
    params: pa.params,
    trackerCount: trackers,
    identityCount: identity.length,
    campaignCount: campaign.length,
    keptCount: pa.keptCount,
    vendors,
    identityVendors,
    cleanUrl: pa.cleanUrl,
    removedCount: pa.removedCount,
    charsRemoved: Math.max(0, norm.url.length - pa.cleanUrl.length),
    severity,
    headline,
    detail,
    shareText,
    stats: [
      { label: 'Trackers', value: String(trackers) },
      { label: 'Vendors', value: String(vendors.length) },
      { label: 'Redirect hops', value: String(redirects) },
      { label: 'Identity IDs', value: String(identity.length) },
    ],
  };
}
