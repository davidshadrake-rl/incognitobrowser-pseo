/**
 * Every content page is a door; only tools produce proof. This router maps
 * a niche to the free, published tool that lets that visitor try the topic
 * on their own browser — preferring a tool in the same niche, then a themed
 * fallback, then the universal one (What's My IP). Pure over the data directory.
 *
 * The card copy is written per ENGINE, never composed from the niche name:
 * the old "The <niche> check that shows your own number in one tap" line was
 * false on most pages (tools with no number, tools that need typing or a
 * file, a button that only opens another page).
 */
import { getContentFiles, getContentItem, isToolListed } from './content';
import { IS_PRO_DEPLOYMENT, proUrlFor, tierOfEngine } from './tiers';
import { proHandoffTitle } from './cta-copy';

interface ToolMeta { title: string; toolEngine?: string; description?: string }

/** Themed fallbacks when a niche has no free tool of its own. */
const FALLBACK_ENGINE: Record<string, string> = {
  'device-fingerprinting': 'useragent-analyzer',
  'browser-privacy': 'useragent-analyzer',
  'incognito-mode': 'useragent-analyzer',
  'browser-extensions': 'ad-blocker-test',
  // Tor hides the route, so "which IP do sites see?" is the check a Tor reader actually runs.
  'tor-privacy': 'whats-my-ip',
  'private-search': 'useragent-analyzer',
  'ad-tracking': 'ad-blocker-test',
  'cookie-management': 'ad-blocker-test',
  'isp-tracking': 'dns-leak-test',
  'vpn-privacy': 'dns-leak-test',
  'public-wifi': 'whats-my-ip',
  'location-tracking': 'whats-my-ip',
  'journalist-privacy': 'whats-my-ip',
  'phishing': 'link-unwrapper',
  'malware-protection': 'link-unwrapper',
  'online-shopping': 'link-unwrapper',
  'email-privacy': 'email-pixel-detector',
  'dating-privacy': 'screenshot-leak-checker',
  'facial-recognition': 'screenshot-leak-checker',
  'drone-surveillance': 'screenshot-leak-checker',
  'social-media-privacy': 'screenshot-leak-checker',
  'webcam-privacy': 'permission-checker',
  'smart-home-privacy': 'permission-checker',
  'children-safety': 'permission-checker',
  'password-security': 'password-strength',
  'online-banking': 'password-strength',
  'data-breach': 'password-strength',
  'digital-footprint': 'privacy-quiz',
  'data-brokers': 'privacy-quiz',
  'right-to-forget': 'privacy-quiz',
  'search-history': 'privacy-quiz',
  'student-privacy': 'privacy-quiz',
  'healthcare-privacy': 'privacy-quiz',
  'encrypted-messaging': 'text-encryption',
  'cloud-privacy': 'text-encryption',
  'gaming-privacy': 'useragent-analyzer',
};
const UNIVERSAL_ENGINE = 'whats-my-ip';

/**
 * Niches no free tool fits: their pages show no card at all. An Ad-Blocker
 * Test on a GDPR policy template, a user-agent readout on an AI-privacy
 * guide, a habits quiz on a state-law page or a hash generator on a crypto
 * checklist left readers asking what the card was for (CTO review 2026-09-10).
 * The niche's own tool page, if it has one, is still linked from the page's
 * related-content blocks.
 */
export const NO_FITTING_TOOL = new Set<string>([
  'ai-privacy',
  'workplace-privacy',
  'gdpr',
  'ccpa',
  'us-state-privacy',
  'international-privacy',
  'privacy-policies',
  'crypto-privacy',
]);

/**
 * What the card says about each free engine, from the visitor's side:
 *   name   — the tool's name as the /tools catalogue gives it, never a niche
 *            shell title such as "Gaming Browser Analyzer" (65 pages showed it),
 *   gives  — what the visitor finds out or gets,
 *   needs  — what they will have to do or have, so nobody is surprised,
 *   button — names the tool the link opens.
 */
export interface ProofCopy { name: string; gives: string; needs: string; button: string }

export const PROOF_COPY: Record<string, ProofCopy> = {
  'ad-blocker-test': {
    name: 'Ad-Blocker Test',
    gives: 'Find out what share of 50 test ad and tracker requests your ad blocker stops.',
    // Any browser-side blocker counts: an extension, Brave Shields, Safari content blockers. DNS
    // filters (Pi-hole, NextDNS) score 0 by design: every bait is a first-party request under /adtest/.
    needs: 'Needs an ad blocker: an extension, or a browser with one built in. Press Run on the test page; it takes about 5 seconds.',
    button: 'Open the Ad-Blocker Test',
  },
  'whats-my-ip': {
    name: "What's My IP",
    gives: 'See the IP address and rough location every site you visit receives, and whether your browser gives away your real IP behind a VPN.',
    needs: 'Nothing to type. The result appears as soon as the page opens.',
    button: "Open What's My IP",
  },
  'dns-leak-test': {
    name: 'DNS Leak Test',
    gives: 'Find out whether the sites you look up go through your VPN or can still be seen by your internet provider.',
    needs: 'For a clear answer, run it once with your VPN off and once with it on. Each run takes about 10 seconds.',
    button: 'Open the DNS Leak Test',
  },
  'useragent-analyzer': {
    name: 'User Agent Analyzer',
    gives: 'See what your browser tells every site it opens: browser, version, operating system and device type.',
    needs: 'Nothing to type. The result appears as soon as the page opens.',
    button: 'Open the User Agent Analyzer',
  },
  'permission-checker': {
    name: 'Permission Checker',
    gives: 'See which of 11 permissions, such as camera, microphone and location, your browser lets a site use, blocks, or asks you about first.',
    needs: 'Press Check Permissions on the next page. Chrome and Edge give the fullest answer.',
    button: 'Open the Permission Checker',
  },
  'privacy-quiz': {
    name: 'Privacy Score Quiz',
    // One item per question in PrivacyQuizTool's QUESTIONS, in plain words. "Top recommendations" is
    // the quiz's own heading: up to 5 answers scoring under 6, ranked by impact × (10 − answer). It
    // is not a forecast of which change would raise the score most.
    gives: 'Answer 12 questions about your browser, search engine, passwords, two-factor login, email, messaging app, VPN, DNS, updates, app permissions, cookies and social media. You get a score out of 100 and your top recommendations.',
    needs: 'Multiple choice; takes about 2 minutes.',
    button: 'Take the Privacy Score Quiz',
  },
  'password-strength': {
    name: 'Password Strength Checker',
    gives: 'Type a password to see how long it would take to crack and what makes it weak.',
    needs: 'The result updates as you type.',
    button: 'Open the Password Strength Checker',
  },
  'password-generator': {
    name: 'Secure Password Generator',
    gives: 'Get a random password or passphrase at the length you choose.',
    needs: 'Pick a length and character types, then copy the result.',
    button: 'Open the Secure Password Generator',
  },
  'hash-generator': {
    name: 'Cryptographic Hash Generator',
    gives: 'Get the SHA-256 and other hashes of a text or file, to compare with a published checksum.',
    needs: 'Paste text or choose a file.',
    button: 'Open the Cryptographic Hash Generator',
  },
  'text-encryption': {
    name: 'Text Encryption Tool',
    gives: 'Encrypt a message with a passphrase so only someone who has the passphrase can read it.',
    needs: 'Type your message and a passphrase, then copy the encrypted text.',
    button: 'Open the Text Encryption Tool',
  },
  'link-unwrapper': {
    name: 'Link Unwrapper',
    gives: 'Paste a link to see where it really goes and which tracking tags in it identify you.',
    needs: 'Copy a link from an email, message or ad first.',
    button: 'Open the Link Unwrapper',
  },
  'email-pixel-detector': {
    name: 'Email Tracking-Pixel Detector',
    gives: "Find the hidden images and wrapped links in an email that tell the sender you opened it.",
    needs: "You paste the email's source, from Show original or View source in your mail app.",
    button: 'Open the Email Tracking-Pixel Detector',
  },
  'screenshot-leak-checker': {
    name: 'Screenshot Leak Checker',
    gives: 'See the location, device details and personal data stored inside a screenshot or photo before you post it.',
    needs: 'Choose a PNG, JPEG or WebP image.',
    button: 'Open the Screenshot Leak Checker',
  },
};

export interface ProofRoute {
  href: string;
  /** The tool's neutral name (PROOF_COPY), not the destination page's niche-flavoured title. */
  title: string;
  engine: string;
  sameNiche: boolean;
  gives: string;
  needs: string;
  button: string;
}

let index: Map<string, { niche: string; slug: string; title: string }> | null = null;
/** First LISTED page per engine, so a fallback always lands on a real, indexable page. */
function engineIndex() {
  if (index) return index;
  index = new Map();
  for (const f of getContentFiles('tools')) {
    const [niche, slug] = f.split('/');
    if (!isToolListed(niche, slug)) continue;
    const t = getContentItem<ToolMeta>('tools', niche, slug);
    if (t?.toolEngine && !index.has(t.toolEngine)) index.set(t.toolEngine, { niche, slug, title: t.title });
  }
  return index;
}

/** A route only exists for an engine the card knows how to describe; anything else shows no card. */
function route(href: string, engine: string, sameNiche: boolean): ProofRoute | null {
  const copy = PROOF_COPY[engine];
  if (!copy) return null;
  return { href, title: copy.name, engine, sameNiche, gives: copy.gives, needs: copy.needs, button: copy.button };
}

export function proofToolFor(niche: string): ProofRoute | null {
  if (NO_FITTING_TOOL.has(niche)) return null;
  for (const slug of getContentFiles('tools', niche)) {
    if (!isToolListed(niche, slug)) continue;
    const t = getContentItem<ToolMeta>('tools', niche, slug);
    if (t?.toolEngine) {
      const r = route(`/tools/${niche}/${slug}`, t.toolEngine, true);
      if (r) return r;
    }
  }
  const idx = engineIndex();
  for (const engine of [FALLBACK_ENGINE[niche], UNIVERSAL_ENGINE]) {
    const hit = engine ? idx.get(engine) : undefined;
    if (hit && engine) {
      const r = route(`/tools/${hit.niche}/${hit.slug}`, engine, false);
      if (r) return r;
    }
  }
  return null;
}

/**
 * On the free site: the Pro tool page a free tool's result links to — the
 * first Pro tool in the same niche — but only one lib/cta-copy can name, so
 * the link always says which tool it opens (it is rarely the same tool).
 */
export function proHandoffFor(niche: string): string | undefined {
  if (IS_PRO_DEPLOYMENT) return undefined;
  for (const slug of getContentFiles('tools', niche)) {
    const t = getContentItem<ToolMeta>('tools', niche, slug);
    if (t && tierOfEngine(t.toolEngine) === 'pro') {
      const url = proUrlFor(niche, slug);
      return proHandoffTitle(url) ? url : undefined;
    }
  }
  return undefined;
}

/** Test hook. */
export function _resetProofIndexForTests() { index = null; }
