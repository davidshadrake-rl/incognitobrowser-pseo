/**
 * The result card's words (components/tools/ResultCard.tsx).
 *
 * Owner rules, 2026-09-16: the ask arrives WITH the result, on screen, and it
 * claims for Incognito Pro only what data/brand.json `pro` lists — tracker
 * blocking, hiding the empty ad boxes, and cleaning a whole folder of photos.
 * The free app already blocks ads, wipes history on exit and has Agent
 * Cloaking; those are free fixes, never sold as Pro.
 *
 * Where the words come from, first match wins:
 *   1. the page the visitor came from (?from=), its funnel's results[severity]
 *   2. this tool page's own funnel in data/funnels.json
 *   3. CARD_COPY[engine][severity] below, else DEFAULT_CARD_COPY
 *
 * Limits (tests/result-card-copy.test.ts): meaning ≤120 characters and one
 * sentence, free ≤70, pro ≤110, button ≤28 (one line on a 360px phone). The
 * card labels the Pro line "Incognito Pro", so the line starts with its verb.
 * When no Pro outcome answers the result, the line starts "Separately," and
 * never presents Pro as the fix. Every meaning has to hold for any result the
 * engine reports in that colour, so each engine says when it reports which.
 */
import type { Severity } from '@/components/tools/ResultContext';
import { reportCardLine } from '@/lib/cta-copy';
import type { Grade } from '@/lib/site-grade';
import type { FunnelSeverity, PageFunnelV2, ResultCopy } from '@/lib/funnel-types';
import brand from '@/data/brand.json';

/** The brand.json pro features, by the id the card and the Play referrer carry. */
export type Benefit = 'tracker-blocking' | 'hides-ad-boxes' | 'photo-cleaning';

export const BENEFIT_FEATURE: Record<Benefit, string> = {
  'tracker-blocking': 'pro-tracker-blocking',
  'hides-ad-boxes': 'pro-hides-ad-boxes',
  'photo-cleaning': 'pro-batch-photo-cleaning',
};

export const CARD_LIMITS = { meaning: 120, free: 70, pro: 110, button: 28, headline: 90 } as const;

/** The default Pro line per benefit: brand.json's outcome, in the card's voice. */
export const PRO_LINE: Record<Benefit, string> = {
  'tracker-blocking': 'Blocks tracking scripts and pixels on the sites you open in the app, on top of the free ad blocker.',
  'hides-ad-boxes': 'Hides the empty boxes and banners that blocked ads leave behind on the page.',
  'photo-cleaning': 'Strips location and other metadata from a whole folder of photos at once.',
};

/**
 * The words that name each benefit, photos first: a photo line may mention
 * location. A line must sell exactly one; the copy test fails any that sells
 * none or two.
 */
export const BENEFIT_PATTERN: Record<Benefit, RegExp> = {
  'photo-cleaning': /\b(photos?|metadata|folders?)\b/i,
  'tracker-blocking': /\btrack(ers?|ing)\b|\bpixels?\b/i,
  'hides-ad-boxes': /\b(ad boxes|empty boxes|banners)\b/i,
};

/** Which benefit a Pro line (or a button) sells. */
export function benefitOf(pro: string): Benefit | null {
  return (Object.keys(BENEFIT_PATTERN) as Benefit[]).find((b) => BENEFIT_PATTERN[b].test(pro)) ?? null;
}

export interface CardCopy extends ResultCopy {
  benefit: Benefit;
}

type EngineCardCopy = Partial<Record<Severity, ResultCopy>>;

const TRACKERS: Pick<ResultCopy, 'pro' | 'button'> = { pro: PRO_LINE['tracker-blocking'], button: 'Block trackers with Pro' };
const PHOTOS: Pick<ResultCopy, 'pro' | 'button'> = { pro: PRO_LINE['photo-cleaning'], button: 'Clean whole folders with Pro' };
/** For results no Pro outcome answers (a password, a permission, a link's safety): Pro is offered, never as the fix. */
const SEPARATELY: Pick<ResultCopy, 'pro' | 'button'> = { pro: 'Separately, blocks tracking scripts and pixels on the sites you open in the app.', button: 'Block trackers with Pro' };

/** Used for any engine or result without its own words. */
export const DEFAULT_CARD_COPY: ResultCopy = {
  meaning: 'Sites learn more about you than the page shows, and trackers carry it from one site to the next.',
  free: 'The free app wipes history, cookies and sessions when you close it.',
  ...TRACKERS,
};

const CLEAN_COPY_FREE = 'Download a clean copy of this file, one file at a time.';
const AGENT_CLOAKING_FREE = 'Agent Cloaking in the free app masks the browser and device sites see.';

export const CARD_COPY: Record<string, EngineCardCopy> = {
  // Red: WebRTC shows a public address other than the one our server saw. Info: every other result.
  // The app can't change an address, so the Pro line says so.
  'whats-my-ip': {
    red: {
      meaning: 'Any page can quietly read this second address, and with a VPN on it can be the real one the VPN should hide.',
      free: 'Switch JavaScript off in the free app and no page can read it.',
      pro: "Blocks tracking scripts and pixels on sites you open, but doesn't change your IP address or include a VPN.",
      button: 'Block trackers with Pro',
    },
    info: {
      meaning: 'Every site you open, and every tracker it loads, gets this address and the rough location that goes with it.',
      pro: "Blocks tracking pixels that tell ad networks your IP, but doesn't change your IP address or include a VPN.",
      button: 'Block trackers with Pro',
    },
  },
  // Amber: three or more concerns, which today only an out-of-date Chrome reaches. Info: every other browser.
  'useragent-analyzer': {
    amber: {
      meaning: 'This browser is out of date and tells every site so, which marks it as missing security fixes.',
      free: AGENT_CLOAKING_FREE,
      pro: 'Blocks the tracking scripts that read details like these to follow you from site to site.',
      button: 'Block trackers with Pro',
    },
    info: {
      meaning: "Every site reads this before the page even loads, and it narrows down which device you're on.",
      free: AGENT_CLOAKING_FREE,
      pro: 'Blocks the tracking scripts that read details like these to follow you from site to site.',
      button: 'Block trackers with Pro',
    },
  },
  // From the effective bits: red under 40 (under a minute at 10 billion guesses a second, or a
  // common password), amber 40 to 64 (about a minute to about 30 years), green 64 and up.
  'password-strength': {
    red: {
      meaning: "A password-cracking rig would guess this in under a minute if a site's password list leaked.",
      free: 'Add a few more words: length adds the most guessing time.',
      ...SEPARATELY,
    },
    amber: {
      meaning: 'It would take a cracking rig from about a minute to a few decades, and a longer password pushes that far out.',
      free: 'Add a few more words: length adds the most guessing time.',
      ...SEPARATELY,
    },
    green: {
      meaning: 'A cracking rig would need decades or more, so reusing it on other sites is now the bigger risk.',
      ...SEPARATELY,
    },
  },
  // Red: GPS, the embedded thumbnail or personal details (an email, a phone number, a name).
  // Amber: device, software, an identifier, a time, a username or hidden text. Green: nothing found.
  'screenshot-leak-checker': {
    red: {
      meaning: 'Anyone who gets the original file can read a location, personal details or a hidden preview copy in it.',
      free: CLEAN_COPY_FREE,
      pro: 'Strips location and other hidden details from a whole folder of photos and screenshots at once.',
      button: 'Clean whole folders with Pro',
    },
    amber: {
      meaning: 'Anyone with the original file can read hidden details such as the device, the app, the time or a username.',
      free: CLEAN_COPY_FREE,
      ...PHOTOS,
    },
    green: {
      meaning: "No hidden details turned up, so what's left to check is what's on screen: names, messages, street signs.",
      ...PHOTOS,
    },
  },
  // The colour is the tool's score (severityFromScore), in all three modes: a URL scan, pasted
  // cookies and this page's cookies. So every line must hold for any result of that colour:
  // green allows one high-risk tracking cookie (100 - 10 - 5 = 85), amber can come from a
  // missing HTTPS alone, red always has a cookie or a tracker, and a pasted list was not
  // necessarily set before consent.
  'cookie-analyzer': {
    red: {
      meaning: 'What this scan found records your visits and can link them together: tracking cookies, trackers or both.',
      free: 'The free app wipes cookies every time you close it.',
      pro: 'Blocks tracking scripts and pixels before they load, on the sites you open in the app.',
      button: 'Block trackers with Pro',
    },
    amber: {
      meaning: 'Something here weakens your privacy: a tracker, an outside script or missing HTTPS; the report names each one.',
      free: 'The free app wipes cookies every time you close it.',
      pro: 'Blocks tracking scripts and pixels on the sites you open in the app, whatever they score.',
      button: 'Block trackers with Pro',
    },
    green: {
      meaning: 'Little or nothing here follows you; the report lists anything it did find.',
      pro: 'Blocks tracking scripts and pixels on the sites that score worse than this one, in the app.',
      button: 'Block trackers with Pro',
    },
  },
  // The score as a share of the points: red under 50, amber 50 to 79, green 80 and up. A shared
  // result (#r=) may be someone else's, so the lines say "these answers", not "you".
  'privacy-quiz': {
    red: {
      meaning: 'These answers earn under half the points, so several common ways to be tracked or broken into are still open.',
      free: 'The free app wipes history, cookies and sessions when you close it.',
      ...TRACKERS,
    },
    amber: {
      meaning: "Some of these habits protect you and some don't, and the lowest-scoring answers are the ones to fix first.",
      free: 'The free app wipes history, cookies and sessions when you close it.',
      ...TRACKERS,
    },
    green: {
      meaning: "These habits are strong overall, and any answer that lost points shows what's left to tighten.",
      ...TRACKERS,
    },
  },
  // Amber: a permission that normally asks is allowed. Green: none is. Info: the browser reports
  // no permission states at all (Safari, Firefox).
  'permission-checker': {
    amber: {
      meaning: 'This site can use something that normally asks first without asking you again, until you take it back.',
      free: "Remove it in site settings; the report gives your browser's address.",
      ...SEPARATELY,
    },
    green: {
      meaning: 'This browser reports nothing that lets this site skip asking you first, which is how it should be.',
      ...SEPARATELY,
    },
    info: {
      meaning: "This browser doesn't show web pages its permission settings, so check them in its own site settings.",
      ...SEPARATELY,
    },
  },
  // Red: a tracking pixel. Amber: no pixel, but tracked links or other remote images. Green: none.
  // Pro blocks pixels on web pages in the app, not in a mail app, and the lines say so.
  'email-pixel-detector': {
    red: {
      meaning: 'Opening this email with images on tells the sender when you read it, roughly where, and on what device.',
      free: 'In the free app, turn images off before opening webmail.',
      pro: 'Blocks tracking pixels like this one on web pages you open in the app, though not in your mail app.',
      button: 'Block trackers with Pro',
    },
    amber: {
      meaning: 'No tracking pixel, but its links or images can still tell the sender you opened it or clicked.',
      free: 'Unwrap a tracked link with the free Link Unwrapper before you click.',
      pro: 'Blocks tracking scripts and pixels on the pages these links lead to, if you open them in the app.',
      button: 'Block trackers with Pro',
    },
    green: {
      meaning: 'We found nothing in this email that reports back when you open it; replies and clicks still tell the sender.',
      pro: 'Blocks tracking scripts and pixels on the web pages you open in the app.',
      button: 'Block trackers with Pro',
    },
  },
  // classifyDnsLeak (lib/dns-leak.ts): red is lookups leaving the tunnel (the ISP baseline's
  // network, or several networks with no baseline); amber inconclusive, VPN on or off; green the
  // VPN's network, or not the ISP baseline's; info a VPN-off baseline. Pro changes none of it.
  'dns-leak-test': {
    red: {
      meaning: "Some or all of your lookups skip the VPN, so a resolver outside it, often your ISP's, sees the sites you open.",
      free: "Turn on your VPN app's DNS leak protection, if it has one.",
      pro: "Separately, blocks tracking scripts and pixels, but doesn't change your DNS. Pro doesn't include a VPN.",
      button: 'Block trackers with Pro',
    },
    amber: {
      meaning: "This run couldn't settle who answers your lookups, so it can't say yet whether they leak.",
      free: 'Run it once with the VPN off, then again with it on.',
      pro: "Separately, blocks tracking scripts and pixels, but doesn't change your DNS. Pro doesn't include a VPN.",
      button: 'Block trackers with Pro',
    },
    green: {
      meaning: "Your lookups are answered by your VPN or a resolver you chose, not by your ISP's resolver.",
      pro: "Separately, blocks tracking scripts and pixels, but doesn't change your DNS. Pro doesn't include a VPN.",
      button: 'Block trackers with Pro',
    },
    info: {
      meaning: 'With the VPN off, these are the resolvers your connection normally uses, which a leak test compares against.',
      free: 'Turn your VPN on and run the test again here.',
      pro: "Separately, blocks tracking scripts and pixels, but doesn't change your DNS. Pro doesn't include a VPN.",
      button: 'Block trackers with Pro',
    },
  },
  // Red: an identity-level click ID. Amber: campaign tags, redirect hops, a wrapper it could not
  // decode or a shortener. Green: none of those.
  'link-unwrapper': {
    red: {
      meaning: 'This link carries an ID that can tie the click to you personally, not just to a campaign.',
      free: 'Copy the clean link and share or open that one instead.',
      pro: 'Blocks the tracking scripts and pixels on the page it opens, which read IDs like this.',
      button: 'Block trackers with Pro',
    },
    amber: {
      meaning: 'No personal ID was found, but its tags or redirects still record where this click came from.',
      free: 'Copy the clean link and share or open that one instead.',
      pro: 'Blocks the tracking scripts and pixels on the page a link like this opens, in the app.',
      button: 'Block trackers with Pro',
    },
    green: {
      meaning: 'This link carries no tracking tags or redirects, though the page it opens may still load trackers.',
      pro: 'Blocks the tracking scripts and pixels that page may load, when you open it in the app.',
      button: 'Block trackers with Pro',
    },
  },
  // The audit's score: red under 50, amber 50 to 79, green 80 and up. Pro doesn't change what these
  // checks read, so the Pro line doesn't say it does.
  'browser-privacy': {
    red: {
      meaning: 'This browser gives sites a lot to work with, and together those details can pick out your device without cookies.',
      free: AGENT_CLOAKING_FREE,
      pro: 'Blocks the tracking scripts and pixels that follow you from site to site in the app.',
      button: 'Block trackers with Pro',
    },
    amber: {
      meaning: "Some checks pass, but the ones that don't still help sites tell this browser apart from others.",
      free: AGENT_CLOAKING_FREE,
      pro: 'Blocks the tracking scripts and pixels that follow you from site to site in the app.',
      button: 'Block trackers with Pro',
    },
    green: {
      meaning: 'This browser passes most checks, though every browser still shows sites details like its screen and time zone.',
      pro: 'Blocks the tracking scripts and pixels that follow you from site to site in the app.',
      button: 'Block trackers with Pro',
    },
  },
  // urlVerdict: red is any high-risk finding (no HTTPS, a raw IP, "@", look-alike letters, an
  // imitated brand, an invalid URL); amber a warning, or an unknown site checked by structure only;
  // green only a known domain with neither.
  'url-analyzer': {
    red: {
      meaning: "This link shows at least one sign common in phishing or unencrypted links, so don't sign in or pay through it.",
      free: "Type the real site's address yourself and sign in there.",
      ...SEPARATELY,
    },
    amber: {
      meaning: "This link isn't clearly bad or clearly fine, so type the site's address yourself before you sign in.",
      free: 'Search for the site by name instead of using this link.',
      ...SEPARATELY,
    },
    green: {
      meaning: "The domain is one this checker knows, and the link's structure shows no phishing signs.",
      ...SEPARATELY,
    },
  },
  // summarizeMetadata (lib/exif.ts): red is GPS or a high-risk field (a name, a place, a serial
  // number, a unique ID); amber a medium-risk field or a block it could not decode; green only
  // technical fields, in what it reads; info a file it can't read (HEIC, AVIF, unknown).
  // Pro cleans whole folders; this viewer and its clean copy are one photo at a time.
  'metadata-viewer': {
    red: {
      meaning: 'Anyone you send this file to can read where it was taken or details that point to you or the camera.',
      free: 'Strip it here and download a clean copy, one photo at a time.',
      ...PHOTOS,
    },
    amber: {
      meaning: "The file holds more than the picture, such as the device, the time or parts this viewer can't decode.",
      free: 'Strip it here and download a clean copy, one photo at a time.',
      ...PHOTOS,
    },
    green: {
      meaning: "The fields this viewer reads hold no location, device or time, so what's left to check is the picture itself.",
      ...PHOTOS,
    },
    info: {
      meaning: "This viewer can't read this file's metadata, so save it as a JPEG and check that copy instead.",
      ...PHOTOS,
    },
  },
  // Share of bait requests blocked: red under 50%, amber 50 to 89%, green 90% and up. Pro's
  // blocking hasn't been run against this test, so no line quotes a Pro score.
  'ad-blocker-test': {
    red: {
      meaning: 'Most ad and tracking requests got through, so sites you open in this browser can follow you to the next.',
      free: 'The free Incognito Browser app blocks ads on Android.',
      pro: "Blocks tracking scripts and pixels too, on top of the free app's ad blocker.",
      button: 'Block trackers too with Pro',
    },
    amber: {
      meaning: 'This browser stopped some of them, but the rest still let ad networks count your visit.',
      free: 'The free Incognito Browser app blocks ads on Android.',
      pro: 'Blocks tracking scripts and pixels on Android, on top of the ads the free app blocks.',
      button: 'Block trackers too with Pro',
    },
    green: {
      meaning: "This browser stopped nearly all of them, but your phone's browser is a separate test.",
      pro: 'Hides the empty boxes and banners that blocked ads leave behind, in the app on Android.',
      button: 'Hide empty ad boxes with Pro',
    },
  },
};

/** The words for one result, following the order in the module comment. */
export function resolveCardCopy(engine: string, severity: Severity, answer: PageFunnelV2 | null): CardCopy {
  const sev = severity as FunnelSeverity;
  const copy = answer?.results[sev] ?? CARD_COPY[engine]?.[severity] ?? DEFAULT_CARD_COPY;
  return { ...copy, benefit: benefitOf(copy.pro) ?? 'tracker-blocking' };
}

/**
 * A report card's words when its page has none of its own: the scan-aware
 * line (reportCardLine never calls a card with trackers "clean") as the
 * meaning, and tracker blocking as the ask — what the card just listed.
 */
export function reportCardCopy(grade: Grade, severity: Severity, found: { trackingCookies: number; trackers: number; pixels?: number }): CardCopy {
  return { meaning: reportCardLine(grade, severity, found).headline, ...TRACKERS, benefit: 'tracker-blocking' };
}

/** "No data shared with third parties" in the middle of a line. */

/**
 * Social proof, from the Google Play listing only (data/brand.json `play`,
 * with the month it was read; tests/play-proof.test.ts fails when it is more
 * than 90 days old). Visible text, never structured data (brand.json
 * neverClaim). Data safety is linked, not quoted, so the card doesn't pick
 * its most flattering line.
 */
const CHECKED_MONTH = new Date(`${brand.play.checkedOn}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
export const PLAY_PROOF = `Google Play, ${CHECKED_MONTH}: ★ ${brand.play.rating} · ${brand.play.reviewsLabel} · ${brand.play.downloadsLabel}`;
export const DATA_SAFETY_URL = brand.dataSafety.source;

/**
 * Gate copy (owner, 2026-09-18): a secondary action on each Pro tool that
 * genuinely restricts something — not the core free result, which every
 * engine always delivers in full. Each headline/stake/free/pro/button holds
 * to the same limits as CARD_LIMITS; the Pro line is always PRO_LINE
 * verbatim, so a gate can never claim more than the result card already
 * claims (tests/gate-copy.test.ts).
 */
export type GateAction = 'cookie-csv-export' | 'browser-privacy-rerun' | 'metadata-multi-file';

export interface GateCopy {
  /** Within CARD_LIMITS.headline (90 chars) — a budget every card reserves but none has used until now. */
  headline: string;
  /** Within CARD_LIMITS.meaning (120 chars), one sentence, grounded in the action just attempted. */
  stake: string;
  /** Within CARD_LIMITS.free (70 chars): the true, always-available free alternative. */
  free: string;
  /** Within CARD_LIMITS.pro (110 chars): one of PRO_LINE's values, verbatim. */
  pro: string;
  /** Within CARD_LIMITS.button (28 chars): an existing validated button string. */
  button: string;
  benefit: Benefit;
}

export const GATE_COPY: Record<GateAction, GateCopy> = {
  'cookie-csv-export': {
    headline: "CSV export isn't part of the free scanner",
    stake: 'Every cookie and tracker this scan found is already listed on this page — CSV just isn\'t free to download.',
    free: 'Read every finding above, or scan another page — both stay free.',
    pro: PRO_LINE['tracker-blocking'],
    button: 'Block trackers with Pro',
    benefit: 'tracker-blocking',
  },
  'browser-privacy-rerun': {
    headline: 'This audit already ran once this visit',
    stake: "This browser's full audit already ran once this visit; running it again is the part that's gated.",
    free: 'Reload this page to run the audit again, free, any time.',
    pro: 'Blocks the tracking scripts and pixels that follow you from site to site in the app.',
    button: 'Block trackers with Pro',
    benefit: 'tracker-blocking',
  },
  'metadata-multi-file': {
    headline: 'One photo at a time is free',
    stake: 'This reader checks one photo at a time; picking more than one at once is the part that needs Pro.',
    free: 'Check them here one at a time — free, no limit.',
    pro: PRO_LINE['photo-cleaning'],
    button: 'Clean whole folders with Pro',
    benefit: 'photo-cleaning',
  },
};
