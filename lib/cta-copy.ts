/**
 * Result-moment CTA copy — one source of truth.
 *
 * The conversion is: free web tools + the free Incognito Browser Android app
 * → the paid Incognito Pro subscription (these tools built in, the VPN, pro
 * ad blocking, and more). The ask arrives when the visitor has just seen
 * THEIR exposure, so copy is composed from three parts:
 *   1. the engine's severity line (what the result means + the specific fix),
 *   2. the niche hook (the fear that opened this door),
 *   3. the Pro benefits that answer it (ordered per engine).
 * Everything here is data; components only compose it.
 */
import type { Severity } from '@/components/tools/ResultContext';
import type { IconName } from '@/components/ui/Icon';

export type ProBenefit = 'vpn' | 'adblock' | 'tools' | 'more';

/** Icon per benefit tile (DESIGN-SPEC 5.4, ResultCta). */
export const PRO_BENEFITS: Record<ProBenefit, { title: string; line: string; icon: IconName }> = {
  vpn: { title: 'Built-in VPN', line: 'hides your real IP and location from every site and your ISP.', icon: 'shield' },
  adblock: { title: 'Pro ad blocking', line: 'stops ads and the trackers behind them before they load.', icon: 'block' },
  tools: { title: 'Every tool built in', line: 'the checks on this site run inside the browser, on every page you visit.', icon: 'finger' },
  more: { title: 'And more', line: 'one subscription, every Pro protection, no accounts on our side.', icon: 'star' },
};

interface SeverityCopy { headline: string; body: string }

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
  body: 'Incognito Pro makes this the default on every site, with the VPN and pro ad blocking included.',
};
const INFO_DEFAULT: SeverityCopy = {
  headline: 'Take this protection with you.',
  body: 'Incognito Pro puts this tool, the VPN and pro ad blocking in one browser on your phone.',
};

export const ENGINE_COPY: Record<string, EngineCopy> = {
  'browser-privacy': {
    benefits: ['tools', 'vpn', 'adblock'],
    red: { headline: 'Your browser is exposing you right now.', body: 'Incognito Pro blocks canvas fingerprinting and WebRTC leaks, and its VPN hides the real IP this test just found.' },
    amber: { headline: 'Partly protected. The gaps are the ones trackers use.', body: 'Incognito Pro closes the remaining leaks by default and hides your IP with the built-in VPN.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'cookie-analyzer': {
    benefits: ['adblock', 'tools', 'vpn'],
    red: { headline: 'This site tracks you before you agree to anything.', body: 'Incognito Pro blocks these trackers and tracking cookies before they load, on every site.' },
    amber: { headline: 'Some tracking gets through here.', body: 'Incognito Pro blocks the trackers this scan found, automatically.' },
    green: { headline: 'Clean site. Most are not.', body: 'Incognito Pro blocks trackers on the sites that are not this careful.' }, info: INFO_DEFAULT,
  },
  'url-analyzer': {
    benefits: ['tools', 'adblock', 'vpn'],
    red: { headline: 'This link has the marks of a phishing attempt.', body: 'Incognito Pro checks links like this one before you land, and hides your IP if you do.' },
    amber: { headline: 'This link is not clearly safe.', body: 'Incognito Pro flags suspicious links as you browse, not only when you remember to check.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'metadata-viewer': {
    benefits: ['tools', 'more', 'vpn'],
    red: { headline: 'This photo gives away where it was taken.', body: 'Incognito Pro strips location and device data from uploads automatically.' },
    amber: { headline: 'This photo carries device and time data.', body: 'Incognito Pro strips metadata from every upload so you never have to remember.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'whats-my-ip': {
    benefits: ['vpn', 'tools', 'adblock'],
    red: { headline: 'Your real IP is visible to every site you visit.', body: 'The VPN in Incognito Pro hides it, and the browser stops WebRTC from leaking it around the VPN.' },
    amber: { headline: 'Your VPN is on, but the browser can still leak.', body: 'Incognito Pro blocks WebRTC leaks so the VPN actually holds.' },
    green: GREEN_DEFAULT, info: { headline: 'This is what every site sees.', body: 'The VPN in Incognito Pro replaces it with a shared address on every page.' },
  },
  'dns-leak-test': {
    benefits: ['vpn', 'tools', 'adblock'],
    red: { headline: 'Your DNS is leaking. Your ISP still sees every site you visit.', body: 'The VPN in Incognito Pro routes DNS through the tunnel, so nothing leaks to your ISP.' },
    amber: { headline: 'We could not confirm your DNS is protected.', body: 'The VPN in Incognito Pro keeps DNS inside the tunnel by design.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'ad-blocker-test': {
    benefits: ['adblock', 'tools', 'vpn'],
    red: { headline: 'Most ad and tracker requests got through.', body: 'Incognito Pro blocks these requests before they leave your phone.' },
    amber: { headline: 'Your blocker misses some of what matters.', body: 'Incognito Pro blocks ads and the trackers behind them, no extension needed.' },
    green: { headline: 'Well blocked. Take it to your phone.', body: 'Incognito Pro brings this level of blocking to Android, where extensions are rare.' }, info: INFO_DEFAULT,
  },
  'password-strength': {
    benefits: ['tools', 'vpn', 'more'],
    red: { headline: 'This password falls in seconds.', body: 'Incognito Pro keeps the strength checker one tap away and hides the logins you type from your network.' },
    amber: { headline: 'This password would not last a determined attack.', body: 'Incognito Pro keeps this checker built in, and the VPN protects your logins on any network.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'password-generator': { benefits: ['tools', 'vpn', 'more'], red: GREEN_DEFAULT, amber: GREEN_DEFAULT, green: GREEN_DEFAULT, info: { headline: 'Strong passwords, wherever you sign up.', body: 'Incognito Pro keeps the generator built in and hides your sign-ups from your network with the VPN.' } },
  'hash-generator': { benefits: ['tools', 'more', 'vpn'], red: GREEN_DEFAULT, amber: GREEN_DEFAULT, green: GREEN_DEFAULT, info: { headline: 'Verify downloads on the go.', body: 'Incognito Pro puts the hash generator and every other tool in your browser.' } },
  'text-encryption': { benefits: ['tools', 'vpn', 'more'], red: GREEN_DEFAULT, amber: GREEN_DEFAULT, green: GREEN_DEFAULT, info: { headline: 'Encrypt anywhere, not only here.', body: 'Incognito Pro keeps this encryption tool built in and hides your traffic with the VPN.' } },
  'useragent-analyzer': {
    benefits: ['tools', 'vpn', 'adblock'],
    red: { headline: 'Your browser announces exactly what you run.', body: 'Incognito Pro reduces what your browser reveals and hides your IP with the VPN.' },
    amber: { headline: 'Your browser reveals more than it needs to.', body: 'Incognito Pro trims what your browser announces and hides your IP.' },
    green: GREEN_DEFAULT, info: { headline: 'This is what every site reads first.', body: 'Incognito Pro reveals less, and its VPN hides where you are.' },
  },
  'permission-checker': {
    benefits: ['tools', 'more', 'adblock'],
    red: { headline: 'Sites hold permissions they should not.', body: 'Incognito Pro audits permissions on every site and drops them when you leave.' },
    amber: { headline: 'Some permissions are one prompt away.', body: 'Incognito Pro makes deny the default and shows you who asks.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'privacy-quiz': {
    benefits: ['tools', 'vpn', 'adblock'],
    red: { headline: 'Your habits leave you exposed.', body: 'Incognito Pro fixes the biggest items on your list by default: trackers blocked, IP hidden, tools built in.' },
    amber: { headline: 'Good instincts, real gaps.', body: 'Incognito Pro covers the gaps automatically with the VPN and pro ad blocking.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'link-unwrapper': {
    benefits: ['adblock', 'tools', 'vpn'],
    red: { headline: 'This link was built to identify you.', body: 'Incognito Pro strips tracking parameters from links automatically and blocks the trackers they feed.' },
    amber: { headline: 'This link reports which campaign caught you.', body: 'Incognito Pro cleans links as you tap them.' },
    green: { headline: 'Clean link. Most are not.', body: 'Incognito Pro cleans the ones that are not, automatically.' }, info: INFO_DEFAULT,
  },
  'email-pixel-detector': {
    benefits: ['adblock', 'tools', 'vpn'],
    red: { headline: 'This email reports back the moment you open it.', body: 'Incognito Pro blocks tracking pixels and wrapped links when you read mail in the browser, and the VPN hides where you opened it.' },
    amber: { headline: 'The links in this email are tracked.', body: 'Incognito Pro cleans tracked links and blocks the beacons behind them.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'screenshot-leak-checker': {
    benefits: ['tools', 'more', 'vpn'],
    red: { headline: 'This screenshot leaks more than what is on it.', body: 'Incognito Pro strips metadata from every image you upload, automatically.' },
    amber: { headline: 'This screenshot carries device and time data.', body: 'Incognito Pro strips it from uploads so you never have to remember.' },
    green: GREEN_DEFAULT, info: INFO_DEFAULT,
  },
  'report-card': {
    benefits: ['adblock', 'vpn', 'tools'],
    red: { headline: 'This site tracks you before you click anything.', body: 'Incognito Pro blocks these trackers and tracking cookies before they load, on every site.' },
    amber: { headline: 'This site tracks more than it needs to.', body: 'Incognito Pro blocks the trackers this report found, automatically.' },
    green: { headline: 'A clean site. Most are not.', body: 'Incognito Pro blocks trackers on the sites that are not this careful.' }, info: INFO_DEFAULT,
  },
};

export const DEFAULT_ENGINE_COPY: EngineCopy = {
  benefits: ['tools', 'vpn', 'adblock'],
  red: { headline: 'You are exposed here.', body: 'Incognito Pro closes this by default, with the VPN and pro ad blocking included.' },
  amber: { headline: 'Partly protected.', body: 'Incognito Pro closes the gaps by default, with the VPN and pro ad blocking included.' },
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

/** Compose the CTA copy for an engine, niche and severity. Pure. */
export function composeCta(engine: string, niche: string | undefined, severity: Severity): ComposedCta {
  const e = ENGINE_COPY[engine] || DEFAULT_ENGINE_COPY;
  const line = e[severity] || e.info;
  const hook = niche ? NICHE_HOOK[niche] : undefined;
  return {
    headline: line.headline,
    body: hook ? `${hook} ${line.body}` : line.body,
    benefits: e.benefits.slice(0, 3).map((key) => ({ key, ...PRO_BENEFITS[key] })),
  };
}

/** Copy for a visitor who is already inside the free Incognito Browser app (population B). */
export const IN_APP_COPY = {
  headline: 'You already use Incognito Browser. Pro finishes the job.',
  body: 'Upgrade inside the app for the VPN, pro ad blocking and every tool on this site built in.',
  button: 'Upgrade to Pro',
};
