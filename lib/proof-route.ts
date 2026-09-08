/**
 * Every content page is a door; only tools produce proof. This router maps
 * a niche to the free, published tool that gives that visitor THEIR number
 * in one tap — preferring a tool in the same niche, then a themed fallback,
 * then the universal one (What's My IP). Pure over the data directory.
 */
import { getContentFiles, getContentItem, isToolListed } from './content';

interface ToolMeta { title: string; toolEngine?: string; description?: string }

/** Themed fallbacks when a niche has no free tool of its own. */
const FALLBACK_ENGINE: Record<string, string> = {
  'device-fingerprinting': 'useragent-analyzer',
  'browser-privacy': 'useragent-analyzer',
  'incognito-mode': 'useragent-analyzer',
  'browser-extensions': 'ad-blocker-test',
  'tor-privacy': 'useragent-analyzer',
  'private-search': 'useragent-analyzer',
  'workplace-privacy': 'useragent-analyzer',
  'ai-privacy': 'useragent-analyzer',
  'ad-tracking': 'ad-blocker-test',
  'cookie-management': 'ad-blocker-test',
  'gdpr': 'ad-blocker-test',
  'ccpa': 'ad-blocker-test',
  'privacy-policies': 'ad-blocker-test',
  'us-state-privacy': 'ad-blocker-test',
  'international-privacy': 'ad-blocker-test',
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
  'crypto-privacy': 'hash-generator',
  'gaming-privacy': 'useragent-analyzer',
};
const UNIVERSAL_ENGINE = 'whats-my-ip';

export interface ProofRoute { href: string; title: string; engine: string; sameNiche: boolean }

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

export function proofToolFor(niche: string): ProofRoute | null {
  for (const slug of getContentFiles('tools', niche)) {
    if (!isToolListed(niche, slug)) continue;
    const t = getContentItem<ToolMeta>('tools', niche, slug);
    if (t?.toolEngine) return { href: `/tools/${niche}/${slug}`, title: t.title, engine: t.toolEngine, sameNiche: true };
  }
  const idx = engineIndex();
  for (const engine of [FALLBACK_ENGINE[niche], UNIVERSAL_ENGINE]) {
    const hit = engine ? idx.get(engine) : undefined;
    if (hit) return { href: `/tools/${hit.niche}/${hit.slug}`, title: hit.title, engine, sameNiche: false };
  }
  return null;
}

/** Test hook. */
export function _resetProofIndexForTests() { index = null; }
