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
