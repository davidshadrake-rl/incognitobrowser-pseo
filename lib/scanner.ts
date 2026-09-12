/**
 * Scanner core — the ONE implementation of "what does this page do to a
 * visitor before they click anything": cookie classification, tracker
 * detection, third-party script census, security headers.
 *
 * Used by two callers with different fetch policies:
 *   - app/scan-url/route.ts — the public API (rate-limited, PoW-gated,
 *     SSRF-guarded, manual redirects so shorteners can be unfurled).
 *   - scripts/scan-sites.mts — the offline batch that produces the Site
 *     Privacy Report Cards (follows redirects, no rate limit, writes
 *     data/sites/*.json).
 *
 * Both call analyzeScan() on the fetched Response + capped HTML, so the
 * public tool and the published report cards detect the same cookies and
 * trackers. Scoring is NOT shared: the tool grades with its own rules
 * (CookieAnalyzerTool) and the report cards with lib/site-grade, so their
 * grades for one site can differ.
 *
 * Extracted verbatim from the route on 2026-09-07; validation, error
 * handling, and the fetch itself deliberately stayed in the route.
 */

export type TrackerCategory = 'tracking' | 'analytics' | 'functional';
export type Risk = 'high' | 'medium' | 'low';

export interface TrackerPattern {
  pattern: RegExp;
  name: string;
  category: TrackerCategory;
  risk: Risk;
  description: string;
}

// Known tracking script patterns to look for in HTML
export const TRACKER_PATTERNS: TrackerPattern[] = [
  // Ad tracking
  { pattern: /google-analytics\.com|googletagmanager\.com|gtag\/js/i, name: 'Google Analytics / GTM', category: 'analytics', risk: 'medium', description: 'Google Analytics or Tag Manager — collects page views, user behavior, demographics' },
  { pattern: /connect\.facebook\.net|fbevents\.js|fbq\(/i, name: 'Facebook Pixel', category: 'tracking', risk: 'high', description: 'Facebook/Meta Pixel — tracks conversions and builds ad audiences across the web' },
  { pattern: /snap\.licdn\.com|linkedin\.com\/px|px\.ads\.linkedin\.com/i, name: 'LinkedIn Insight', category: 'tracking', risk: 'high', description: 'LinkedIn Insight Tag — tracks conversions and retargets LinkedIn users' },
  { pattern: /ads-twitter\.com|static\.ads-twitter\.com|twq\(/i, name: 'Twitter/X Pixel', category: 'tracking', risk: 'high', description: 'Twitter/X conversion tracking pixel — measures ad performance' },
  { pattern: /analytics\.tiktok\.com|tiktok\.com\/i18n\/pixel/i, name: 'TikTok Pixel', category: 'tracking', risk: 'high', description: 'TikTok Pixel — tracks user activity for ad targeting on TikTok' },
  { pattern: /pinterest\.com\/ct\.html|pintrk\(/i, name: 'Pinterest Tag', category: 'tracking', risk: 'high', description: 'Pinterest conversion tracking tag' },
  { pattern: /googlesyndication\.com|adsbygoogle/i, name: 'Google AdSense', category: 'tracking', risk: 'high', description: 'Google AdSense — serves personalized display ads' },
  { pattern: /doubleclick\.net/i, name: 'Google DoubleClick', category: 'tracking', risk: 'high', description: 'Google DoubleClick — ad serving and cross-site tracking' },
  { pattern: /amazon-adsystem\.com/i, name: 'Amazon Ads', category: 'tracking', risk: 'high', description: 'Amazon advertising pixel — tracks shopping behavior for ad targeting' },
  { pattern: /criteo\.com|criteo\.net/i, name: 'Criteo', category: 'tracking', risk: 'high', description: 'Criteo retargeting — follows you across sites to show personalized ads' },
  { pattern: /taboola\.com/i, name: 'Taboola', category: 'tracking', risk: 'high', description: 'Taboola content recommendation — tracks browsing for ad personalization' },
  { pattern: /outbrain\.com/i, name: 'Outbrain', category: 'tracking', risk: 'high', description: 'Outbrain content recommendation and native advertising tracker' },
  // Ad tech and marketing tags added 2026-09-11 from the script domains the
  // 500 report cards loaded that no pattern matched (funnel pilot: cards that
  // load them read cleaner than they are). Hostname-specific where the vendor's
  // own site is on another domain, so a link to the vendor is not a match.
  { pattern: /quantserve\.com/i, name: 'Quantcast', category: 'tracking', risk: 'high', description: 'Quantcast pixel — measures audiences and builds ad-targeting segments' },
  { pattern: /adnxs\.com|adsdk\.microsoft\.com/i, name: 'Xandr (Microsoft)', category: 'tracking', risk: 'high', description: 'Xandr (formerly AppNexus), Microsoft\'s ad platform — serves and auctions display ads' },
  { pattern: /rubiconproject\.com/i, name: 'Magnite (Rubicon Project)', category: 'tracking', risk: 'high', description: 'Magnite ad exchange — runs real-time auctions for the ads on the page' },
  { pattern: /pubmatic\.com/i, name: 'PubMatic', category: 'tracking', risk: 'high', description: 'PubMatic ad exchange — runs real-time auctions for the ads on the page' },
  { pattern: /casalemedia\.com|indexww\.com/i, name: 'Index Exchange', category: 'tracking', risk: 'high', description: 'Index Exchange ad exchange — runs real-time auctions for the ads on the page' },
  { pattern: /adsrvr\.org/i, name: 'The Trade Desk', category: 'tracking', risk: 'high', description: 'The Trade Desk — ad-buying platform that recognizes visitors for ad targeting' },
  { pattern: /liadm\.com/i, name: 'LiveIntent', category: 'tracking', risk: 'high', description: 'LiveIntent — identity tag that recognizes visitors for email and display ad targeting' },
  { pattern: /rlcdn\.com|ats-wrapper\.privacymanager\.io/i, name: 'LiveRamp', category: 'tracking', risk: 'high', description: 'LiveRamp identity (ATS) — turns sign-in emails into an ID that ad platforms can target' },
  { pattern: /permutive\.(?:app|com)/i, name: 'Permutive', category: 'tracking', risk: 'high', description: 'Permutive — publisher data platform that sorts visitors into audience segments for ad targeting' },
  { pattern: /googletagservices\.com/i, name: 'Google Publisher Tag', category: 'tracking', risk: 'high', description: 'Google Publisher Tag — loads Google Ad Manager display ads' },
  { pattern: /\ba\.pub\.network/i, name: 'Freestar', category: 'tracking', risk: 'high', description: 'Freestar — ad-monetization script that runs header-bidding ad auctions' },
  { pattern: /btloader\.com/i, name: 'Blockthrough', category: 'tracking', risk: 'medium', description: 'Blockthrough — ad-recovery script that shows ads to visitors who use an ad blocker' },
  { pattern: /bounceexchange\.com|bouncex\.net/i, name: 'Wunderkind (BounceX)', category: 'tracking', risk: 'high', description: 'Wunderkind (formerly BounceX) — marketing tag that identifies visitors for email and ad retargeting' },
  { pattern: /\bntv\.io/i, name: 'Nativo', category: 'tracking', risk: 'high', description: 'Nativo — native-advertising platform that serves sponsored content' },
  { pattern: /dianomi\.com/i, name: 'Dianomi', category: 'tracking', risk: 'high', description: 'Dianomi — native-advertising widget that serves sponsored content' },
  { pattern: /yieldlove\.com/i, name: 'Yieldlove', category: 'tracking', risk: 'high', description: 'Yieldlove — header-bidding ad monetization' },
  { pattern: /relevant-digital\.com/i, name: 'Relevant Digital', category: 'tracking', risk: 'high', description: 'Relevant Digital (Relevant Yield) — header-bidding ad monetization' },
  { pattern: /servenobid\.com/i, name: 'NoBid', category: 'tracking', risk: 'high', description: 'NoBid ad exchange — runs header-bidding ad auctions' },
  { pattern: /s-onetag\.com/i, name: 'OneTag', category: 'tracking', risk: 'high', description: 'OneTag ad exchange — runs header-bidding ad auctions' },
  { pattern: /sascdn\.com|smartadserver\.com/i, name: 'Equativ (Smart AdServer)', category: 'tracking', risk: 'high', description: 'Equativ (formerly Smart AdServer) — ad server and ad exchange' },
  { pattern: /serving-sys\.com/i, name: 'Amazon Ad Server (Sizmek)', category: 'tracking', risk: 'high', description: 'Amazon Ad Server (formerly Sizmek) — ad serving and conversion tracking' },
  { pattern: /xg4ken\.com/i, name: 'Skai (Kenshoo)', category: 'tracking', risk: 'high', description: 'Skai (formerly Kenshoo) — ad-campaign conversion tracking' },
  { pattern: /bat\.bing\.com/i, name: 'Microsoft Advertising UET', category: 'tracking', risk: 'high', description: 'Microsoft Advertising Universal Event Tracking — tracks conversions and builds remarketing audiences' },
  { pattern: /redditstatic\.com\/ads\/|alb\.reddit\.com/i, name: 'Reddit Pixel', category: 'tracking', risk: 'high', description: 'Reddit Pixel — tracks conversions and builds ad audiences on Reddit' },
  { pattern: /moatads\.com/i, name: 'Moat (Oracle)', category: 'tracking', risk: 'medium', description: 'Moat (Oracle) — measures ad viewability and attention' },
  { pattern: /doubleverify\.com/i, name: 'DoubleVerify', category: 'tracking', risk: 'medium', description: 'DoubleVerify — ad-verification script that measures ad viewability and checks for ad fraud' },
  { pattern: /adsafeprotected\.com/i, name: 'Integral Ad Science', category: 'tracking', risk: 'medium', description: 'Integral Ad Science — ad-verification script that measures ad viewability and checks for ad fraud' },

  // Analytics
  { pattern: /hotjar\.com|static\.hotjar\.com/i, name: 'Hotjar', category: 'analytics', risk: 'medium', description: 'Hotjar — records user sessions, heatmaps, and click tracking' },
  { pattern: /fullstory\.com/i, name: 'FullStory', category: 'analytics', risk: 'medium', description: 'FullStory — full session replay and user behavior recording' },
  { pattern: /clarity\.ms/i, name: 'Microsoft Clarity', category: 'analytics', risk: 'medium', description: 'Microsoft Clarity — free session recording and heatmap analytics' },
  { pattern: /mixpanel\.com/i, name: 'Mixpanel', category: 'analytics', risk: 'medium', description: 'Mixpanel — product analytics and user event tracking' },
  { pattern: /segment\.com|segment\.io|cdn\.segment/i, name: 'Segment', category: 'analytics', risk: 'medium', description: 'Segment — customer data platform that pipes data to many services' },
  { pattern: /amplitude\.com/i, name: 'Amplitude', category: 'analytics', risk: 'medium', description: 'Amplitude — product analytics and user behavior tracking' },
  { pattern: /plausible\.io/i, name: 'Plausible', category: 'analytics', risk: 'low', description: 'Plausible — privacy-friendly analytics (no cookies, GDPR compliant)' },
  { pattern: /umami\.is|analytics\.umami/i, name: 'Umami', category: 'analytics', risk: 'low', description: 'Umami — open-source, privacy-focused web analytics' },
  { pattern: /heap\.io|heapanalytics/i, name: 'Heap', category: 'analytics', risk: 'medium', description: 'Heap — auto-captures all user interactions for analytics' },
  { pattern: /mouseflow\.com/i, name: 'Mouseflow', category: 'analytics', risk: 'medium', description: 'Mouseflow — session replay, heatmaps, and funnel analytics' },
  { pattern: /logrocket\.com|logrocket\.io/i, name: 'LogRocket', category: 'analytics', risk: 'medium', description: 'LogRocket — session replay with network request logging' },
  { pattern: /sentry\.io|browser\.sentry-cdn/i, name: 'Sentry', category: 'functional', risk: 'low', description: 'Sentry — error monitoring and performance tracking (developer tool)' },
  // Added 2026-09-11 with the ad tech above. Tag managers count as analytics,
  // as Google Tag Manager does: they exist to load analytics and marketing tags.
  { pattern: /scorecardresearch\.com/i, name: 'comScore', category: 'analytics', risk: 'medium', description: 'comScore (Scorecard Research) beacon — reports your visit for comScore\'s cross-site audience measurement' },
  { pattern: /static\.chartbeat\.com|chartbeat\.net/i, name: 'Chartbeat', category: 'analytics', risk: 'medium', description: 'Chartbeat — real-time audience analytics for publishers' },
  { pattern: /\bparsely\.com/i, name: 'Parse.ly', category: 'analytics', risk: 'medium', description: 'Parse.ly — content analytics for publishers' },
  { pattern: /cxense\.com/i, name: 'Cxense (Piano)', category: 'analytics', risk: 'medium', description: 'Cxense (Piano) — audience analytics and segmentation for publishers' },
  { pattern: /cloudflareinsights\.com/i, name: 'Cloudflare Web Analytics', category: 'analytics', risk: 'low', description: 'Cloudflare Web Analytics — cookieless page-view and page-speed beacon' },
  { pattern: /\bmc\.yandex\.(?:ru|com|by|kz|uz|com\.tr)/i, name: 'Yandex Metrica', category: 'analytics', risk: 'medium', description: 'Yandex Metrica — web analytics with optional session recording (Webvisor)' },
  { pattern: /hm\.baidu\.com/i, name: 'Baidu Tongji', category: 'analytics', risk: 'medium', description: 'Baidu Tongji — Baidu\'s web analytics' },
  { pattern: /top-fwz1\.mail\.ru|\btop\.mail\.ru/i, name: 'Top.Mail.Ru', category: 'analytics', risk: 'medium', description: 'Top.Mail.Ru — VK\'s web analytics counter, also used for VK ad retargeting' },
  { pattern: /stats\.wp\.com/i, name: 'Jetpack Stats', category: 'analytics', risk: 'medium', description: 'Jetpack Stats (WordPress.com) — page-view statistics for the site owner' },
  { pattern: /c\.statcounter\.com|statcounter\.com\/counter/i, name: 'StatCounter', category: 'analytics', risk: 'medium', description: 'StatCounter — web analytics counter' },
  { pattern: /\bmatomo\.|piwik\.(?:js|php|pro)/i, name: 'Matomo / Piwik PRO', category: 'analytics', risk: 'low', description: 'Matomo or Piwik PRO — web analytics the site can host itself; collects page views and visitor behavior' },
  { pattern: /siteimproveanalytics\.(?:com|io)/i, name: 'Siteimprove Analytics', category: 'analytics', risk: 'medium', description: 'Siteimprove Analytics — web analytics' },
  { pattern: /dap\.digitalgov\.gov/i, name: 'Digital Analytics Program', category: 'analytics', risk: 'medium', description: 'Digital Analytics Program — the US government\'s shared Google Analytics setup for federal sites' },
  { pattern: /adobedtm\.com/i, name: 'Adobe Experience Platform Tags', category: 'analytics', risk: 'medium', description: 'Adobe Experience Platform Tags (formerly Launch / DTM) — tag manager that loads Adobe Analytics and other marketing tags' },
  { pattern: /tags\.tiqcdn\.com|tealiumiq\.com/i, name: 'Tealium iQ', category: 'analytics', risk: 'medium', description: 'Tealium iQ — tag manager that loads analytics and marketing tags' },
  { pattern: /ensighten\.com/i, name: 'Ensighten', category: 'analytics', risk: 'medium', description: 'Ensighten — tag manager that loads analytics and marketing tags' },
  { pattern: /visualwebsiteoptimizer\.com/i, name: 'VWO', category: 'analytics', risk: 'medium', description: 'VWO — A/B testing, heatmaps and session recording' },
  { pattern: /cdn\.optimizely\.com|logx\.optimizely\.com/i, name: 'Optimizely', category: 'analytics', risk: 'medium', description: 'Optimizely — A/B testing that assigns you to experiments and records what you do' },
  { pattern: /kameleoon\.(?:io|eu)/i, name: 'Kameleoon', category: 'analytics', risk: 'medium', description: 'Kameleoon — A/B testing and personalization' },
  { pattern: /munchkin\.marketo\.net/i, name: 'Marketo Munchkin', category: 'analytics', risk: 'medium', description: 'Marketo Munchkin — marketing-automation tracker that ties page visits to lead records' },
  { pattern: /bizible\.com/i, name: 'Adobe Marketo Measure (Bizible)', category: 'analytics', risk: 'medium', description: 'Adobe Marketo Measure (formerly Bizible) — marketing attribution' },
  { pattern: /reveal\.clearbit\.com/i, name: 'Clearbit Reveal', category: 'analytics', risk: 'medium', description: 'Clearbit Reveal — looks up the company behind your IP address for sales and marketing' },
  { pattern: /cdn\.pendo\.io/i, name: 'Pendo', category: 'analytics', risk: 'medium', description: 'Pendo — product analytics and in-app guides' },
  { pattern: /script\.crazyegg\.com/i, name: 'Crazy Egg', category: 'analytics', risk: 'medium', description: 'Crazy Egg — heatmaps and session recording' },
  { pattern: /cdn\.moengage\.com/i, name: 'MoEngage', category: 'analytics', risk: 'medium', description: 'MoEngage — customer-engagement platform that tracks behavior for push, email and in-app campaigns' },
  { pattern: /sail-horizon\.com/i, name: 'Sailthru', category: 'analytics', risk: 'medium', description: 'Sailthru (Marigold) — records the pages you read to personalize email and content' },
  { pattern: /mindbox\.ru/i, name: 'Mindbox', category: 'analytics', risk: 'medium', description: 'Mindbox — marketing-automation platform that tracks visitors for email and messaging campaigns' },
  { pattern: /websdk\.appsflyer\.com/i, name: 'AppsFlyer', category: 'analytics', risk: 'medium', description: 'AppsFlyer Web SDK — marketing attribution that measures which ads and campaigns bring visitors' },

  // Social / embeds
  { pattern: /platform\.twitter\.com\/widgets/i, name: 'Twitter Widgets', category: 'tracking', risk: 'medium', description: 'Twitter embedded widgets — can track visitors via third-party cookies' },
  { pattern: /connect\.facebook\.net\/.*\/sdk/i, name: 'Facebook SDK', category: 'tracking', risk: 'high', description: 'Facebook SDK — enables social features but tracks all visitors' },
  { pattern: /apis\.google\.com\/js\/platform/i, name: 'Google Platform', category: 'tracking', risk: 'medium', description: 'Google Platform JS — enables sign-in and social features with tracking' },
  { pattern: /recaptcha/i, name: 'reCAPTCHA', category: 'functional', risk: 'medium', description: 'Google reCAPTCHA — bot protection that also sends data to Google' },

  // Chat/support
  { pattern: /intercom\.io|intercomcdn/i, name: 'Intercom', category: 'analytics', risk: 'medium', description: 'Intercom — customer messaging platform with visitor tracking' },
  { pattern: /crisp\.chat/i, name: 'Crisp', category: 'functional', risk: 'low', description: 'Crisp — live chat widget' },
  { pattern: /drift\.com/i, name: 'Drift', category: 'analytics', risk: 'medium', description: 'Drift — conversational marketing with visitor tracking' },
  { pattern: /hubspot\.com|hs-scripts|hs-analytics/i, name: 'HubSpot', category: 'analytics', risk: 'medium', description: 'HubSpot — marketing analytics, CRM tracking, and lead scoring' },

  // CDN / functional
  { pattern: /cloudflare\.com\/cdn-cgi/i, name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare — CDN and security (bot protection, DDoS mitigation)' },
  { pattern: /stripe\.com\/v3|js\.stripe/i, name: 'Stripe', category: 'functional', risk: 'low', description: 'Stripe — payment processing (necessary for transactions)' },
];

/**
 * Inline tracking snippets, checked in the page's HTML in this order; each
 * `label` is what ScanResult.inlineTrackers reports. `tracker` is the
 * TRACKER_PATTERNS name of the tag each snippet is almost always loaded with
 * (gtag('config') beside gtag/js, fbq('init') beside fbevents.js), so the
 * report card page does not count one tag twice. It must be a real
 * TRACKER_PATTERNS name: tests/scanner-inline.test.ts checks every label.
 */
export const INLINE_TRACKERS: Array<{ pattern: RegExp; label: string; tracker: string }> = [
  { pattern: /fbq\s*\(\s*['"]init/i, label: 'Facebook Pixel (inline)', tracker: 'Facebook Pixel' },
  { pattern: /gtag\s*\(\s*['"]config/i, label: 'Google gtag (inline)', tracker: 'Google Analytics / GTM' },
  { pattern: /ga\s*\(\s*['"]create/i, label: 'Google Analytics (inline)', tracker: 'Google Analytics / GTM' },
  { pattern: /_linkedin_partner_id/i, label: 'LinkedIn Insight (inline)', tracker: 'LinkedIn Insight' },
  { pattern: /twq\s*\(\s*['"]init/i, label: 'Twitter Pixel (inline)', tracker: 'Twitter/X Pixel' },
  { pattern: /pintrk\s*\(\s*['"]load/i, label: 'Pinterest Tag (inline)', tracker: 'Pinterest Tag' },
];

/** Inline label → the TRACKER_PATTERNS name of the tag it comes with (see INLINE_TRACKERS). */
export const TRACKER_FOR_INLINE: Record<string, string> = Object.fromEntries(
  INLINE_TRACKERS.map((i) => [i.label, i.tracker]),
);

export interface KnownCookie {
  name: string;
  category: TrackerCategory;
  risk: Risk;
  description: string;
}

/**
 * Cookie names we can identify, by exact name. categorizeCookie() looks here
 * first, then in KNOWN_COOKIE_PATTERNS, and only then guesses from the name
 * and the SameSite attribute.
 */
export const KNOWN_COOKIES: Record<string, KnownCookie> = {
  '_ga': { name: 'Google Analytics', category: 'analytics', risk: 'medium', description: 'Google Analytics user identifier — persists across sessions for up to 2 years' },
  '_gid': { name: 'Google Analytics', category: 'analytics', risk: 'medium', description: 'Google Analytics 24-hour user identifier' },
  '_gat': { name: 'Google Analytics', category: 'analytics', risk: 'low', description: 'Google Analytics rate throttle' },
  '_gcl_au': { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google Ads conversion linker — connects ad clicks to site actions' },
  '_fbp': { name: 'Facebook', category: 'tracking', risk: 'high', description: 'Facebook Pixel browser ID — tracks you across the web for ad targeting' },
  '_fbc': { name: 'Facebook', category: 'tracking', risk: 'high', description: 'Facebook click identifier from ad campaigns' },
  'fr': { name: 'Facebook', category: 'tracking', risk: 'high', description: 'Facebook advertising cookie used for ad delivery and retargeting' },
  '_ttp': { name: 'TikTok', category: 'tracking', risk: 'high', description: 'TikTok tracking pixel identifier' },
  '_tt_enable_cookie': { name: 'TikTok', category: 'tracking', risk: 'high', description: 'TikTok cookie capability check' },
  'IDE': { name: 'Google DoubleClick', category: 'tracking', risk: 'high', description: 'DoubleClick ad targeting — tracks across websites for personalized ads' },
  'NID': { name: 'Google', category: 'tracking', risk: 'medium', description: 'Google preferences and ad personalization cookie' },
  'MUID': { name: 'Microsoft/Bing', category: 'tracking', risk: 'high', description: 'Microsoft universal identifier — tracks across Bing and Microsoft services' },
  '_uetsid': { name: 'Microsoft Ads', category: 'tracking', risk: 'high', description: 'Microsoft UET session tracking for ad conversions' },
  '_uetvid': { name: 'Microsoft Ads', category: 'tracking', risk: 'high', description: 'Microsoft UET visitor tracking — persists across sessions' },
  '_hjid': { name: 'Hotjar', category: 'analytics', risk: 'medium', description: 'Hotjar user identifier for session recordings' },
  '_hjSessionUser': { name: 'Hotjar', category: 'analytics', risk: 'medium', description: 'Hotjar session-level user identifier' },
  'ajs_anonymous_id': { name: 'Segment', category: 'analytics', risk: 'medium', description: 'Segment anonymous visitor identifier' },
  'ajs_user_id': { name: 'Segment', category: 'analytics', risk: 'medium', description: 'Segment identifier for a signed-in user, sent on to every service Segment feeds' },

  // Advertising and cross-site identity cookies, added 2026-09-11. A list of
  // nothing but these — __gads, __gpi, __eoi, _gcl_aw, _gcl_dc, cto_bundle,
  // _pubcid, AMCV_…AdobeOrg — scored a perfect 100 and "0 tracking" in the
  // Cookie & Tracker Scanner, because no name here matched and the name
  // heuristics only fire on track / uid / visitor (scanner) and
  // track / ad / pixel / campaign (the tool). Vendor names are the vendors' own.
  '__gads': { name: 'Google Ad Manager', category: 'tracking', risk: 'high', description: 'Google Ad Manager — identifies your browser to choose ads and cap how often you see one' },
  '__gpi': { name: 'Google Ad Manager', category: 'tracking', risk: 'high', description: 'Google Ad Manager publisher identifier used for ad personalization' },
  '__eoi': { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google advertising identifier used to limit ad repetition and measure ad performance' },
  '_gcl_aw': { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google Ads click identifier — ties an ad click to what you do on the site afterwards' },
  '_gcl_dc': { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google Campaign Manager click identifier — ties a display-ad click to what you do afterwards' },
  '_gcl_gb': { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google Ads conversion linker for Google Business Profile clicks' },
  'DSID': { name: 'Google DoubleClick', category: 'tracking', risk: 'high', description: 'DoubleClick identifier that links ad personalization to a signed-in Google account' },
  'test_cookie': { name: 'Google DoubleClick', category: 'tracking', risk: 'low', description: 'DoubleClick check that the browser accepts cookies — set by an ad domain on the page' },
  '_uetmsclkid': { name: 'Microsoft Ads', category: 'tracking', risk: 'high', description: 'Microsoft Advertising click identifier — ties an ad click to what you do on the site' },
  'ANONCHK': { name: 'Microsoft/Bing', category: 'tracking', risk: 'medium', description: 'Microsoft Advertising cookie that records whether MUID may be used for ad personalization' },
  'SRM_B': { name: 'Microsoft/Bing', category: 'tracking', risk: 'high', description: 'Microsoft Advertising browser identifier used across Bing and Microsoft ad services' },
  '_clck': { name: 'Microsoft Clarity', category: 'analytics', risk: 'medium', description: 'Microsoft Clarity visitor identifier for session recordings and heatmaps' },
  '_clsk': { name: 'Microsoft Clarity', category: 'analytics', risk: 'medium', description: 'Microsoft Clarity session identifier — joins the page views of one visit' },
  '_scid': { name: 'Snapchat', category: 'tracking', risk: 'high', description: 'Snap Pixel browser identifier — tracks conversions and builds ad audiences for Snapchat' },
  '_scid_r': { name: 'Snapchat', category: 'tracking', risk: 'high', description: 'Snap Pixel browser identifier (retention copy) used for ad measurement' },
  '_sctr': { name: 'Snapchat', category: 'tracking', risk: 'high', description: 'Snap Pixel cookie that records the ad click that brought you here' },
  'sc_at': { name: 'Snapchat', category: 'tracking', risk: 'high', description: 'Snap advertising identifier used to attribute conversions to Snapchat ads' },
  '_rdt_uuid': { name: 'Reddit', category: 'tracking', risk: 'high', description: 'Reddit Pixel visitor identifier — tracks conversions and builds ad audiences on Reddit' },
  'bcookie': { name: 'LinkedIn', category: 'tracking', risk: 'high', description: 'LinkedIn browser identifier — recognizes your browser across sites that embed LinkedIn tags' },
  'bscookie': { name: 'LinkedIn', category: 'tracking', risk: 'high', description: 'LinkedIn secure browser identifier, the HTTPS copy of bcookie' },
  'li_sugr': { name: 'LinkedIn', category: 'tracking', risk: 'high', description: 'LinkedIn browser identifier used to match visitors to LinkedIn members for ad targeting' },
  'UserMatchHistory': { name: 'LinkedIn', category: 'tracking', risk: 'high', description: 'LinkedIn Ads ID sync — records when your browser was last matched to LinkedIn\'s ad platform' },
  'personalization_id': { name: 'X (Twitter)', category: 'tracking', risk: 'high', description: 'X (Twitter) advertising identifier used to personalize ads and measure conversions' },
  'guest_id_ads': { name: 'X (Twitter)', category: 'tracking', risk: 'high', description: 'X (Twitter) identifier for logged-out visitors, used for advertising' },
  'guest_id_marketing': { name: 'X (Twitter)', category: 'tracking', risk: 'high', description: 'X (Twitter) identifier for logged-out visitors, used for marketing' },
  '_pin_unauth': { name: 'Pinterest', category: 'tracking', risk: 'high', description: 'Pinterest Tag identifier for visitors who are not signed in to Pinterest' },
  '_pinterest_ct_ua': { name: 'Pinterest', category: 'tracking', risk: 'high', description: 'Pinterest conversion-tracking identifier' },
  '_epik': { name: 'Pinterest', category: 'tracking', risk: 'high', description: 'Pinterest Enhanced Match identifier — links your visit to a Pinterest account' },
  'cto_bundle': { name: 'Criteo', category: 'tracking', risk: 'high', description: 'Criteo retargeting identifier — follows you across sites to pick the ads you are shown' },
  'cto_bidid': { name: 'Criteo', category: 'tracking', risk: 'high', description: 'Criteo bid identifier from the ad auction that filled a slot on this page' },
  '__ar_v4': { name: 'AdRoll', category: 'tracking', risk: 'high', description: 'AdRoll retargeting identifier — follows you across sites for ad targeting' },
  '_pubcid': { name: 'PubCommon ID', category: 'tracking', risk: 'high', description: 'PubCommon ID (Prebid) — one shared identifier publishers pass to ad bidders' },
  '_lc2_fpi': { name: 'LiveIntent', category: 'tracking', risk: 'high', description: 'LiveIntent first-party identifier — ties your visit to LiveIntent\'s cross-site ad identity' },
  '__qca': { name: 'Quantcast', category: 'tracking', risk: 'high', description: 'Quantcast audience measurement identifier, also used to build ad-targeting segments' },
  'uuid2': { name: 'Xandr (Microsoft)', category: 'tracking', risk: 'high', description: 'Xandr (AppNexus) browser identifier used to buy and target display ads' },
  'anj': { name: 'Xandr (Microsoft)', category: 'tracking', risk: 'high', description: 'Xandr (AppNexus) cookie recording which ads your browser has been shown' },
  'TDID': { name: 'The Trade Desk', category: 'tracking', risk: 'high', description: 'The Trade Desk browser identifier used to target and measure display ads' },
  'demdex': { name: 'Adobe Audience Manager', category: 'tracking', risk: 'high', description: 'Adobe Audience Manager identifier — sorts you into audience segments that can be sold to advertisers' },
  'dextp': { name: 'Adobe Audience Manager', category: 'tracking', risk: 'medium', description: 'Adobe Audience Manager record of when your data was last sent to its partners' },
  'everest_cookie': { name: 'Adobe Advertising Cloud', category: 'tracking', risk: 'high', description: 'Adobe Advertising Cloud (Everest) identifier used for ad targeting and attribution' },
  's_ecid': { name: 'Adobe Experience Cloud', category: 'tracking', risk: 'high', description: 'A first-party copy of the Adobe Experience Cloud ID that identifies you across Adobe\'s services' },
  's_vi': { name: 'Adobe Analytics', category: 'analytics', risk: 'medium', description: 'Adobe Analytics visitor identifier' },
  's_fid': { name: 'Adobe Analytics', category: 'analytics', risk: 'medium', description: 'Adobe Analytics fallback visitor identifier, set when s_vi cannot be' },
  'mbox': { name: 'Adobe Target', category: 'analytics', risk: 'medium', description: 'Adobe Target — assigns you to a personalization or A/B test and records what you do' },
  '_pcid': { name: 'Piano', category: 'analytics', risk: 'medium', description: 'Piano (Cxense) visitor identifier used for audience segmentation and paywall rules' },
  '_pctx': { name: 'Piano', category: 'analytics', risk: 'medium', description: 'Piano (Cxense) visitor context — what this browser has read on the site' },
  'hubspotutk': { name: 'HubSpot', category: 'analytics', risk: 'medium', description: 'HubSpot visitor identifier that ties page visits to a contact record' },
  '__hstc': { name: 'HubSpot', category: 'analytics', risk: 'medium', description: 'HubSpot visitor tracking — first visit, last visit and visit count' },
  '__hssc': { name: 'HubSpot', category: 'analytics', risk: 'low', description: 'HubSpot session counter' },
  '__hssrc': { name: 'HubSpot', category: 'analytics', risk: 'low', description: 'HubSpot check for whether the browser was restarted' },
  'optimizelyEndUserId': { name: 'Optimizely', category: 'analytics', risk: 'medium', description: 'Optimizely visitor identifier — keeps you in the same A/B test group' },

  '__cf_bm': { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare bot management — necessary for security' },
  'cf_clearance': { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare challenge clearance token' },
  '__stripe_mid': { name: 'Stripe', category: 'functional', risk: 'low', description: 'Stripe fraud prevention identifier' },
  '__stripe_sid': { name: 'Stripe', category: 'functional', risk: 'low', description: 'Stripe session identifier for payments' },
  'PHPSESSID': { name: 'PHP Session', category: 'functional', risk: 'low', description: 'PHP server-side session cookie — standard functionality' },
  'JSESSIONID': { name: 'Java Session', category: 'functional', risk: 'low', description: 'Java server-side session cookie — standard functionality' },
  'ASP.NET_SessionId': { name: 'ASP.NET Session', category: 'functional', risk: 'low', description: 'ASP.NET server-side session cookie — standard functionality' },
  'csrftoken': { name: 'CSRF Protection', category: 'functional', risk: 'low', description: 'Cross-site request forgery protection token' },
  // Spelt several ways by different frameworks; all reach the name heuristic
  // anyway, and are here so the Cookie & Tracker Scanner can name them.
  'csrf_token': { name: 'CSRF Protection', category: 'functional', risk: 'low', description: 'Cross-site request forgery protection token' },
  'XSRF-TOKEN': { name: 'CSRF Protection', category: 'functional', risk: 'low', description: 'Cross-site request forgery protection token, the spelling Angular and Laravel use' },
  'session': { name: 'Session', category: 'functional', risk: 'low', description: 'Server-side session identifier — keeps you signed in' },
  'sessionid': { name: 'Session', category: 'functional', risk: 'low', description: 'Server-side session identifier — keeps you signed in' },

  // Load balancers, CDNs and bot protection: set by the site's own hosting,
  // not by an ad or analytics company. Several are SameSite=None only so they
  // survive cross-origin requests, and the SameSite heuristic below published
  // them as "tracking cookies before consent" (AWSALBCORS on cnbc.com, _cfuvid
  // on mediatek.com; funnel pilot 2026-09-11).
  'AWSALB': { name: 'AWS Load Balancer', category: 'functional', risk: 'low', description: 'AWS Application Load Balancer stickiness cookie — keeps your requests on the same server' },
  'AWSALBCORS': { name: 'AWS Load Balancer', category: 'functional', risk: 'low', description: 'AWS Application Load Balancer stickiness cookie — the SameSite=None copy of AWSALB, for cross-origin requests' },
  'AWSALBTG': { name: 'AWS Load Balancer', category: 'functional', risk: 'low', description: 'AWS Application Load Balancer target-group stickiness cookie — keeps your requests on the same server' },
  'AWSALBTGCORS': { name: 'AWS Load Balancer', category: 'functional', risk: 'low', description: 'AWS Application Load Balancer target-group stickiness cookie — the SameSite=None copy of AWSALBTG, for cross-origin requests' },
  'AWSELB': { name: 'AWS Load Balancer', category: 'functional', risk: 'low', description: 'AWS Classic Load Balancer stickiness cookie — keeps your requests on the same server' },
  'AWSELBCORS': { name: 'AWS Load Balancer', category: 'functional', risk: 'low', description: 'AWS Classic Load Balancer stickiness cookie — the SameSite=None copy of AWSELB, for cross-origin requests' },
  '_cfuvid': { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare rate limiting — tells apart visitors who share an IP address; deleted when you close the browser' },
  '__cfruid': { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare rate limiting — the older version of _cfuvid' },
  '__cflb': { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare Load Balancing session affinity — keeps your requests on the same server' },
  'ARRAffinity': { name: 'Azure App Service', category: 'functional', risk: 'low', description: 'Azure App Service session affinity — keeps your requests on the same server instance' },
  'ARRAffinitySameSite': { name: 'Azure App Service', category: 'functional', risk: 'low', description: 'Azure App Service session affinity — the SameSite=None copy of ARRAffinity' },
  'ak_bmsc': { name: 'Akamai Bot Manager', category: 'functional', risk: 'low', description: 'Akamai Bot Manager — tells browsers from bots; set for security' },
  '_abck': { name: 'Akamai Bot Manager', category: 'functional', risk: 'low', description: 'Akamai Bot Manager — tells browsers from bots; set for security' },
  'bm_sz': { name: 'Akamai Bot Manager', category: 'functional', risk: 'low', description: 'Akamai Bot Manager — tells browsers from bots; set for security' },
  'bm_sv': { name: 'Akamai Bot Manager', category: 'functional', risk: 'low', description: 'Akamai Bot Manager — tells browsers from bots; set for security' },
  'bm_mi': { name: 'Akamai Bot Manager', category: 'functional', risk: 'low', description: 'Akamai Bot Manager — tells browsers from bots; set for security' },
  'bm_s': { name: 'Akamai Bot Manager', category: 'functional', risk: 'low', description: 'Akamai Bot Manager — tells browsers from bots; set for security' },
  'bm_so': { name: 'Akamai Bot Manager', category: 'functional', risk: 'low', description: 'Akamai Bot Manager — tells browsers from bots; set for security' },
  'AKA_A2': { name: 'Akamai', category: 'functional', risk: 'low', description: 'Akamai Adaptive Acceleration — CDN cookie used to speed up page loads' },
  'datadome': { name: 'DataDome', category: 'functional', risk: 'low', description: 'DataDome bot protection — tells browsers from bots' },
  '_pxhd': { name: 'HUMAN (PerimeterX)', category: 'functional', risk: 'low', description: 'HUMAN (PerimeterX) bot defense — tells browsers from bots' },
  '_pxvid': { name: 'HUMAN (PerimeterX)', category: 'functional', risk: 'low', description: 'HUMAN (PerimeterX) bot defense — tells browsers from bots' },
  '_px2': { name: 'HUMAN (PerimeterX)', category: 'functional', risk: 'low', description: 'HUMAN (PerimeterX) bot defense — tells browsers from bots' },
  '_px3': { name: 'HUMAN (PerimeterX)', category: 'functional', risk: 'low', description: 'HUMAN (PerimeterX) bot defense — tells browsers from bots' },
  'pxcts': { name: 'HUMAN (PerimeterX)', category: 'functional', risk: 'low', description: 'HUMAN (PerimeterX) bot defense — tells browsers from bots' },
};

/**
 * Cookie names that carry a site, server or policy id after a fixed start
 * (BIGipServer<pool>, incap_ses_<n>_<site>, akaalb_<policy>). Case-sensitive,
 * like cookie names. Checked after KNOWN_COOKIES, before any heuristic.
 */
export const KNOWN_COOKIE_PATTERNS: Array<{ pattern: RegExp; info: KnownCookie }> = [
  { pattern: /^mp_/, info: { name: 'Mixpanel', category: 'analytics', risk: 'medium', description: 'Mixpanel analytics identifier' } },

  // Advertising and identity families whose names carry an account, container
  // or organisation id (_gac_UA-…, AMCV_…AdobeOrg, cto_bundle, __adroll_fpc).
  // Added 2026-09-11 with the exact names above.
  { pattern: /^_gcl_/, info: { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google Ads conversion linker — connects an ad click to what you do on the site' } },
  { pattern: /^_gac_/, info: { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google Ads campaign details, shared with Google Analytics to attribute what you do to an ad' } },
  { pattern: /^cto_/, info: { name: 'Criteo', category: 'tracking', risk: 'high', description: 'Criteo retargeting — follows you across sites to pick the ads you are shown' } },
  { pattern: /^__adroll/, info: { name: 'AdRoll', category: 'tracking', risk: 'high', description: 'AdRoll retargeting identifier — follows you across sites for ad targeting' } },
  { pattern: /^_pubcid/, info: { name: 'PubCommon ID', category: 'tracking', risk: 'high', description: 'PubCommon ID (Prebid) — one shared identifier publishers pass to ad bidders' } },
  { pattern: /^_sharedid/, info: { name: 'SharedID (Prebid)', category: 'tracking', risk: 'high', description: 'Prebid SharedID — one shared identifier publishers pass to ad bidders' } },
  { pattern: /^panoramaId/, info: { name: 'Lotame', category: 'tracking', risk: 'high', description: 'Lotame Panorama ID — a cross-site identifier sold to advertisers for targeting' } },
  { pattern: /^AMCV_/, info: { name: 'Adobe Experience Cloud', category: 'tracking', risk: 'high', description: 'Adobe Experience Cloud ID (ECID) — the identifier Adobe Analytics, Target and Audience Manager share to recognize you' } },
  { pattern: /^AMCVS_/, info: { name: 'Adobe Experience Cloud', category: 'tracking', risk: 'medium', description: 'Adobe Experience Cloud session flag, set beside the ECID cookie' } },
  { pattern: /^kndctr_/, info: { name: 'Adobe Experience Platform', category: 'tracking', risk: 'high', description: 'Adobe Experience Platform Web SDK — carries the Experience Cloud ID that identifies you to Adobe\'s services' } },

  // Analytics families with a property or site id in the name.
  { pattern: /^_ga_/, info: { name: 'Google Analytics', category: 'analytics', risk: 'medium', description: 'Google Analytics 4 session state for one measurement property' } },
  { pattern: /^_gat/, info: { name: 'Google Analytics', category: 'analytics', risk: 'low', description: 'Google Analytics rate throttle' } },
  { pattern: /^__utm/, info: { name: 'Google Analytics', category: 'analytics', risk: 'medium', description: 'Classic Google Analytics visitor, session and campaign cookies' } },
  { pattern: /^_hj/, info: { name: 'Hotjar', category: 'analytics', risk: 'medium', description: 'Hotjar — identifies your browser and session for recordings and heatmaps' } },
  { pattern: /^intercom-/, info: { name: 'Intercom', category: 'analytics', risk: 'medium', description: 'Intercom customer-messaging identifier — ties this browser to a contact record' } },
  { pattern: /^_ym_/, info: { name: 'Yandex Metrica', category: 'analytics', risk: 'medium', description: 'Yandex Metrica visitor and session identifiers' } },
  { pattern: /^Hm_l(?:vt|pvt)_/, info: { name: 'Baidu Tongji', category: 'analytics', risk: 'medium', description: 'Baidu Tongji visit-time analytics cookies' } },
  { pattern: /^_vwo|^_vis_opt_/, info: { name: 'VWO', category: 'analytics', risk: 'medium', description: 'VWO — assigns you to an A/B test and records what you do' } },
  { pattern: /^_pk_(?:id|ses|ref)\./, info: { name: 'Matomo', category: 'analytics', risk: 'medium', description: 'Matomo visitor and session identifiers' } },
  { pattern: /^_sp_(?:id|ses)\./, info: { name: 'Snowplow', category: 'analytics', risk: 'medium', description: 'Snowplow visitor and session identifiers' } },

  // HUMAN (PerimeterX) sets a family of these (_pxhd, _pxvid, _px2, _px3,
  // _pxde, _pxcts, _pxff_*). Before 2026-09-11 only the first four were known
  // and the rest were deducted for as "Unknown Tracker", because the name
  // heuristic below treated any "_px" as tracking — bot defence graded as
  // advertising, and not something the methodology page's published name
  // rules ("uid", "visitor", "track") could explain.
  { pattern: /^_px/, info: { name: 'HUMAN (PerimeterX)', category: 'functional', risk: 'low', description: 'HUMAN (PerimeterX) bot defense — tells browsers from bots' } },

  { pattern: /^cf_chl_/, info: { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare challenge cookie — used while a Cloudflare security check runs' } },
  { pattern: /^BIGipServer/, info: { name: 'F5 BIG-IP', category: 'functional', risk: 'low', description: 'F5 BIG-IP load-balancer persistence cookie — keeps your requests on the same server' } },
  // TS01 + hex is the main F5 Advanced WAF (ASM) cookie; TS + 8 hex + 3 digits
  // are the ones it sets beside it (achmea.nl, unesco.org, zilverenkruis.nl).
  { pattern: /^TS01[0-9a-f]{6}|^TS[0-9a-f]{8}\d{3}$/, info: { name: 'F5 BIG-IP Advanced WAF', category: 'functional', risk: 'low', description: 'F5 BIG-IP Advanced WAF (ASM) security cookie — protects the site from attacks and bots' } },
  { pattern: /^visid_incap_/, info: { name: 'Imperva', category: 'functional', risk: 'low', description: 'Imperva (Incapsula) CDN and firewall cookie — recognizes returning browsers for bot and attack protection' } },
  { pattern: /^incap_ses_/, info: { name: 'Imperva', category: 'functional', risk: 'low', description: 'Imperva (Incapsula) CDN and firewall session cookie — bot and attack protection' } },
  { pattern: /^nlbi_/, info: { name: 'Imperva', category: 'functional', risk: 'low', description: 'Imperva (Incapsula) load-balancer cookie' } },
  { pattern: /^akaalb_/, info: { name: 'Akamai', category: 'functional', risk: 'low', description: 'Akamai Application Load Balancer — keeps your requests on the same origin server' } },
  { pattern: /^akavpau_/, info: { name: 'Akamai', category: 'functional', risk: 'low', description: 'Akamai Visitor Prioritization (waiting room) — admits you to the site during traffic peaks' } },
  { pattern: /^akacd_/, info: { name: 'Akamai', category: 'functional', risk: 'low', description: 'Akamai Phased Release — keeps you on the same version of the site during a staged rollout' } },
  { pattern: /^akaas_/, info: { name: 'Akamai', category: 'functional', risk: 'low', description: 'Akamai Audience Segmentation — keeps you in the same traffic segment when the site splits visitors between versions (A/B tests, rollouts)' } },
  { pattern: /^NSC_/, info: { name: 'Citrix NetScaler', category: 'functional', risk: 'low', description: 'Citrix NetScaler (ADC) load-balancer persistence cookie — keeps your requests on the same server' } },
  { pattern: /^qrator_/, info: { name: 'Qrator Labs', category: 'functional', risk: 'low', description: 'Qrator Labs DDoS protection cookie' } },
  { pattern: /^__ddg[0-9a-z]*_$/, info: { name: 'DDoS-Guard', category: 'functional', risk: 'low', description: 'DDoS-Guard DDoS and bot protection cookie' } },
  { pattern: /^ASPSESSIONID/, info: { name: 'ASP Session', category: 'functional', risk: 'low', description: 'Classic ASP server-side session cookie — standard functionality' } },
];

/** The `name` categorizeCookie gives a cookie it calls tracking only because it is SameSite=None. */
export const SAMESITE_NONE_GUESS = 'Third-Party Cookie';

/**
 * The ONE cookie-name lookup: KNOWN_COOKIES by exact name, then
 * KNOWN_COOKIE_PATTERNS. null when nobody has identified the name — the
 * caller then applies its own heuristics.
 *
 * Shared with components/tools/CookieAnalyzerTool so a pasted list, this
 * page's cookies and a URL scan call the same cookie by the same name. The
 * tool kept its own shorter table until 2026-09-11, which is why a list of
 * nothing but advertising cookies scored 100 there and was graded honestly here.
 */
export function lookupCookieName(cookieName: string): KnownCookie | null {
  if (Object.prototype.hasOwnProperty.call(KNOWN_COOKIES, cookieName)) {
    return KNOWN_COOKIES[cookieName];
  }
  return KNOWN_COOKIE_PATTERNS.find((k) => k.pattern.test(cookieName))?.info ?? null;
}

export function categorizeCookie(cookieStr: string) {
  const [nameVal] = cookieStr.split(';');
  const [name] = nameVal.split('=');
  const cookieName = name.trim();

  // Exact names, then names with a variable part.
  const known = lookupCookieName(cookieName);
  if (known) {
    return { cookieName, ...known };
  }

  // Heuristic
  const lower = cookieName.toLowerCase();
  // Exactly the three names app/site/methodology/page.tsx publishes. '_px' was
  // a fourth until 2026-09-11: it is HUMAN (PerimeterX) bot defence, now known
  // by pattern above, and the methodology never listed it.
  if (lower.includes('track') || lower.includes('uid') || lower.includes('visitor')) {
    return { cookieName, name: 'Unknown Tracker', category: 'tracking' as const, risk: 'medium' as const, description: 'Likely a tracking cookie based on naming pattern' };
  }
  if (lower.includes('session') || lower.includes('csrf') || lower.includes('token') || lower.includes('auth')) {
    return { cookieName, name: 'Functional', category: 'functional' as const, risk: 'low' as const, description: 'Likely a functional/security cookie' };
  }

  // Parse attributes for additional context
  const parts = cookieStr.toLowerCase();
  const isThirdParty = parts.includes('samesite=none');
  const isLongLived = /max-age=\d{7,}/.test(parts) || /expires=.*20[3-9]/.test(parts);

  // An unrecognized SameSite=None cookie counts as tracking. That is weak
  // evidence (hosting sets it for CORS too, see above); scripts/regrade-sites.ts
  // --whatif-samesite measures the grades if these were 'unknown' instead.
  // Not applied: an owner decision (2026-09-11).
  if (isThirdParty) {
    return { cookieName, name: SAMESITE_NONE_GUESS, category: 'tracking' as const, risk: 'high' as const, description: 'SameSite=None allows cross-site tracking' };
  }
  if (isLongLived) {
    return { cookieName, name: 'Long-Lived Cookie', category: 'analytics' as const, risk: 'medium' as const, description: 'Cookie with extended expiry — persistent tracking possible' };
  }

  return { cookieName, name: 'Unknown', category: 'unknown' as const, risk: 'low' as const, description: 'Purpose unknown — could be functional or tracking' };
}

// SSRF Protection: block private/reserved IPs and cloud metadata endpoints
export function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Block localhost variants
  if (lower === 'localhost' || lower === 'localhost.localdomain') return true;

  // Block common cloud metadata endpoints
  if (lower === 'metadata.google.internal') return true;
  if (lower === 'metadata.google.com') return true;

  // Strip IPv6 brackets
  const ip = lower.replace(/^\[/, '').replace(/\]$/, '');

  // Handle IPv4-mapped IPv6
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  // Block IPv4 private/reserved ranges
  const blockedIPv4 = [
    /^127\./,                          // Loopback
    /^10\./,                           // RFC 1918
    /^172\.(1[6-9]|2[0-9]|3[01])\./,  // RFC 1918
    /^192\.168\./,                     // RFC 1918
    /^169\.254\./,                     // Link-local / AWS metadata
    /^0\./,                            // Current network
    /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,  // Carrier-grade NAT
    /^192\.0\.0\./,                    // IETF protocol assignments
    /^198\.1[89]\./,                   // Benchmarking
    /^255\.255\.255\.255$/,            // Broadcast
  ];
  if (blockedIPv4.some(r => r.test(v4))) return true;

  // Block IPv6 private/reserved
  const blockedIPv6 = [
    /^::1$/,           // Loopback
    /^fc[0-9a-f]{2}:/i,  // Unique local
    /^fd[0-9a-f]{2}:/i,  // Unique local
    /^fe80:/i,         // Link-local
    /^ff[0-9a-f]{2}:/i,  // Multicast
    /^::$/,            // Unspecified
  ];
  if (blockedIPv6.some(r => r.test(ip))) return true;

  return false;
}

// Read a response body with a hard byte cap. Aborts the stream once the cap is hit.
export async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        // Decode what fits, then bail. Truncation is intentional.
        const remaining = value.byteLength - (received - maxBytes);
        if (remaining > 0) out += decoder.decode(value.subarray(0, remaining), { stream: false });
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return out;
}

export interface ScanCookie {
  cookieName: string;
  name: string;
  category: TrackerCategory | 'unknown';
  risk: Risk;
  description: string;
  raw: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  domain: string;
  path: string;
  maxAge: string | null;
  expires: string | null;
}

export interface ScanResult {
  url: string;
  status: number;
  cookies: ScanCookie[];
  trackers: Array<{ name: string; category: TrackerCategory; risk: Risk; description: string }>;
  inlineTrackers: string[];
  thirdPartyDomains: string[];
  security: { isHTTPS: boolean; hasCSP: boolean; hasPermPolicy: boolean; hasHSTS: boolean };
  summary: {
    totalCookies: number;
    trackingCookies: number;
    analyticsCookies: number;
    functionalCookies: number;
    totalTrackers: number;
    thirdPartyScripts: number;
    highRiskItems: number;
  };
}

export interface AnalyzeLimits {
  maxCookies: number;
  maxScriptMatches: number;
  maxThirdPartyDomains: number;
}

/**
 * What makes two Set-Cookie lines the same cookie: the name (case-sensitive)
 * plus the domain (case-insensitive) and the path. Attributes such as Expires
 * are not part of the identity.
 *
 * `Domain=.example.com` and a host-only `example.com` are deliberately NOT
 * merged, even though RFC 6265 ignores the leading dot: browsers keep those as
 * two cookies (RFC 6265bis makes the host-only flag part of the identity), and
 * a scan can't tell a host-only cookie from `Domain=example.com` after the
 * fact, so the safe direction is to count them separately.
 */
export function cookieIdentity(c: { cookieName: string; domain: string; path: string }): string {
  return `${c.cookieName}\n${c.domain.toLowerCase()}\n${c.path}`;
}

/**
 * One cookie per name + domain + path, in the order the names first appear.
 *
 * A response often sets the same cookie several times (lowes.com sent EPID
 * eight times with different Expires values, and the card published it as
 * "8 tracking cookies before consent"). A browser ends up with one cookie,
 * the last Set-Cookie winning, so that is what a report card should count.
 * Map.set keeps the first insertion's position and takes the last value,
 * which is exactly that. Shared with scripts/regrade-sites.ts so the stored
 * cards count cookies the way a fresh scan does.
 */
export function dedupeCookies<T extends { cookieName: string; domain: string; path: string }>(cookies: T[]): T[] {
  const byIdentity = new Map<string, T>();
  for (const c of cookies) byIdentity.set(cookieIdentity(c), c);
  return [...byIdentity.values()];
}

/**
 * Build the scan result from an already-fetched Response and its (capped)
 * HTML. Pure with respect to the network — the caller decides fetch policy.
 */
export function analyzeScan(
  targetUrl: string,
  parsedUrl: URL,
  response: Response,
  html: string,
  limits: AnalyzeLimits,
): ScanResult {
  // Keep the audited enforcement lines textually identical to the original
  // route (tests/resource-bounds.test.ts pins them) — just bound to the caller's limits.
  const MAX_COOKIES = limits.maxCookies;
  const MAX_SCRIPT_MATCHES = limits.maxScriptMatches;
  const MAX_THIRD_PARTY_DOMAINS = limits.maxThirdPartyDomains;
  // Extract Set-Cookie headers
  const setCookies: string[] = [];
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') {
      setCookies.push(value);
    }
  });

  // Some servers send multiple cookies in one header
  // Also check getSetCookie if available
  const rawSetCookiesAll = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || setCookies;
  // Cap cookie array — a hostile server could send thousands of Set-Cookie headers
  const rawSetCookies = rawSetCookiesAll.slice(0, MAX_COOKIES);

  const setCookieLines: ScanCookie[] = rawSetCookies.map(cookieStr => {
    const categorized = categorizeCookie(cookieStr);
    // Extract attributes
    const parts = cookieStr.split(';').map(p => p.trim());
    const attributes: Record<string, string> = {};
    for (const part of parts.slice(1)) {
      const [k, v] = part.split('=');
      attributes[k.trim().toLowerCase()] = v?.trim() || 'true';
    }
    return {
      ...categorized,
      raw: cookieStr.length > 200 ? cookieStr.substring(0, 200) + '...' : cookieStr,
      secure: 'secure' in attributes,
      httpOnly: 'httponly' in attributes,
      sameSite: attributes['samesite'] || 'not set',
      domain: attributes['domain'] || parsedUrl.hostname,
      path: attributes['path'] || '/',
      maxAge: attributes['max-age'] || null,
      expires: attributes['expires'] || null,
    };
  });

  // One cookie set several times in one response is one cookie, not several.
  const cookies = dedupeCookies(setCookieLines);

  // Scan for tracking scripts
  const trackers = TRACKER_PATTERNS.filter(t => t.pattern.test(html)).map(t => ({
    name: t.name,
    category: t.category,
    risk: t.risk,
    description: t.description,
  }));

  // Count third-party script domains — capped at MAX_SCRIPT_MATCHES iterations
  // so pathological pages (e.g. 100k <script> tags) can't DoS the caller.
  // Bound URL length in the character class too, belt-and-suspenders against ReDoS.
  const scriptSrcRegex = /src=["'](https?:\/\/[^"']{1,2048})["']/gi;
  const thirdPartyDomains = new Set<string>();
  let match;
  let scriptIterations = 0;
  while ((match = scriptSrcRegex.exec(html)) !== null) {
    if (++scriptIterations > MAX_SCRIPT_MATCHES) break;
    if (thirdPartyDomains.size >= MAX_THIRD_PARTY_DOMAINS) break;
    try {
      const scriptUrl = new URL(match[1]);
      if (scriptUrl.hostname !== parsedUrl.hostname) {
        thirdPartyDomains.add(scriptUrl.hostname);
      }
    } catch {
      // skip invalid URLs
    }
  }

  // Check for meta pixel / other inline tracking (INLINE_TRACKERS, in order)
  const inlineTrackers = INLINE_TRACKERS.filter((i) => i.pattern.test(html)).map((i) => i.label);

  const isHTTPS = parsedUrl.protocol === 'https:';
  const hasCSP = !!response.headers.get('content-security-policy');
  const hasPermPolicy = !!response.headers.get('permissions-policy');
  const hasHSTS = !!response.headers.get('strict-transport-security');

  return {
    url: targetUrl,
    status: response.status,
    cookies,
    trackers,
    inlineTrackers,
    thirdPartyDomains: Array.from(thirdPartyDomains).slice(0, MAX_THIRD_PARTY_DOMAINS),
    security: { isHTTPS, hasCSP, hasPermPolicy, hasHSTS },
    summary: {
      totalCookies: cookies.length,
      trackingCookies: cookies.filter(c => c.category === 'tracking').length,
      analyticsCookies: cookies.filter(c => c.category === 'analytics').length,
      functionalCookies: cookies.filter(c => c.category === 'functional').length,
      totalTrackers: trackers.length,
      thirdPartyScripts: thirdPartyDomains.size,
      highRiskItems: cookies.filter(c => c.risk === 'high').length + trackers.filter(t => t.risk === 'high').length,
    },
  };
}
