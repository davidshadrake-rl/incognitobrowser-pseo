import fs from 'fs';
import path from 'path';

// NICHE_TOOL_MAP duplicated here for node script context
const NICHE_TOOL_MAP: Record<string, { slug: string; title: string; engine: string; description: string; toolType: string }> = {
  'incognito-mode': { slug: 'browser-privacy-audit', title: 'Browser Privacy Audit', engine: 'browser-privacy', toolType: 'analyzer', description: 'Analyze your browser\'s privacy settings, fingerprinting exposure, and tracking vulnerabilities in real-time.' },
  'browser-privacy': { slug: 'browser-privacy-audit', title: 'Browser Privacy Audit', engine: 'browser-privacy', toolType: 'analyzer', description: 'Run a comprehensive privacy audit on your current browser to identify tracking vulnerabilities and fingerprinting risks.' },
  'ad-tracking': { slug: 'cookie-tracker-scanner', title: 'Cookie & Tracker Scanner', engine: 'cookie-analyzer', toolType: 'scanner', description: 'Scan and categorize cookies on any webpage to identify advertising trackers, analytics scripts, and privacy-invasive cookies.' },
  'cookie-management': { slug: 'cookie-analyzer', title: 'Cookie Analyzer', engine: 'cookie-analyzer', toolType: 'analyzer', description: 'Analyze browser cookies to identify tracking cookies, categorize them by purpose, and understand their privacy impact.' },
  'device-fingerprinting': { slug: 'fingerprint-checker', title: 'Browser Fingerprint Checker', engine: 'browser-privacy', toolType: 'checker', description: 'Detect how websites fingerprint your browser through canvas rendering, WebRTC, screen resolution, and other techniques.' },
  'digital-footprint': { slug: 'privacy-score-quiz', title: 'Privacy Score Calculator', engine: 'privacy-quiz', toolType: 'calculator', description: 'Take a comprehensive privacy assessment to calculate your digital footprint score and get personalized recommendations.' },
  'vpn-privacy': { slug: 'browser-leak-test', title: 'Browser Leak Test', engine: 'browser-privacy', toolType: 'checker', description: 'Check for WebRTC leaks, DNS leaks, and other browser vulnerabilities that could expose your real IP while using a VPN.' },
  'password-security': { slug: 'password-strength-checker', title: 'Password Strength Checker', engine: 'password-strength', toolType: 'checker', description: 'Analyze your password\'s strength with entropy calculation, crack time estimation, pattern detection, and security recommendations.' },
  'encrypted-messaging': { slug: 'text-encryption-tool', title: 'Text Encryption Tool', engine: 'text-encryption', toolType: 'converter', description: 'Encrypt and decrypt text messages using military-grade AES-256-GCM encryption, entirely in your browser.' },
  'private-search': { slug: 'browser-privacy-audit', title: 'Search Privacy Audit', engine: 'browser-privacy', toolType: 'analyzer', description: 'Audit your browser\'s privacy settings to ensure your search activity isn\'t being tracked or logged.' },
  'data-brokers': { slug: 'digital-privacy-score', title: 'Digital Privacy Score', engine: 'privacy-quiz', toolType: 'calculator', description: 'Assess how exposed your personal data is to data brokers with this comprehensive privacy quiz.' },
  'isp-tracking': { slug: 'browser-leak-test', title: 'ISP Tracking Detector', engine: 'browser-privacy', toolType: 'analyzer', description: 'Detect browser settings and leaks that allow your ISP to track your online activity.' },
  'location-tracking': { slug: 'permission-audit', title: 'Location Permission Audit', engine: 'permission-checker', toolType: 'checker', description: 'Check which websites and apps have access to your location data and other sensitive device permissions.' },
  'public-wifi': { slug: 'browser-security-check', title: 'Public WiFi Security Check', engine: 'browser-privacy', toolType: 'checker', description: 'Audit your browser\'s security configuration to identify vulnerabilities when using public WiFi networks.' },
  'phishing': { slug: 'url-safety-checker', title: 'URL Safety Checker', engine: 'url-analyzer', toolType: 'checker', description: 'Analyze any URL for phishing indicators, suspicious patterns, and security risks before clicking.' },
  'malware-protection': { slug: 'url-safety-scanner', title: 'URL Safety Scanner', engine: 'url-analyzer', toolType: 'scanner', description: 'Scan URLs for malware indicators, suspicious redirects, and known phishing patterns.' },
  'email-privacy': { slug: 'privacy-score-quiz', title: 'Email Privacy Score', engine: 'privacy-quiz', toolType: 'calculator', description: 'Evaluate your email privacy practices and get recommendations for protecting your inbox.' },
  'social-media-privacy': { slug: 'social-privacy-quiz', title: 'Social Media Privacy Quiz', engine: 'privacy-quiz', toolType: 'calculator', description: 'Assess your social media privacy practices and learn how to reduce your digital exposure.' },
  'online-shopping': { slug: 'url-safety-checker', title: 'Shopping URL Verifier', engine: 'url-analyzer', toolType: 'checker', description: 'Verify if an online store URL is legitimate before entering your payment information.' },
  'online-banking': { slug: 'password-strength-checker', title: 'Banking Password Checker', engine: 'password-strength', toolType: 'checker', description: 'Ensure your banking passwords meet security standards with real-time strength analysis and breach detection.' },
  'workplace-privacy': { slug: 'browser-privacy-audit', title: 'Workplace Browser Audit', engine: 'browser-privacy', toolType: 'analyzer', description: 'Check what information your work browser reveals to employers and third-party monitors.' },
  'student-privacy': { slug: 'digital-privacy-quiz', title: 'Student Privacy Quiz', engine: 'privacy-quiz', toolType: 'calculator', description: 'Evaluate your digital privacy habits as a student and learn to protect your academic data.' },
  'children-safety': { slug: 'permission-checker', title: 'Device Permission Checker', engine: 'permission-checker', toolType: 'checker', description: 'Review device permissions to ensure children\'s apps aren\'t accessing camera, microphone, or location data.' },
  'healthcare-privacy': { slug: 'text-encryption-tool', title: 'Medical Data Encryption', engine: 'text-encryption', toolType: 'converter', description: 'Encrypt sensitive healthcare information using AES-256 encryption before sharing digitally.' },
  'dating-privacy': { slug: 'image-metadata-checker', title: 'Photo Metadata Checker', engine: 'metadata-viewer', toolType: 'analyzer', description: 'Check photos for hidden metadata like GPS coordinates and camera info before sharing on dating apps.' },
  'smart-home-privacy': { slug: 'permission-audit', title: 'Smart Device Permission Audit', engine: 'permission-checker', toolType: 'checker', description: 'Audit browser permissions that smart home devices and their web interfaces may be accessing.' },
  'webcam-privacy': { slug: 'permission-checker', title: 'Webcam Permission Checker', engine: 'permission-checker', toolType: 'checker', description: 'Check which websites have access to your camera and microphone, and learn how to revoke permissions.' },
  'ai-privacy': { slug: 'browser-privacy-audit', title: 'AI Privacy Audit', engine: 'browser-privacy', toolType: 'analyzer', description: 'Audit your browser for data leaks that AI-powered trackers exploit for profiling.' },
  'cloud-privacy': { slug: 'text-encryption-tool', title: 'Cloud Data Encryption', engine: 'text-encryption', toolType: 'converter', description: 'Encrypt sensitive files and text before uploading to cloud storage using client-side AES-256 encryption.' },
  'gaming-privacy': { slug: 'useragent-analyzer', title: 'Gaming Browser Analyzer', engine: 'useragent-analyzer', toolType: 'analyzer', description: 'Analyze what your browser reveals to gaming platforms about your device and system configuration.' },
  'gdpr': { slug: 'cookie-compliance-scanner', title: 'Cookie Compliance Scanner', engine: 'cookie-analyzer', toolType: 'scanner', description: 'Scan cookies on any website to check for GDPR compliance issues and unauthorized tracking.' },
  'ccpa': { slug: 'cookie-privacy-scanner', title: 'Cookie Privacy Scanner', engine: 'cookie-analyzer', toolType: 'scanner', description: 'Analyze website cookies for CCPA compliance and identify data collection practices.' },
  'us-state-privacy': { slug: 'privacy-compliance-quiz', title: 'Privacy Compliance Quiz', engine: 'privacy-quiz', toolType: 'calculator', description: 'Test your knowledge of US state privacy laws and assess your organization\'s compliance readiness.' },
  'international-privacy': { slug: 'privacy-law-quiz', title: 'International Privacy Quiz', engine: 'privacy-quiz', toolType: 'calculator', description: 'Evaluate your understanding of international privacy regulations and their requirements.' },
  'data-breach': { slug: 'password-strength-checker', title: 'Post-Breach Password Checker', engine: 'password-strength', toolType: 'checker', description: 'Check if your passwords are strong enough after a data breach — analyze strength and detect common patterns.' },
  'right-to-forget': { slug: 'digital-footprint-quiz', title: 'Digital Footprint Quiz', engine: 'privacy-quiz', toolType: 'calculator', description: 'Assess your digital footprint and learn what data you have the right to request deletion of.' },
  'privacy-policies': { slug: 'cookie-tracker-analyzer', title: 'Website Cookie Analyzer', engine: 'cookie-analyzer', toolType: 'analyzer', description: 'Analyze website cookies to verify they match the site\'s stated privacy policy.' },
  'crypto-privacy': { slug: 'hash-generator', title: 'Cryptographic Hash Generator', engine: 'hash-generator', toolType: 'generator', description: 'Generate SHA-256, SHA-384, SHA-512, and SHA-1 hashes for verifying file integrity and data authenticity.' },
  'tor-privacy': { slug: 'browser-fingerprint-test', title: 'Browser Fingerprint Test', engine: 'browser-privacy', toolType: 'checker', description: 'Test your Tor browser\'s fingerprint resistance and check for potential identity leaks.' },
  'facial-recognition': { slug: 'image-metadata-stripper', title: 'Photo Metadata Viewer', engine: 'metadata-viewer', toolType: 'analyzer', description: 'View and understand metadata in your photos that facial recognition systems could use to identify you.' },
  'drone-surveillance': { slug: 'image-metadata-checker', title: 'Image Metadata Inspector', engine: 'metadata-viewer', toolType: 'analyzer', description: 'Inspect drone and aerial photos for embedded GPS coordinates, camera data, and other identifying metadata.' },
  'browser-extensions': { slug: 'browser-security-audit', title: 'Browser Security Audit', engine: 'browser-privacy', toolType: 'analyzer', description: 'Audit your browser\'s security posture including extension detection vectors and fingerprinting surface.' },
  'journalist-privacy': { slug: 'secure-text-encryption', title: 'Secure Text Encryption', engine: 'text-encryption', toolType: 'converter', description: 'Encrypt sensitive communications with AES-256-GCM encryption — designed for journalists protecting sources.' },
  'search-history': { slug: 'privacy-habits-quiz', title: 'Search Privacy Quiz', engine: 'privacy-quiz', toolType: 'calculator', description: 'Evaluate your search privacy habits and learn how to prevent your search history from being tracked.' },
};

// Educational content per engine type
const ENGINE_EDUCATIONAL: Record<string, { howItWorks: string; tips: string[]; commonMistakes: string[] }> = {
  'password-strength': {
    howItWorks: 'This tool analyzes passwords entirely in your browser using entropy calculation, pattern detection, and character composition analysis. It estimates crack time based on a GPU cluster performing 10 billion guesses per second. No passwords are ever transmitted — all processing happens client-side using JavaScript.',
    tips: [
      'Use at least 16 characters for important accounts like banking and email',
      'Mix uppercase, lowercase, numbers, and symbols for maximum entropy',
      'Use a password manager to generate and store unique passwords for every site',
      'Consider passphrases — random word combinations are both strong and memorable',
      'Enable two-factor authentication as a second layer of defense',
    ],
    commonMistakes: [
      'Using the same password across multiple sites — one breach compromises all accounts',
      'Adding simple numbers or symbols to a common word (e.g., password123!) barely improves security',
      'Using personal information like birthdays, pet names, or addresses in passwords',
      'Relying solely on password length without character diversity',
      'Sharing passwords via unencrypted email or messaging apps',
    ],
  },
  'browser-privacy': {
    howItWorks: 'This tool runs a series of privacy checks directly in your browser to detect fingerprinting vectors, tracking vulnerabilities, and privacy leaks. It tests Do Not Track settings, WebRTC exposure, canvas fingerprinting, device hardware detection, and more. All checks execute locally — no data leaves your device.',
    tips: [
      'Enable Do Not Track in your browser settings, even though not all sites honor it',
      'Use a WebRTC blocker to prevent IP address leaks, especially when using a VPN',
      'Install a canvas fingerprint randomizer extension to prevent unique identification',
      'Regularly clear cookies and site data to reduce persistent tracking',
      'Consider using Incognito Browser or Brave for built-in privacy protections',
    ],
    commonMistakes: [
      'Assuming incognito/private mode makes you anonymous — it only prevents local history storage',
      'Installing too many browser extensions, which actually increases your fingerprint uniqueness',
      'Ignoring WebRTC leaks, which can reveal your real IP even behind a VPN',
      'Not updating your browser regularly, leaving known security vulnerabilities unpatched',
      'Granting unnecessary permissions (camera, microphone, location) to websites',
    ],
  },
  'text-encryption': {
    howItWorks: 'This tool uses the Web Crypto API built into modern browsers to perform AES-256-GCM authenticated encryption. Your passphrase is converted into a cryptographic key using PBKDF2 with 100,000 iterations and a random salt. Each encryption generates a unique random IV (initialization vector), ensuring identical plaintexts produce different ciphertexts. Everything runs in your browser — no data is transmitted.',
    tips: [
      'Use a strong, unique passphrase — the encryption is only as secure as your passphrase',
      'Share the passphrase through a different channel than the encrypted message',
      'AES-256-GCM provides both confidentiality and integrity verification',
      'Save encrypted text as-is — any modification will make it impossible to decrypt',
      'For maximum security, use this tool in a private/incognito browsing session',
    ],
    commonMistakes: [
      'Using a weak or easily guessable passphrase defeats the purpose of encryption',
      'Sending the passphrase alongside the encrypted message in the same channel',
      'Modifying the encrypted output text, which corrupts the ciphertext and prevents decryption',
      'Forgetting the passphrase — there is no recovery mechanism with symmetric encryption',
      'Relying on encryption alone without also using secure communication channels',
    ],
  },
  'url-analyzer': {
    howItWorks: 'This tool parses and analyzes URL structure to detect common phishing indicators without making any network requests. It checks for suspicious TLDs, homograph attacks using non-ASCII characters, IP-based URLs, excessive subdomains, URL shortener detection, and path analysis for credential-harvesting keywords. The analysis runs entirely client-side for your safety.',
    tips: [
      'Always verify URLs before clicking, especially in emails and messages from unknown senders',
      'Look for HTTPS and a valid domain name — phishing sites often use HTTP or misspelled domains',
      'Be suspicious of URL shorteners in emails — they hide the true destination',
      'Check for subtle misspellings in domain names (e.g., g00gle.com, paypa1.com)',
      'When in doubt, navigate directly to the website by typing the URL yourself',
    ],
    commonMistakes: [
      'Clicking links in emails without verifying the actual URL destination',
      'Trusting a URL just because it contains a familiar brand name in the subdomain',
      'Ignoring browser security warnings about certificate or connection issues',
      'Entering login credentials on a page reached through an email link',
      'Assuming HTTPS alone means a website is legitimate — phishing sites use HTTPS too',
    ],
  },
  'hash-generator': {
    howItWorks: 'This tool uses the Web Crypto API to generate cryptographic hashes of your input text or files. It supports SHA-1, SHA-256, SHA-384, and SHA-512 algorithms. Hash functions produce a fixed-length fingerprint of any data — even a single character change produces a completely different hash. All processing occurs locally in your browser.',
    tips: [
      'Use SHA-256 or SHA-512 for security-critical applications — SHA-1 is considered weak',
      'Compare file hashes to verify downloads haven\'t been tampered with or corrupted',
      'Hash functions are one-way — you cannot reverse a hash to get the original data',
      'Even a single byte change in the input produces a completely different hash output',
      'Use the verify feature to quickly check if a file matches an expected hash',
    ],
    commonMistakes: [
      'Using SHA-1 for security purposes — it has known collision vulnerabilities',
      'Confusing hashing with encryption — hashes cannot be reversed, encryption can be decrypted',
      'Not verifying file hashes after downloading security-sensitive software',
      'Using hash functions alone for password storage — use PBKDF2, bcrypt, or Argon2 instead',
      'Assuming different hash algorithms produce the same length output',
    ],
  },
  'privacy-quiz': {
    howItWorks: 'This interactive quiz evaluates your privacy practices across multiple categories including browsing habits, network security, account management, communication, and device settings. Each answer is scored based on its privacy effectiveness, and the results are combined into an overall privacy score with category-by-category breakdown and personalized recommendations.',
    tips: [
      'Focus on improving your lowest-scoring categories first for the biggest privacy gains',
      'Privacy is a spectrum — even small improvements significantly reduce your exposure',
      'Revisit this quiz periodically to track your privacy improvements over time',
      'Share this quiz with friends and family to help them improve their privacy too',
      'Implement changes gradually — trying to overhaul everything at once is overwhelming',
    ],
    commonMistakes: [
      'Assuming one strong privacy measure (like a VPN) covers all bases',
      'Ignoring privacy settings on mobile devices, which often have weaker defaults',
      'Using free privacy tools that monetize your data — defeating the purpose',
      'Not keeping software and apps updated, which leaves security vulnerabilities open',
      'Oversharing on social media while investing in technical privacy measures',
    ],
  },
  'permission-checker': {
    howItWorks: 'This tool queries the browser Permissions API to check the status of various device permissions including location, camera, microphone, notifications, clipboard access, and device sensors. It reports whether each permission is granted, blocked, or set to prompt, along with risk assessments and privacy recommendations for each.',
    tips: [
      'Review and revoke unnecessary permissions regularly in your browser settings',
      'Deny location access by default and only grant it temporarily when needed',
      'Block notification permissions for most websites to prevent spam and malvertising',
      'Camera and microphone access should be denied by default — grant only for video calls',
      'Use browser settings to reset all permissions periodically for a clean slate',
    ],
    commonMistakes: [
      'Clicking "Allow" on permission prompts without reading what\'s being requested',
      'Forgetting that permissions persist after granting them — they don\'t auto-expire',
      'Not checking permissions after browser updates, which may reset or change defaults',
      'Granting clipboard read access, which lets sites read passwords you\'ve copied',
      'Allowing sensor access (accelerometer, gyroscope) which enables device fingerprinting',
    ],
  },
  'cookie-analyzer': {
    howItWorks: 'This tool reads and categorizes cookies using a database of known tracking, analytics, and functional cookies. It identifies cookies from major ad networks (Facebook Pixel, Google Analytics, TikTok), analytics platforms (Hotjar, Mixpanel), and categorizes unknown cookies using pattern matching on their names. The analysis runs entirely in your browser.',
    tips: [
      'Block third-party cookies in your browser settings to prevent cross-site tracking',
      'Use a cookie auto-delete extension to clear tracking cookies after each session',
      'Functional cookies (CSRF tokens, session IDs) are necessary and generally safe',
      'Review cookie settings on websites you visit frequently — many have opt-out options',
      'Consider using a browser like Brave or Incognito Browser that blocks tracking cookies by default',
    ],
    commonMistakes: [
      'Clicking "Accept All Cookies" without reviewing what you\'re consenting to',
      'Assuming clearing browser history also removes all cookies — it often doesn\'t',
      'Blocking all cookies indiscriminately, which breaks login sessions and site functionality',
      'Not realizing that cookie consent banners often use dark patterns to trick you into accepting',
      'Ignoring third-party cookies, which are the primary mechanism for cross-site tracking',
    ],
  },
  'useragent-analyzer': {
    howItWorks: 'This tool parses the user agent string that your browser sends with every HTTP request. It extracts and displays your browser name and version, operating system, device type, rendering engine, and architecture. It also identifies privacy concerns specific to your browser and highlights factors that contribute to your unique browser fingerprint.',
    tips: [
      'Consider using a browser that reduces or randomizes user agent strings',
      'The User-Agent Client Hints API is replacing traditional UA strings — but still reveals data',
      'Switching browsers periodically can reduce long-term fingerprint tracking',
      'Privacy-focused browsers like Brave and Firefox often reduce UA string detail',
      'Browser extensions can spoof your user agent, but this can create a more unique fingerprint',
    ],
    commonMistakes: [
      'Assuming user agent spoofing alone provides anonymity — many other fingerprinting vectors exist',
      'Using a very unusual or custom user agent string, which makes you more identifiable',
      'Not realizing that user agent data is sent with every single HTTP request',
      'Ignoring the privacy implications of browser and OS version information leakage',
      'Thinking that mobile browsers are more private — they often reveal even more device information',
    ],
  },
  'metadata-viewer': {
    howItWorks: 'This tool reads EXIF metadata from JPEG images directly in your browser. It parses the APP1 segment of JPEG files to extract camera information, timestamps, GPS coordinates, software details, and other embedded metadata. The image never leaves your device — all processing happens client-side using the File API and ArrayBuffer parsing.',
    tips: [
      'Always strip metadata from photos before sharing online, especially GPS coordinates',
      'Most phones embed precise GPS coordinates in every photo by default — check your settings',
      'Screenshots typically contain less metadata than camera photos',
      'Use image conversion (e.g., PNG to JPEG) as a simple way to strip most metadata',
      'Check metadata in photos before posting on dating apps or social media',
    ],
    commonMistakes: [
      'Assuming social media platforms strip all metadata — many preserve some data in their backend',
      'Not disabling location services for your camera app, embedding GPS in every photo',
      'Sharing original photos via email or messaging without stripping metadata first',
      'Forgetting that camera model and software information can identify you',
      'Not checking photos received from others for metadata before re-sharing',
    ],
  },
};

const DATA_DIR = path.join(process.cwd(), 'data', 'tools');

// Generate tool JSON for each niche
const taxonomy = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'taxonomy.json'), 'utf-8'));

let count = 0;
for (const niche of taxonomy.niches) {
  const toolInfo = NICHE_TOOL_MAP[niche.id];
  if (!toolInfo) {
    console.log(`⚠ No tool mapped for niche: ${niche.id}`);
    continue;
  }

  const educational = ENGINE_EDUCATIONAL[toolInfo.engine];
  if (!educational) {
    console.log(`⚠ No educational content for engine: ${toolInfo.engine}`);
    continue;
  }

  const nicheDir = path.join(DATA_DIR, niche.id);
  fs.mkdirSync(nicheDir, { recursive: true });

  const toolData = {
    niche: niche.id,
    slug: toolInfo.slug,
    title: toolInfo.title,
    metaDescription: toolInfo.description.substring(0, 160),
    keywords: niche.keywords.slice(0, 6),
    toolType: toolInfo.toolType,
    toolEngine: toolInfo.engine,
    description: toolInfo.description,
    inputs: [],
    educational,
  };

  const filePath = path.join(nicheDir, `${toolInfo.slug}.json`);
  fs.writeFileSync(filePath, JSON.stringify(toolData, null, 2));
  count++;
  console.log(`✓ ${niche.id}/${toolInfo.slug}`);
}

console.log(`\nGenerated ${count} tool data files.`);
