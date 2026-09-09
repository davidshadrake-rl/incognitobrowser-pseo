'use client';

import React from 'react';
import { PasswordStrengthTool } from './PasswordStrengthTool';
import { PasswordGeneratorTool } from './PasswordGeneratorTool';
import { BrowserPrivacyTool } from './BrowserPrivacyTool';
import { TextEncryptionTool } from './TextEncryptionTool';
import { URLAnalyzerTool } from './URLAnalyzerTool';
import { HashGeneratorTool } from './HashGeneratorTool';
import { PrivacyQuizTool } from './PrivacyQuizTool';
import { PermissionCheckerTool } from './PermissionCheckerTool';
import { CookieAnalyzerTool } from './CookieAnalyzerTool';
import { UserAgentAnalyzerTool } from './UserAgentAnalyzerTool';
import { MetadataViewerTool } from './MetadataViewerTool';
import { WhatsMyIpTool } from './WhatsMyIpTool';
import { AdBlockerTestTool } from './AdBlockerTestTool';
import { DnsLeakTestTool } from './DnsLeakTestTool';
import { ScreenshotLeakCheckerTool } from './ScreenshotLeakCheckerTool';
import { EmailPixelDetectorTool } from './EmailPixelDetectorTool';
import { LinkUnwrapperTool } from './LinkUnwrapperTool';

// Maps toolEngine values to their React components
const TOOL_ENGINES: Record<string, React.ComponentType> = {
  'password-strength': PasswordStrengthTool,
  'password-generator': PasswordGeneratorTool,
  'browser-privacy': BrowserPrivacyTool,
  'text-encryption': TextEncryptionTool,
  'url-analyzer': URLAnalyzerTool,
  'hash-generator': HashGeneratorTool,
  'privacy-quiz': PrivacyQuizTool,
  'permission-checker': PermissionCheckerTool,
  'cookie-analyzer': CookieAnalyzerTool,
  'useragent-analyzer': UserAgentAnalyzerTool,
  'metadata-viewer': MetadataViewerTool,
  'whats-my-ip': WhatsMyIpTool,
  'ad-blocker-test': AdBlockerTestTool,
  'dns-leak-test': DnsLeakTestTool,
  'screenshot-leak-checker': ScreenshotLeakCheckerTool,
  'email-pixel-detector': EmailPixelDetectorTool,
  'link-unwrapper': LinkUnwrapperTool,
};

export function getToolEngine(engineId: string): React.ComponentType | null {
  return TOOL_ENGINES[engineId] || null;
}

export function renderToolEngine(engineId: string): React.ReactNode {
  const Component = TOOL_ENGINES[engineId];
  if (!Component) return null;
  return <Component />;
}

/**
 * Per-engine copy and metadata for the tool page (DESIGN-SPEC 5.4, lines
 * 587-598): the PageHero pull-quote figure, the "How it works" Input/Check/
 * Output strip, the Scoring panel's 1-2 sentences, and the canonical
 * tips/mistakes block used for the dedupe rule in section 7 ("the engine's
 * canonical page, i.e. the first niche in NICHE_ENGINE order, always renders
 * them").
 *
 * canonicalTips / canonicalMistakes are copied verbatim from each engine's
 * first niche shell (alphabetically, since no NICHE_ENGINE ordering exists
 * yet) — never invented:
 *   ad-blocker-test        data/tools/ad-tracking/ad-blocker-test.json
 *   cookie-analyzer        data/tools/ad-tracking/cookie-tracker-scanner.json
 *   link-unwrapper         data/tools/ad-tracking/link-unwrapper.json
 *   browser-privacy        data/tools/ai-privacy/browser-privacy-audit.json
 *   permission-checker     data/tools/children-safety/permission-checker.json
 *   text-encryption        data/tools/cloud-privacy/text-encryption-tool.json
 *   hash-generator         data/tools/crypto-privacy/hash-generator.json
 *   password-strength      data/tools/data-breach/password-strength-checker.json
 *   privacy-quiz           data/tools/data-brokers/digital-privacy-score.json
 *   metadata-viewer        data/tools/dating-privacy/image-metadata-checker.json
 *   email-pixel-detector   data/tools/email-privacy/email-tracking-pixel-detector.json
 *   useragent-analyzer     data/tools/gaming-privacy/useragent-analyzer.json
 *   url-analyzer           data/tools/malware-protection/url-safety-scanner.json
 *   password-generator     data/tools/password-security/secure-password-generator.json
 *   screenshot-leak-checker data/tools/social-media-privacy/screenshot-leak-checker.json
 *   dns-leak-test          data/tools/vpn-privacy/dns-leak-test.json
 *   whats-my-ip            data/tools/vpn-privacy/whats-my-ip.json
 */
export const ENGINE_META: Record<string, {
  figure: { value: string; label: string } | null;
  io: [string, string, string];
  scoring: string;
  canonicalTips: string[];
  canonicalMistakes: string[];
  checks?: number;
}> = {
  'whats-my-ip': {
    figure: null,
    io: ['Your request, seen by our server', 'Public IP plus a WebRTC probe', 'Exposed address, location, leak verdict'],
    scoring: "There is no numeric score. The verdict is a leak when WebRTC reveals an IP your server-seen request did not.",
    checks: 2,
    canonicalTips: [
      'Run this tool with your VPN OFF and note your real IP, then turn the VPN ON and run again — both IPs should differ',
      "If WebRTC shows your real IP while the VPN is on, install a WebRTC blocker extension or switch to a VPN that patches the API",
      'ASN and ISP info can fingerprint you across IP changes — using a major VPN provider with a shared exit-IP pool reduces this',
      'Geolocation accuracy is city-level at best — your real location is harder to determine than most people think',
      'Run this tool periodically; some VPN clients lose WebRTC protection after browser updates',
    ],
    canonicalMistakes: [
      "Assuming a VPN is enough — without WebRTC patching, sites can still see your real IP through the browser API",
      "Trusting 'free' VPN providers that may sell your traffic data — your IP is hidden but your activity isn't",
      'Forgetting about IPv6 — many VPNs only tunnel IPv4 and let IPv6 leak through your real ISP',
      'Believing incognito/private browsing hides your IP — it only hides local history, your IP is still visible to every site',
      'Using a browser-only VPN extension while desktop apps (Discord, Steam, etc.) still leak your real IP',
    ],
  },
  'password-strength': {
    figure: null,
    io: ['A password, typed locally', 'Entropy, charset and pattern analysis', 'Score, crack time, weaknesses found'],
    scoring: 'Score starts from length and character-set entropy, then loses points for common passwords, known patterns, repeated runs and all-digit strings.',
    canonicalTips: [
      'Use at least 16 characters for important accounts like banking and email',
      'Mix uppercase, lowercase, numbers, and symbols for maximum entropy',
      'Use a password manager to generate and store unique passwords for every site',
      'Consider passphrases — random word combinations are both strong and memorable',
      'Enable two-factor authentication as a second layer of defense',
    ],
    canonicalMistakes: [
      'Using the same password across multiple sites — one breach compromises all accounts',
      'Adding simple numbers or symbols to a common word (e.g., password123!) barely improves security',
      'Using personal information like birthdays, pet names, or addresses in passwords',
      'Relying solely on password length without character diversity',
      'Sharing passwords via unencrypted email or messaging apps',
    ],
  },
  'browser-privacy': {
    figure: { value: '14', label: 'checks' },
    io: ['Nothing typed — your browser itself', '14 fingerprint and leak checks', 'Score plus a fail/warn/pass tally'],
    scoring: 'Score starts at 100 and loses 15 points per failed check and 7 per warning, floored at 0.',
    checks: 14,
    canonicalTips: [
      'Enable Do Not Track in your browser settings, even though not all sites honor it',
      'Use a browser that patches WebRTC to prevent IP address leaks, especially when using a VPN',
      'Use a privacy browser that randomizes your canvas fingerprint to prevent unique identification',
      'Regularly clear cookies and site data to reduce persistent tracking',
      'Incognito Browser gives you built-in privacy protections with no setup',
    ],
    canonicalMistakes: [
      'Assuming incognito/private mode makes you anonymous — it only prevents local history storage',
      'Installing too many browser extensions, which actually increases your fingerprint uniqueness',
      'Ignoring WebRTC leaks, which can reveal your real IP even behind a VPN',
      'Not updating your browser regularly, leaving known security vulnerabilities unpatched',
      'Granting unnecessary permissions (camera, microphone, location) to websites',
    ],
  },
  'text-encryption': {
    figure: { value: '100k', label: 'iterations' },
    io: ['Plain text plus a passphrase', 'AES-256-GCM with a derived key', 'Ciphertext, or the text decrypted back'],
    scoring: "This tool doesn't score a result. PBKDF2 with 100,000 iterations derives the key, and a random IV makes identical inputs produce different ciphertext.",
    canonicalTips: [
      'Use a strong, unique passphrase — the encryption is only as secure as your passphrase',
      'Share the passphrase through a different channel than the encrypted message',
      'AES-256-GCM provides both confidentiality and integrity verification',
      'Save encrypted text as-is — any modification will make it impossible to decrypt',
      'For maximum security, use this tool in a private/incognito browsing session',
    ],
    canonicalMistakes: [
      'Using a weak or easily guessable passphrase defeats the purpose of encryption',
      'Sending the passphrase alongside the encrypted message in the same channel',
      'Modifying the encrypted output text, which corrupts the ciphertext and prevents decryption',
      'Forgetting the passphrase — there is no recovery mechanism with symmetric encryption',
      'Relying on encryption alone without also using secure communication channels',
    ],
  },
  'cookie-analyzer': {
    figure: { value: '30+', label: 'tracker signatures' },
    io: ["A URL, or this page's cookies", 'Cookies, scripts and tracker signatures', 'Tracking, analytics and functional counts'],
    scoring: 'A URL scan starts at 100 and loses points per high-risk item, tracking and analytics cookie, tracker and third-party script, plus fixed deductions for missing HTTPS, CSP or HSTS.',
    canonicalTips: [
      'Block third-party cookies in your browser settings to prevent cross-site tracking',
      'Use a cookie auto-delete extension to clear tracking cookies after each session',
      'Functional cookies (CSRF tokens, session IDs) are necessary and generally safe',
      'Review cookie settings on websites you visit frequently — many have opt-out options',
      'Incognito Browser blocks tracking cookies by default',
    ],
    canonicalMistakes: [
      "Clicking \"Accept All Cookies\" without reviewing what you're consenting to",
      "Assuming clearing browser history also removes all cookies — it often doesn't",
      'Blocking all cookies indiscriminately, which breaks login sessions and site functionality',
      'Not realizing that cookie consent banners often use dark patterns to trick you into accepting',
      'Ignoring third-party cookies, which are the primary mechanism for cross-site tracking',
    ],
  },
  'url-analyzer': {
    figure: null,
    io: ['A URL, never fetched', 'TLD, homograph, IP and path checks', 'Safety score and phishing findings'],
    scoring: 'Score starts at 100 and loses points per structural red flag (bad protocol, suspicious TLD, IP host, lookalike brand and more), capped at 75 for any newly-registered-looking domain.',
    canonicalTips: [
      'Always verify URLs before clicking, especially in emails and messages from unknown senders',
      'Look for HTTPS and a valid domain name — phishing sites often use HTTP or misspelled domains',
      'Be suspicious of URL shorteners in emails — they hide the true destination',
      'Check for subtle misspellings in domain names (e.g., g00gle.com, paypa1.com)',
      'When in doubt, navigate directly to the website by typing the URL yourself',
    ],
    canonicalMistakes: [
      'Clicking links in emails without verifying the actual URL destination',
      'Trusting a URL just because it contains a familiar brand name in the subdomain',
      'Ignoring browser security warnings about certificate or connection issues',
      'Entering login credentials on a page reached through an email link',
      'Assuming HTTPS alone means a website is legitimate — phishing sites use HTTPS too',
    ],
  },
  'privacy-quiz': {
    figure: { value: '12', label: 'questions' },
    io: ['12 multiple-choice answers', 'Points summed across five categories', 'Overall score and weak categories'],
    scoring: 'Each answer carries its own point value; the total across all 12 questions becomes the overall privacy score.',
    checks: 12,
    canonicalTips: [
      'Focus on improving your lowest-scoring categories first for the biggest privacy gains',
      'Privacy is a spectrum — even small improvements significantly reduce your exposure',
      'Revisit this quiz periodically to track your privacy improvements over time',
      'Share this quiz with friends and family to help them improve their privacy too',
      'Implement changes gradually — trying to overhaul everything at once is overwhelming',
    ],
    canonicalMistakes: [
      'Assuming one strong privacy measure (like a VPN) covers all bases',
      'Ignoring privacy settings on mobile devices, which often have weaker defaults',
      'Using free privacy tools that monetize your data — defeating the purpose',
      'Not keeping software and apps updated, which leaves security vulnerabilities open',
      'Oversharing on social media while investing in technical privacy measures',
    ],
  },
  'hash-generator': {
    figure: null,
    io: ['Text you type', 'SHA-1/256/384/512, locally', 'The hex digest for each algorithm'],
    scoring: "This tool doesn't score a result. It computes a fixed-length hash with the Web Crypto API and reports it as-is.",
    canonicalTips: [
      'Use SHA-256 or SHA-512 for security-critical applications — SHA-1 is considered weak',
      "Compare file hashes to verify downloads haven't been tampered with or corrupted",
      'Hash functions are one-way — you cannot reverse a hash to get the original data',
      'Even a single byte change in the input produces a completely different hash output',
      'Use the verify feature to quickly check if a file matches an expected hash',
    ],
    canonicalMistakes: [
      'Using SHA-1 for security purposes — it has known collision vulnerabilities',
      'Confusing hashing with encryption — hashes cannot be reversed, encryption can be decrypted',
      'Not verifying file hashes after downloading security-sensitive software',
      'Using hash functions alone for password storage — use PBKDF2, bcrypt, or Argon2 instead',
      'Assuming different hash algorithms produce the same length output',
    ],
  },
  'permission-checker': {
    figure: { value: '11', label: 'permissions' },
    io: ['Nothing typed — the Permissions API', '11 device permissions queried', 'Granted, blocked or prompt, per permission'],
    scoring: "This tool doesn't score a result. Each of the 11 permissions is reported as granted, blocked or prompt, with its own risk note.",
    checks: 11,
    canonicalTips: [
      'Review and revoke unnecessary permissions regularly in your browser settings',
      'Deny location access by default and only grant it temporarily when needed',
      'Block notification permissions for most websites to prevent spam and malvertising',
      'Camera and microphone access should be denied by default — grant only for video calls',
      'Use browser settings to reset all permissions periodically for a clean slate',
    ],
    canonicalMistakes: [
      "Clicking \"Allow\" on permission prompts without reading what's being requested",
      "Forgetting that permissions persist after granting them — they don't auto-expire",
      'Not checking permissions after browser updates, which may reset or change defaults',
      "Granting clipboard read access, which lets sites read passwords you've copied",
      'Allowing sensor access (accelerometer, gyroscope) which enables device fingerprinting',
    ],
  },
  'metadata-viewer': {
    figure: null,
    io: ['An image file, read locally', 'EXIF, GPS and text-chunk parsing', 'Every embedded field, plus a clean copy'],
    scoring: "This tool doesn't score a result. It's red when GPS or a high-risk field is present, amber for lower-risk metadata, green when none is found.",
    canonicalTips: [
      'Always strip metadata from photos before sharing online, especially GPS coordinates',
      'Most phones embed precise GPS coordinates in every photo by default — check your settings',
      'Screenshots typically contain less metadata than camera photos',
      'Use image conversion (e.g., PNG to JPEG) as a simple way to strip most metadata',
      'Check metadata in photos before posting on dating apps or social media',
    ],
    canonicalMistakes: [
      'Assuming social media platforms strip all metadata — many preserve some data in their backend',
      'Not disabling location services for your camera app, embedding GPS in every photo',
      'Sharing original photos via email or messaging without stripping metadata first',
      'Forgetting that camera model and software information can identify you',
      'Not checking photos received from others for metadata before re-sharing',
    ],
  },
  'useragent-analyzer': {
    figure: null,
    io: ["Your browser's own UA string", 'Browser, OS, engine and device parsing', 'What the string reveals, plus concerns'],
    scoring: "This tool doesn't score a result. It flags amber once three or more privacy concerns are identified in the parsed string.",
    canonicalTips: [
      'Consider using a browser that reduces or randomizes user agent strings',
      'The User-Agent Client Hints API is replacing traditional UA strings — but still reveals data',
      'Switching browsers periodically can reduce long-term fingerprint tracking',
      'A privacy-focused browser can reduce the detail your user agent reveals',
      'Browser extensions can spoof your user agent, but this can create a more unique fingerprint',
    ],
    canonicalMistakes: [
      'Assuming user agent spoofing alone provides anonymity — many other fingerprinting vectors exist',
      'Using a very unusual or custom user agent string, which makes you more identifiable',
      'Not realizing that user agent data is sent with every single HTTP request',
      'Ignoring the privacy implications of browser and OS version information leakage',
      'Thinking that mobile browsers are more private — they often reveal even more device information',
    ],
  },
  'password-generator': {
    figure: null,
    io: ['Your chosen length and character sets', 'CSPRNG via the Web Crypto API', 'A random password or passphrase'],
    scoring: "This tool doesn't score a result. Every character is drawn independently from crypto.getRandomValues().",
    canonicalTips: [
      'Use at least 16 characters for random passwords, or 5+ words for passphrases',
      'Include all character types (uppercase, lowercase, numbers, symbols) for maximum entropy',
      'Use a unique generated password for every account — never reuse passwords',
      'Store generated passwords in a dedicated password manager like Bitwarden or 1Password',
      'Passphrases are easier to remember while still being very secure',
    ],
    canonicalMistakes: [
      'Generating a strong password but then writing it on a sticky note',
      'Using a short password (under 12 characters) even with all character types',
      'Excluding character types unnecessarily, which reduces the keyspace',
      'Not actually using the generated password — going back to an easy-to-remember weak one',
      'Sharing generated passwords via unencrypted channels like email or SMS',
    ],
  },
  'link-unwrapper': {
    figure: null,
    io: ['A wrapped or shortened link', 'Wrapper decoding, then a 90+ term lookup', 'The real destination, tracking params stripped'],
    scoring: "This tool doesn't score a result. Each parameter is labelled identity-level, campaign-level or kept, and the destination is rebuilt without the tracking ones.",
    canonicalTips: [
      'Paste links from emails and text messages before opening them; email links are the most heavily wrapped because every mail platform adds its own click-tracking layer',
      'Copy the clean link and open that instead of the original so the sender never receives the click and the destination never receives the click ID',
      'Treat identity-level IDs as the serious ones: a campaign tag says which newsletter you read, a click ID says exactly which person clicked and lets the ad network match that to your account',
      'Shorteners such as bit.ly and t.co cannot be decoded without fetching; if the destination matters, ask the sender for the direct address instead of expanding it through a third-party service',
      'Watch for a wrapper you use at work, such as Safe Links or Proofpoint, on personal mail: it means every link you open is logged by that gateway, not only the ones at the office',
    ],
    canonicalMistakes: [
      'Assuming a link starting with google.com or facebook.com is safe: those hosts are redirect shims, and the real destination is buried in a parameter that can point anywhere',
      'Deleting only the utm_ parameters and keeping the rest: the click ID that identifies you personally is usually a different key, such as fbclid, gclid or mc_eid',
      'Opening the link first and then trying to clean it: by then every redirect hop has already logged the click and set its cookies',
      'Expanding shortened links through an online expander service, which simply hands your interest in the link to yet another third party',
      'Removing every parameter in sight, which breaks links that legitimately need an ID, a page number or a search query; the tool keeps unknown parameters for this reason',
    ],
  },
  'email-pixel-detector': {
    figure: null,
    io: ['Pasted raw email source', 'Every image and link inspected', 'Tracking pixels and click-wrapped links found'],
    scoring: "This tool doesn't score a result. It's red for a hidden tracking pixel or click-tracking wrapper, amber for a softer signal like a remote image, green otherwise.",
    canonicalTips: [
      "Turn off automatic remote-image loading in your mail client, or use a provider that proxies images — that single setting defeats nearly every open-tracking pixel",
      "Hover over links before clicking; if the visible domain does not match the destination shown in the status bar, the click is being logged through a redirect",
      "Copy the full source from \"Show original\" or \"View source\" rather than the rendered page — the headers are where the sending platform gives itself away",
      "A tiny, hidden or vendor-hosted image is a strong signal, but any remote image can be used to infer an open; treat \"remote images\" as a soft warning, not a pass",
      "When a message from an individual contains a sales-tracking pixel, replying via a fresh plain-text email avoids feeding their read receipts",
    ],
    canonicalMistakes: [
      "Assuming a plain-looking personal email cannot track you — sales add-ons inject one-pixel beacons into ordinary one-to-one messages",
      "Opening the email to \"check\" it in a normal client with images enabled, which fires the pixel before you have inspected anything",
      "Judging a link by its anchor text instead of its actual href — wrapped links look identical until you read the source",
      "Pasting only the rendered text of the message, which strips the HTML and hides both pixels and redirect wrappers",
      "Trusting that unsubscribing removes tracking; the unsubscribe link itself usually carries a per-recipient identifier",
    ],
  },
  'screenshot-leak-checker': {
    figure: null,
    io: ['An image file, read locally', 'PNG/JPEG/WebP metadata chunks parsed', 'Location, device and personal-data matches'],
    scoring: "This tool doesn't score a result. It's red for a location, thumbnail or personal-data match, amber for device or timestamp details only, green when nothing is found.",
    canonicalTips: [
      'Screenshots taken on phones often carry the OS name and version in the Software tag, and photos of your screen carry full camera Exif including GPS. Check both before posting',
      'If the tool shows an embedded thumbnail, look at it closely. Editors that crop or blur the main picture frequently leave the original thumbnail behind, so the part you removed can still be in the file',
      'Rename the file before sharing. Default names like IMG_4471.jpg reveal the camera app and shot count, and names copied from a desktop can include your username or a client name',
      'Use the clean copy for anything public. Re-encoding through a canvas drops every metadata block; a PNG stays lossless, while a JPEG is recompressed slightly at quality 92',
      'Metadata is only half the problem. Read the visible content too: notification banners, open tabs, taskbar clocks, Wi-Fi names and reflections leak just as much as Exif',
    ],
    canonicalMistakes: [
      'Assuming a screenshot has no metadata because it is not a camera photo. Capture apps write their own name, the OS, timestamps and sometimes the user account into PNG text chunks',
      'Blurring or cropping sensitive parts and then sharing the same file. The Exif thumbnail and the XMP edit history can both survive the edit and expose the original',
      'Trusting a messaging app or social network to strip metadata. Some do, some only resize, and files sent as documents or attachments usually keep everything',
      'Believing that converting between formats cleans the file. Many converters copy Exif and XMP across unchanged; only a pixel-level re-encode drops them',
      'Checking only for GPS. A serial number, document ID or Windows username in a path links every file you have ever published, even without a location',
    ],
  },
  'dns-leak-test': {
    figure: { value: '1', label: 'question: who resolves you' },
    io: ['Six test hostnames, resolved by you', 'Our nameserver records who asked', 'Leak, no-leak, inconclusive or baseline'],
    scoring: "There is no numeric score. The verdict compares the resolver network that reached our nameserver against your public IP and, on a VPN-on run, your saved VPN-off baseline.",
    checks: 6,
    canonicalTips: [
      "Run the test once with your VPN off first — that records the resolver your ISP hands you, which is what the VPN-on run needs to recognise a leak",
      "Repeat the test after switching networks (home, mobile hotspot, office) — a VPN that seals DNS on one network can leak on another",
      "If your browser uses DNS over HTTPS, you will see that provider's resolver rather than your ISP's; decide deliberately whether that is the behaviour you want",
      "Check IPv6 separately: a resolver reached over IPv6 shows up with a hextet-style address, and many VPNs only tunnel IPv4",
      "A verdict of 'inconclusive' is information, not a pass — re-run it before trusting the connection for anything sensitive",
    ],
    canonicalMistakes: [
      "Treating a VPN browser extension as full protection — it changes where web traffic exits but leaves the operating system's DNS settings, and therefore the resolver, untouched",
      "Assuming a resolver on a different network from your VPN exit is automatically a leak — public resolvers like Cloudflare or Google also look different, which is why a VPN-off baseline matters",
      "Ignoring resolvers that appear only once — a single stray query to your ISP's resolver still reveals the site name",
      "Testing only once, right after connecting — some VPN clients lose their DNS override after sleep, reconnects, or updates",
      "Reading a 'no queries reached our nameserver' result as a clean bill of health — it means the test could not observe anything, not that nothing leaked",
    ],
  },
  'ad-blocker-test': {
    figure: { value: '50', label: 'bait requests' },
    io: ['50 first-party bait requests', 'URL-pattern and cosmetic filter matching', 'Percent blocked, plus a per-category table'],
    scoring: 'Score is simply the percentage of the 50 bait requests your blocker stopped; cosmetic filtering and the per-category table are shown separately and do not change it.',
    checks: 50,
    canonicalTips: [
      'Run the test once with your blocker on and once with it paused for this site — the difference is the protection you are actually getting',
      "If scripts are blocked but tracking pixels get through, enable EasyPrivacy (or your blocker's tracking-protection list) alongside the default ad list",
      'Keep filter lists auto-updating; a blocker with stale lists lets new patterns through while still looking like it works',
      'If you use a DNS-level blocker, pair it with a browser extension — the two catch different things and this test only sees the second',
      'Re-run after any browser update or extension change; permission and manifest changes have silently disabled blockers before',
    ],
    canonicalMistakes: [
      "Assuming a browser's built-in tracking protection blocks ads — most only block known third-party trackers, not generic ad URL patterns",
      "Trusting a VPN's advertised ad blocking, which is usually domain-only and cannot filter first-party or path-based requests",
      'Whitelisting a site to make one thing work and forgetting to remove it, leaving every ad and tracker on that site unblocked',
      'Running two blockers at once and believing that doubles protection — they often interfere and one ends up doing nothing',
      'Judging a blocker by how few ads you see; native ads, sponsored content and tracking pixels are invisible whether they load or not',
    ],
  },
};

/**
 * The (niche, slug) each ENGINE_META canonicalTips/canonicalMistakes block
 * was copied from — "the first niche in NICHE_ENGINE order" from section 7.
 * The Notes-panel dedupe rule (client.tsx) uses this so the canonical page
 * always renders its own tips even though, by definition, they are
 * identical to ENGINE_META[engine].canonicalTips.
 */
export const ENGINE_CANONICAL: Record<string, { niche: string; slug: string }> = {
  'ad-blocker-test': { niche: 'ad-tracking', slug: 'ad-blocker-test' },
  'cookie-analyzer': { niche: 'ad-tracking', slug: 'cookie-tracker-scanner' },
  'link-unwrapper': { niche: 'ad-tracking', slug: 'link-unwrapper' },
  'browser-privacy': { niche: 'ai-privacy', slug: 'browser-privacy-audit' },
  'permission-checker': { niche: 'children-safety', slug: 'permission-checker' },
  'text-encryption': { niche: 'cloud-privacy', slug: 'text-encryption-tool' },
  'hash-generator': { niche: 'crypto-privacy', slug: 'hash-generator' },
  'password-strength': { niche: 'data-breach', slug: 'password-strength-checker' },
  'privacy-quiz': { niche: 'data-brokers', slug: 'digital-privacy-score' },
  'metadata-viewer': { niche: 'dating-privacy', slug: 'image-metadata-checker' },
  'email-pixel-detector': { niche: 'email-privacy', slug: 'email-tracking-pixel-detector' },
  'useragent-analyzer': { niche: 'gaming-privacy', slug: 'useragent-analyzer' },
  'url-analyzer': { niche: 'malware-protection', slug: 'url-safety-scanner' },
  'password-generator': { niche: 'password-security', slug: 'secure-password-generator' },
  'screenshot-leak-checker': { niche: 'social-media-privacy', slug: 'screenshot-leak-checker' },
  'dns-leak-test': { niche: 'vpn-privacy', slug: 'dns-leak-test' },
  'whats-my-ip': { niche: 'vpn-privacy', slug: 'whats-my-ip' },
};

// Maps niches to their best-fit tool engine

