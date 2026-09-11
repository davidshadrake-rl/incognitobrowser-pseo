/**
 * Result-moment CTA copy — one source of truth.
 *
 * The conversion is: free web tools + the free Incognito Browser Android app
 * → the paid Incognito Pro subscription. The ask arrives when the visitor has
 * just seen THEIR exposure, so copy is composed from three parts:
 *   1. the engine's severity line (what the result means + what helps),
 *   2. the niche hook (the fear that opened this door),
 *   3. the Pro benefits (ordered per engine).
 * Everything here is data; components only compose it.
 *
 * Every product claim must be backed, and there are only two sources:
 *   - PRO_DEFINITION (lib/tiers.ts): Pro adds ad and tracker blocking and the
 *     deeper privacy tools. There is NO VPN (owner, 2026-09-10) — never add one.
 *   - the free app's verified features in data/brand.json: history, cookies
 *     and sessions wiped on exit; a built-in ad blocker; Agent Cloaking.
 * Earlier copy promised automatic photo stripping, link cleaning, WebRTC and
 * canvas blocking and permission audits. None of that is confirmed to ship,
 * so none of it is claimed. tests/no-vpn-claims.test.ts guards the VPN part.
 */
import type { Severity } from '@/components/tools/ResultContext';
import type { IconName } from '@/components/ui/Icon';
import { GRADE_LABEL, type Grade } from '@/lib/site-grade';

export type ProBenefit = 'adblock' | 'tools' | 'more';

/** Icon per benefit tile (DESIGN-SPEC 5.4, ResultCta). */
export const PRO_BENEFITS: Record<ProBenefit, { title: string; line: string; icon: IconName }> = {
  adblock: { title: 'Pro ad and tracker blocking', line: 'blocks ads and the tracker requests behind them as you browse.', icon: 'block' },
  tools: { title: 'The Pro privacy tools', line: 'the cookie scanner, fingerprint audit, link checker and photo metadata viewer.', icon: 'finger' },
  more: { title: 'On top of the free app', line: 'which already wipes history, cookies and sessions every time you close it.', icon: 'star' },
};

export interface SeverityCopy { headline: string; body: string }

export interface EngineCopy {
  /** Which Pro benefits answer this tool's result, most specific first. */
  benefits: ProBenefit[];
  red: SeverityCopy;
  amber: SeverityCopy;
  green: SeverityCopy;
  info: SeverityCopy;
}

const GREEN_DEFAULT: SeverityCopy = {
  headline: 'You are protected here. Keep it that way everywhere.',
  body: 'Incognito Pro adds ad and tracker blocking and the deeper privacy tools to the free Incognito Browser app.',
};
const INFO_DEFAULT: SeverityCopy = {
  headline: 'Take this protection with you.',
  body: 'Incognito Browser wipes history, cookies and sessions every time you close it. Incognito Pro adds ad and tracker blocking and the deeper privacy tools.',
};

export const ENGINE_COPY: Record<string, EngineCopy> = {
  'browser-privacy': {
    benefits: ['tools', 'adblock', 'more'],
    red: { headline: 'Your browser is exposing you right now.', body: 'Agent Cloaking in Incognito Browser masks the browser and device sites see, and this audit comes with Incognito Pro, so you can check again after you switch.' },
    amber: { headline: 'Partly protected. The gaps are the ones trackers use.', body: 'Agent Cloaking in Incognito Browser masks the browser and device sites see. Run this audit again from Incognito Pro to compare.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'cookie-analyzer': {
    benefits: ['adblock', 'tools', 'more'],
    red: { headline: 'This site tracks you before you agree to anything.', body: 'Incognito Browser wipes every cookie when you close it, and Incognito Pro\'s ad and tracker blocking stops many requests like these before they load.' },
    amber: { headline: 'Some tracking gets through here.', body: 'Incognito Pro\'s ad and tracker blocking stops many requests like these, and the browser wipes cookies every time you close it.' },
    green: { headline: 'Clean site. Most are not.', body: 'Incognito Pro\'s ad and tracker blocking covers the sites that are not this careful.' }, info: INFO_DEFAULT,
  },
  'url-analyzer': {
    benefits: ['tools', 'adblock', 'more'],
    red: { headline: 'This link has the marks of a phishing attempt.', body: 'Don\'t open it. This link checker comes with Incognito Pro, so you can check links on your phone before you tap them.' },
    amber: { headline: 'This link is not clearly safe.', body: 'Check links like this before you open them. The link checker comes with Incognito Pro.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'metadata-viewer': {
    benefits: ['tools', 'more', 'adblock'],
    red: { headline: 'This photo gives away where it was taken.', body: 'Save a clean copy before you share it. This viewer and its clean-copy tool come with Incognito Pro.' },
    amber: { headline: 'This photo carries device and time data.', body: 'Save a clean copy before you share it. This viewer comes with Incognito Pro.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'whats-my-ip': {
    benefits: ['tools', 'more', 'adblock'],
    red: { headline: 'Your real IP is visible to every site you visit.', body: 'A browser can\'t change the address sites see. What Incognito Browser does is wipe cookies and sessions every time you close it, so sites can\'t link your visits by cookie.' },
    amber: { headline: 'Your VPN is on, but the browser can still leak.', body: 'The fingerprint audit in Incognito Pro shows what else this browser gives away besides your IP.' },
    green: GREEN_DEFAULT, info: { headline: 'This is what every site sees.', body: 'Incognito Browser can\'t change this address, but it wipes cookies and sessions every time you close it, so sites can\'t link your visits by cookie.' },
  },
  'dns-leak-test': {
    benefits: ['tools', 'more', 'adblock'],
    red: { headline: 'Your DNS is leaking. Your ISP still sees every site you visit.', body: 'The fix is in your VPN\'s settings or your phone\'s Private DNS setting. Incognito Browser wipes what is left on the phone every time you close it.' },
    amber: { headline: 'We could not confirm your DNS is protected.', body: 'Check your VPN\'s DNS setting, or turn on Private DNS on your phone, then run the test again.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'ad-blocker-test': {
    benefits: ['adblock', 'more', 'tools'],
    red: { headline: 'Most ad and tracker requests got through.', body: 'Incognito Browser has an ad blocker built in, and Incognito Pro adds ad and tracker blocking on top.' },
    amber: { headline: 'Your blocker misses some of what matters.', body: 'Incognito Pro\'s ad and tracker blocking catches tracker requests a basic ad blocker lets through.' },
    green: { headline: 'Well blocked. Take it to your phone.', body: 'Incognito Browser brings a built-in ad blocker to Android, where browser extensions are rare.' }, info: INFO_DEFAULT,
  },
  'password-strength': {
    benefits: ['more', 'tools', 'adblock'],
    red: { headline: 'This password falls in seconds.', body: 'Use a long random password or a passphrase of several words, and keep it in a password manager.' },
    amber: { headline: 'This password would not last a determined attack.', body: 'Make it longer, or switch to a passphrase of several unrelated words.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'password-generator': { benefits: ['more', 'tools', 'adblock'], red: GREEN_DEFAULT, amber: GREEN_DEFAULT, green: GREEN_DEFAULT, info: { headline: 'Strong passwords, wherever you sign up.', body: 'Incognito Browser wipes history, cookies and sessions every time you close it, so a shared phone keeps none of your sign-ins.' } },
  'hash-generator': { benefits: ['tools', 'more', 'adblock'], red: GREEN_DEFAULT, amber: GREEN_DEFAULT, green: GREEN_DEFAULT, info: { headline: 'Verify downloads on the go.', body: 'Incognito Pro adds the deeper privacy tools and ad and tracker blocking to the Incognito Browser app.' } },
  'text-encryption': { benefits: ['more', 'tools', 'adblock'], red: GREEN_DEFAULT, amber: GREEN_DEFAULT, green: GREEN_DEFAULT, info: { headline: 'Encrypt anywhere, not only here.', body: 'Incognito Browser keeps no browsing history or cache on the phone, so what you open does not stay behind after you close it.' } },
  'useragent-analyzer': {
    benefits: ['more', 'tools', 'adblock'],
    red: { headline: 'Your browser announces exactly what you run.', body: 'Agent Cloaking in Incognito Browser masks the browser and device that sites see.' },
    amber: { headline: 'Your browser reveals more than it needs to.', body: 'Agent Cloaking in Incognito Browser changes what sites read here.' },
    green: GREEN_DEFAULT, info: { headline: 'This is what every site reads first.', body: 'Agent Cloaking in Incognito Browser changes what sites read here.' },
  },
  'permission-checker': {
    benefits: ['more', 'adblock', 'tools'],
    red: { headline: 'Sites hold permissions they should not.', body: 'Revoke them in your browser\'s site settings. The steps are listed above.' },
    amber: { headline: 'Some permissions are one prompt away.', body: 'Say no to prompts you did not expect; you can change your mind later in site settings.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'privacy-quiz': {
    benefits: ['more', 'adblock', 'tools'],
    red: { headline: 'Your habits leave you exposed.', body: 'Incognito Browser covers two of the biggest items by default: it wipes history, cookies and sessions on exit and blocks ads. Incognito Pro adds tracker blocking and the deeper tools.' },
    amber: { headline: 'Good instincts, real gaps.', body: 'Incognito Browser wipes history, cookies and sessions on exit and blocks ads; Incognito Pro adds tracker blocking and the deeper tools.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'link-unwrapper': {
    benefits: ['adblock', 'tools', 'more'],
    red: { headline: 'This link was built to identify you.', body: 'Remove the tracking parameters before you share it. Incognito Pro\'s ad and tracker blocking stops many of the trackers links like this feed.' },
    amber: { headline: 'This link reports which campaign caught you.', body: 'Remove the tracking parameters before you share it.' },
    green: { headline: 'Clean link. Most are not.', body: 'Incognito Pro\'s ad and tracker blocking stops many of the trackers behind the ones that are not.' }, info: INFO_DEFAULT,
  },
  'email-pixel-detector': {
    benefits: ['adblock', 'tools', 'more'],
    red: { headline: 'This email reports back the moment you open it.', body: 'Turn off automatic image loading in your mail app; that stops most tracking pixels.' },
    amber: { headline: 'The links in this email are tracked.', body: 'Open the site directly instead of clicking through the email.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'screenshot-leak-checker': {
    benefits: ['more', 'tools', 'adblock'],
    red: { headline: 'This screenshot leaks more than what is on it.', body: 'Save the clean copy above and share that instead.' },
    amber: { headline: 'This screenshot carries device and time data.', body: 'Save the clean copy above and share that instead.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'report-card': {
    benefits: ['adblock', 'more', 'tools'],
    red: { headline: 'This site tracks you before you click anything.', body: 'Incognito Pro\'s ad and tracker blocking stops many of these before they load, and the browser wipes cookies every time you close it.' },
    amber: { headline: 'This site tracks more than it needs to.', body: 'Incognito Pro\'s ad and tracker blocking stops many trackers like these before they load.' },
    green: { headline: 'A clean site. Most are not.', body: 'Incognito Pro\'s ad and tracker blocking covers the sites that are not this careful.' }, info: INFO_DEFAULT,
  },
};

export const DEFAULT_ENGINE_COPY: EngineCopy = {
  benefits: ['more', 'adblock', 'tools'],
  red: { headline: 'You are exposed here.', body: 'Incognito Browser wipes history, cookies and sessions every time you close it. Incognito Pro adds ad and tracker blocking and the deeper privacy tools.' },
  amber: { headline: 'Partly protected.', body: 'Incognito Browser wipes history, cookies and sessions every time you close it. Incognito Pro adds ad and tracker blocking and the deeper privacy tools.' },
  green: GREEN_DEFAULT, info: INFO_DEFAULT,
};

/** The fear that opened this door, one sentence per niche. Composed in front of the engine line. */
export const NICHE_HOOK: Record<string, string> = {
  'incognito-mode': 'Incognito mode hides your history from your device, not from the sites, your ISP, or advertisers.',
  'browser-privacy': 'Your browser is the single biggest source of what sites learn about you.',
  'ad-tracking': 'Ad networks follow you from site to site to build a profile they sell.',
  'cookie-management': 'Cookies you never agreed to are set before the consent banner even loads.',
  'device-fingerprinting': 'Fingerprinting identifies you without cookies, so clearing them changes nothing.',
  'digital-footprint': 'Every search and every page adds to a footprint you never get to see.',
  'vpn-privacy': 'A VPN that leaks is worse than none: you feel safe while your ISP still watches.',
  'password-security': 'One weak password is the way into every account that shares it.',
  'encrypted-messaging': 'If a message can be read in transit, assume it will be.',
  'private-search': 'Your search history is the most honest diary you keep, and it is being logged.',
  'data-brokers': 'Data brokers assemble your address, income and habits from traces you leave online.',
  'isp-tracking': 'Your ISP sees every domain you visit, encrypted or not.',
  'location-tracking': 'Location is the one data point that turns an online profile into a physical one.',
  'public-wifi': 'On public Wi-Fi, everyone on the network is a potential reader.',
  'phishing': 'Phishing works because the fake page looks right for exactly long enough.',
  'malware-protection': 'Most malware arrives through a link that looked ordinary.',
  'email-privacy': 'Marketing emails report back the moment you open them.',
  'social-media-privacy': 'What you post is public; what you leak in the file is worse.',
  'online-shopping': 'Shops and their ad partners track what you looked at long after you leave.',
  'online-banking': 'Banking is the session attackers want most, and the one you most need clean.',
  'workplace-privacy': 'Your work browser reports more about you than you would tell your manager.',
  'student-privacy': 'Campus networks and ed-tech tools log a lot more than grades.',
  'children-safety': 'Children are tracked as aggressively as adults online, often more.',
  'healthcare-privacy': 'Symptom searches are among the most sensitive things you do online, and ad networks see them.',
  'dating-privacy': 'A photo\'s hidden data can hand a stranger your home location.',
  'smart-home-privacy': 'Smart devices phone home constantly, and their dashboards leak like any site.',
  'webcam-privacy': 'A site with camera permission keeps it until you revoke it.',
  'ai-privacy': 'AI profilers turn small leaks into confident guesses about who you are.',
  'cloud-privacy': 'Files in the cloud are only as private as the link and the account that hold them.',
  'gaming-privacy': 'Gaming platforms fingerprint devices to link accounts, and advertisers ride along.',
  'gdpr': 'Consent banners are theatre when tracking cookies are set before you click.',
  'ccpa': '"Do Not Sell" means nothing if the trackers load first.',
  'us-state-privacy': 'Privacy laws vary by state; trackers do not.',
  'international-privacy': 'Your data crosses borders faster than the laws that protect it.',
  'data-breach': 'After a breach, every password you reused is already in a list.',
  'right-to-forget': 'You can ask to be forgotten, but the trackers are still collecting today.',
  'privacy-policies': 'A privacy policy is a promise; the cookies are the practice.',
  'crypto-privacy': 'On a public ledger, one linked address exposes the whole history.',
  'tor-privacy': 'Tor hides your route, but a fingerprintable browser still names you.',
  'facial-recognition': 'A photo\'s metadata plus your face is a complete identification.',
  'drone-surveillance': 'Aerial photos carry the exact GPS of where they were taken.',
  'browser-extensions': 'Extensions see every page you visit; some sell that.',
  'journalist-privacy': 'For a source, one leaked IP is the whole story.',
  'search-history': 'Search history is the profile advertisers pay the most for.',
};

export interface ComposedCta {
  headline: string;
  body: string;
  benefits: Array<{ key: ProBenefit; title: string; line: string; icon: IconName }>;
}

/**
 * Compose the CTA copy for an engine, niche and severity. Pure. `override`
 * replaces the engine's severity line when the result itself decides the
 * wording (see reportCardLine); the niche hook and benefits still apply.
 */
export function composeCta(engine: string, niche: string | undefined, severity: Severity, override?: SeverityCopy): ComposedCta {
  const e = ENGINE_COPY[engine] || DEFAULT_ENGINE_COPY;
  const line = override || e[severity] || e.info;
  const hook = niche ? NICHE_HOOK[niche] : undefined;
  return {
    headline: line.headline,
    body: hook ? `${hook} ${line.body}` : line.body,
    benefits: e.benefits.slice(0, 3).map((key) => ({ key, ...PRO_BENEFITS[key] })),
  };
}

/**
 * The report-card line, picked from the scan instead of the letter. Every A
 * and B used to get "A clean site. Most are not." — including 133 cards
 * listing ad trackers or tracking cookies right above it (CTO review
 * 2026-09-10). "Clean" now needs no tracking cookies and no trackers of any
 * kind (the count the page lists under "Trackers loaded on the homepage"),
 * so it can never contradict that list; otherwise the line says what loads.
 */
export function reportCardLine(grade: Grade, severity: Severity, found: { trackingCookies: number; trackers: number; pixels?: number }): SeverityCopy {
  const copy = ENGINE_COPY['report-card'];
  if (severity !== 'green') return copy[severity] || copy.info;
  const { trackingCookies, trackers, pixels = 0 } = found;
  if (!trackingCookies && !trackers && !pixels) return copy.green;
  const count = (n: number, one: string, many: string) => (n ? `${n} ${n === 1 ? one : many}` : '');
  const parts = [count(trackers, 'tracker', 'trackers'), count(pixels, 'tracking pixel', 'tracking pixels'), count(trackingCookies, 'tracking cookie', 'tracking cookies')].filter(Boolean);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return {
    headline: `${GRADE_LABEL[grade]}, but still ${list} before you click anything.`,
    body: 'Incognito Pro\'s ad and tracker blocking stops many trackers like these before they load.',
  };
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

/** Copy for a visitor who is already inside the free Incognito Browser app (population B). */
export const IN_APP_COPY = {
  headline: 'You already use Incognito Browser. Pro finishes the job.',
  body: 'Upgrade inside the app for Pro ad and tracker blocking and the deeper privacy tools.',
  button: 'Upgrade to Pro',
};
