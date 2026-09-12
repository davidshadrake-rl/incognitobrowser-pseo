/**
 * Shared tables for the per-page funnel scripts (no side effects, safe to import).
 */
/** Which Pro value a topic leads to. Each topic's own line is drafted and signed off separately. */
export const TOPIC_GROUP: Record<string, 'tracking' | 'identity' | 'links' | 'photos' | 'network'> = {
  'ad-tracking': 'tracking', 'cookie-management': 'tracking', gdpr: 'tracking', ccpa: 'tracking',
  'privacy-policies': 'tracking', 'online-shopping': 'tracking', 'us-state-privacy': 'tracking',
  'international-privacy': 'tracking', 'data-brokers': 'tracking', 'right-to-forget': 'tracking',
  'search-history': 'tracking', 'digital-footprint': 'tracking', 'healthcare-privacy': 'tracking',
  'children-safety': 'tracking', 'smart-home-privacy': 'tracking', 'student-privacy': 'tracking',
  'device-fingerprinting': 'identity', 'browser-privacy': 'identity', 'incognito-mode': 'identity',
  'tor-privacy': 'identity', 'browser-extensions': 'identity', 'private-search': 'identity',
  'workplace-privacy': 'identity', 'gaming-privacy': 'identity', 'webcam-privacy': 'identity',
  phishing: 'links', 'malware-protection': 'links', 'online-banking': 'links', 'password-security': 'links',
  'data-breach': 'links', 'email-privacy': 'links', 'crypto-privacy': 'links',
  'dating-privacy': 'photos', 'location-tracking': 'photos', 'social-media-privacy': 'photos',
  'drone-surveillance': 'photos', 'facial-recognition': 'photos', 'journalist-privacy': 'photos',
  'ai-privacy': 'photos', 'cloud-privacy': 'photos', 'encrypted-messaging': 'photos',
  'vpn-privacy': 'network', 'isp-tracking': 'network', 'public-wifi': 'network',
};

/** The Pro engine each group's step 4 points to, and its neutral fallback page. */
export const GROUP_PRO: Record<string, { engine: string; fallback: [string, string] }> = {
  tracking: { engine: 'cookie-analyzer', fallback: ['ad-tracking', 'cookie-tracker-scanner'] },
  identity: { engine: 'browser-privacy', fallback: ['browser-privacy', 'browser-privacy-audit'] },
  links: { engine: 'url-analyzer', fallback: ['phishing', 'url-safety-checker'] },
  photos: { engine: 'metadata-viewer', fallback: ['facial-recognition', 'image-metadata-stripper'] },
  network: { engine: 'browser-privacy', fallback: ['vpn-privacy', 'browser-leak-test'] },
};

export const PRO_NAMES: Record<string, string> = {
  'cookie-analyzer': 'Cookie & Tracker Scanner',
  'browser-privacy': 'Browser Fingerprint Checker',
  'url-analyzer': 'URL Safety Checker',
  'metadata-viewer': 'Photo Metadata Viewer',
};

/**
 * Step 2 for the 8 topics no free tool fits — the nearest REAL check, for the
 * owner to approve on the review page. Pro engines here are free for now; on
 * gate day these pages need a new step 2, which the review page flags.
 */
export const PAIRINGS: Record<string, { engine: string; why: string }> = {
  'ai-privacy': { engine: 'screenshot-leak-checker', why: 'Photos pasted into AI chatbots carry location and device data; check one before uploading it.' },
  gdpr: { engine: 'cookie-analyzer', why: 'Scan your own site for the cookies it sets before anyone consents.' },
  ccpa: { engine: 'cookie-analyzer', why: 'See which trackers a site loads before you can opt out.' },
  'privacy-policies': { engine: 'cookie-analyzer', why: 'Compare what a site actually sets with what its policy says.' },
  'us-state-privacy': { engine: 'cookie-analyzer', why: 'See what a site collects on the first visit, before any state-law opt-out applies.' },
  'international-privacy': { engine: 'cookie-analyzer', why: 'See which third parties a site hands your visit to, wherever they are.' },
  'workplace-privacy': { engine: 'browser-privacy', why: 'See what your browser reveals about you and your device on any network, work included.' },
  'crypto-privacy': { engine: 'url-analyzer', why: 'Check a wallet or exchange link for look-alike spellings before you connect.' },
};

