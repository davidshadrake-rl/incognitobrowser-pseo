/**
 * Visual registry (DESIGN-SPEC 3.2): the single map every icon and diagram
 * motif routes through. Content types, niche families and engines are told
 * apart by icon + diagram motif + label, never by colour (blue means Pro).
 */
import type { IconName } from '@/components/ui/Icon';
export type Diagram = 'tracking' | 'leak' | 'exif' | 'phish' | 'pixel' | 'cipher' | 'fingerprint' | 'funnel';

export const ENGINE_ICON: Record<string, IconName> = {
  'whats-my-ip': 'globe', 'password-strength': 'key', 'browser-privacy': 'finger', 'text-encryption': 'lock',
  'cookie-analyzer': 'cookie', 'url-analyzer': 'warn', 'privacy-quiz': 'quiz', 'hash-generator': 'hash',
  'permission-checker': 'toggle', 'metadata-viewer': 'camera', 'useragent-analyzer': 'ua', 'password-generator': 'dice',
  'link-unwrapper': 'link', 'email-pixel-detector': 'mail', 'screenshot-leak-checker': 'shot', 'dns-leak-test': 'drop', 'ad-blocker-test': 'block',
};
export const ENGINE_DIAGRAM: Record<string, Diagram> = {
  'whats-my-ip': 'leak', 'dns-leak-test': 'leak', 'browser-privacy': 'fingerprint', 'useragent-analyzer': 'fingerprint', 'permission-checker': 'fingerprint',
  'cookie-analyzer': 'tracking', 'ad-blocker-test': 'tracking', 'link-unwrapper': 'tracking', 'privacy-quiz': 'tracking',
  'url-analyzer': 'phish', 'email-pixel-detector': 'pixel', 'metadata-viewer': 'exif', 'screenshot-leak-checker': 'exif',
  'password-strength': 'cipher', 'password-generator': 'cipher', 'hash-generator': 'cipher', 'text-encryption': 'cipher',
};
/** Content-type icon. Keys are the slugs used by app/page.tsx `icons`, RelatedContent TYPE_ICONS and navItems. */
export const TYPE_ICON: Record<string, IconName> = {
  tools: 'hat', tool: 'hat', guides: 'book', guide: 'book', checklists: 'list', checklist: 'list',
  comparisons: 'vs', comparison: 'vs', calculators: 'calc', calculator: 'calc', templates: 'doc', template: 'doc',
  glossary: 'az', site: 'grade', 'report-card': 'grade', internal: 'arrow', external: 'external',
};
/** Niche family -> diagram. Fallback 'tracking'. Every taxonomy niche id is here (44). */
export const NICHE_DIAGRAM: Record<string, Diagram> = {
  'ad-tracking': 'tracking', 'cookie-management': 'tracking', 'browser-extensions': 'tracking', 'online-shopping': 'tracking', 'social-media-privacy': 'tracking', 'gdpr': 'tracking', 'ccpa': 'tracking', 'privacy-policies': 'tracking',
  'data-brokers': 'tracking', 'us-state-privacy': 'tracking', 'international-privacy': 'tracking',
  'vpn-privacy': 'leak', 'isp-tracking': 'leak', 'public-wifi': 'leak', 'tor-privacy': 'leak', 'private-search': 'leak', 'search-history': 'leak', 'incognito-mode': 'leak',
  'right-to-forget': 'leak', 'journalist-privacy': 'leak',
  'device-fingerprinting': 'fingerprint', 'browser-privacy': 'fingerprint', 'ai-privacy': 'fingerprint', 'facial-recognition': 'fingerprint', 'digital-footprint': 'fingerprint',
  'gaming-privacy': 'fingerprint',
  'phishing': 'phish', 'malware-protection': 'phish', 'data-breach': 'phish',
  'email-privacy': 'pixel',
  'location-tracking': 'exif', 'dating-privacy': 'exif', 'drone-surveillance': 'exif', 'smart-home-privacy': 'exif', 'webcam-privacy': 'exif',
  'encrypted-messaging': 'cipher', 'password-security': 'cipher', 'online-banking': 'cipher', 'cloud-privacy': 'cipher', 'crypto-privacy': 'cipher', 'workplace-privacy': 'cipher', 'healthcare-privacy': 'cipher', 'student-privacy': 'cipher', 'children-safety': 'cipher',
};

/** Diagram id for a niche, falling back to 'tracking' when the niche is
 * missing from NICHE_DIAGRAM (new taxonomy entries land here before the
 * table catches up). Callers should use this instead of indexing
 * NICHE_DIAGRAM directly. */
export function diagramForNiche(niche: string): Diagram {
  return NICHE_DIAGRAM[niche] ?? 'tracking';
}

/**
 * Amendment A (DESIGN-SPEC-AMENDMENT-COLORS.md, owner decision 2026-09-09):
 * four family hues, used ONLY for IconTile's `family` prop, one Diagram
 * subject stroke per motif, the free tool-card left rail and the tool
 * PageHero figure rule. `funnel` and every Pro surface stay `pro` blue —
 * familyOfEngine/familyOfNiche fold that case to 'trace' only because those
 * two helpers must always return a paintable family (an icon tile has no
 * separate "pro blue" family slot; Pro tone wins over family at the call
 * site, per Icon.tsx).
 */
export type Family = 'net' | 'trace' | 'identity' | 'cipher';
export const DIAGRAM_FAMILY: Record<Diagram, Family | 'pro'> = {
  leak: 'net', tracking: 'trace', pixel: 'trace', phish: 'trace',
  fingerprint: 'identity', exif: 'identity', cipher: 'cipher', funnel: 'pro',
};
export function familyOfEngine(engine: string): Family {
  const d = ENGINE_DIAGRAM[engine] ?? 'tracking';
  const f = DIAGRAM_FAMILY[d];
  return f === 'pro' ? 'trace' : f;
}
export function familyOfNiche(niche: string): Family {
  const d = diagramForNiche(niche);
  const f = DIAGRAM_FAMILY[d];
  return f === 'pro' ? 'trace' : f;
}
