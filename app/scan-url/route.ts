import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIP } from '@/lib/rate-limit';
import { parseAltchaAuthHeader, verifySolution } from '@/lib/altcha';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';

// Known tracking script patterns to look for in HTML
const TRACKER_PATTERNS: { pattern: RegExp; name: string; category: 'tracking' | 'analytics' | 'functional'; risk: 'high' | 'medium' | 'low'; description: string }[] = [
  // Ad tracking
  { pattern: /google-analytics\.com|googletagmanager\.com|gtag\/js/i, name: 'Google Analytics / GTM', category: 'analytics', risk: 'medium', description: 'Google Analytics or Tag Manager — collects page views, user behavior, demographics' },
  { pattern: /connect\.facebook\.net|fbevents\.js|fbq\(/i, name: 'Facebook Pixel', category: 'tracking', risk: 'high', description: 'Facebook/Meta Pixel — tracks conversions and builds ad audiences across the web' },
  { pattern: /snap\.licdn\.com|linkedin\.com\/px/i, name: 'LinkedIn Insight', category: 'tracking', risk: 'high', description: 'LinkedIn Insight Tag — tracks conversions and retargets LinkedIn users' },
  { pattern: /ads-twitter\.com|static\.ads-twitter\.com|twq\(/i, name: 'Twitter/X Pixel', category: 'tracking', risk: 'high', description: 'Twitter/X conversion tracking pixel — measures ad performance' },
  { pattern: /analytics\.tiktok\.com|tiktok\.com\/i18n\/pixel/i, name: 'TikTok Pixel', category: 'tracking', risk: 'high', description: 'TikTok Pixel — tracks user activity for ad targeting on TikTok' },
  { pattern: /pinterest\.com\/ct\.html|pintrk\(/i, name: 'Pinterest Tag', category: 'tracking', risk: 'high', description: 'Pinterest conversion tracking tag' },
  { pattern: /googlesyndication\.com|adsbygoogle/i, name: 'Google AdSense', category: 'tracking', risk: 'high', description: 'Google AdSense — serves personalized display ads' },
  { pattern: /doubleclick\.net/i, name: 'Google DoubleClick', category: 'tracking', risk: 'high', description: 'Google DoubleClick — ad serving and cross-site tracking' },
  { pattern: /amazon-adsystem\.com/i, name: 'Amazon Ads', category: 'tracking', risk: 'high', description: 'Amazon advertising pixel — tracks shopping behavior for ad targeting' },
  { pattern: /criteo\.com|criteo\.net/i, name: 'Criteo', category: 'tracking', risk: 'high', description: 'Criteo retargeting — follows you across sites to show personalized ads' },
  { pattern: /taboola\.com/i, name: 'Taboola', category: 'tracking', risk: 'high', description: 'Taboola content recommendation — tracks browsing for ad personalization' },
  { pattern: /outbrain\.com/i, name: 'Outbrain', category: 'tracking', risk: 'high', description: 'Outbrain content recommendation and native advertising tracker' },

  // Analytics
  { pattern: /hotjar\.com|static\.hotjar\.com/i, name: 'Hotjar', category: 'analytics', risk: 'medium', description: 'Hotjar — records user sessions, heatmaps, and click tracking' },
  { pattern: /fullstory\.com/i, name: 'FullStory', category: 'analytics', risk: 'medium', description: 'FullStory — full session replay and user behavior recording' },
  { pattern: /clarity\.ms/i, name: 'Microsoft Clarity', category: 'analytics', risk: 'medium', description: 'Microsoft Clarity — free session recording and heatmap analytics' },
  { pattern: /mixpanel\.com/i, name: 'Mixpanel', category: 'analytics', risk: 'medium', description: 'Mixpanel — product analytics and user event tracking' },
  { pattern: /segment\.com|segment\.io|cdn\.segment/i, name: 'Segment', category: 'analytics', risk: 'medium', description: 'Segment — customer data platform that pipes data to many services' },
  { pattern: /amplitude\.com/i, name: 'Amplitude', category: 'analytics', risk: 'medium', description: 'Amplitude — product analytics and user behavior tracking' },
  { pattern: /plausible\.io/i, name: 'Plausible', category: 'analytics', risk: 'low', description: 'Plausible — privacy-friendly analytics (no cookies, GDPR compliant)' },
  { pattern: /umami\.is|analytics\.umami/i, name: 'Umami', category: 'analytics', risk: 'low', description: 'Umami — open-source, privacy-focused web analytics' },
  { pattern: /heap\.io|heapanalytics/i, name: 'Heap', category: 'analytics', risk: 'medium', description: 'Heap — auto-captures all user interactions for analytics' },
  { pattern: /mouseflow\.com/i, name: 'Mouseflow', category: 'analytics', risk: 'medium', description: 'Mouseflow — session replay, heatmaps, and funnel analytics' },
  { pattern: /logrocket\.com|logrocket\.io/i, name: 'LogRocket', category: 'analytics', risk: 'medium', description: 'LogRocket — session replay with network request logging' },
  { pattern: /sentry\.io|browser\.sentry-cdn/i, name: 'Sentry', category: 'functional', risk: 'low', description: 'Sentry — error monitoring and performance tracking (developer tool)' },

  // Social / embeds
  { pattern: /platform\.twitter\.com\/widgets/i, name: 'Twitter Widgets', category: 'tracking', risk: 'medium', description: 'Twitter embedded widgets — can track visitors via third-party cookies' },
  { pattern: /connect\.facebook\.net\/.*\/sdk/i, name: 'Facebook SDK', category: 'tracking', risk: 'high', description: 'Facebook SDK — enables social features but tracks all visitors' },
  { pattern: /apis\.google\.com\/js\/platform/i, name: 'Google Platform', category: 'tracking', risk: 'medium', description: 'Google Platform JS — enables sign-in and social features with tracking' },
  { pattern: /recaptcha/i, name: 'reCAPTCHA', category: 'functional', risk: 'medium', description: 'Google reCAPTCHA — bot protection that also sends data to Google' },

  // Chat/support
  { pattern: /intercom\.io|intercomcdn/i, name: 'Intercom', category: 'analytics', risk: 'medium', description: 'Intercom — customer messaging platform with visitor tracking' },
  { pattern: /crisp\.chat/i, name: 'Crisp', category: 'functional', risk: 'low', description: 'Crisp — live chat widget' },
  { pattern: /drift\.com/i, name: 'Drift', category: 'analytics', risk: 'medium', description: 'Drift — conversational marketing with visitor tracking' },
  { pattern: /hubspot\.com|hs-scripts|hs-analytics/i, name: 'HubSpot', category: 'analytics', risk: 'medium', description: 'HubSpot — marketing analytics, CRM tracking, and lead scoring' },

  // CDN / functional
  { pattern: /cloudflare\.com\/cdn-cgi/i, name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare — CDN and security (bot protection, DDoS mitigation)' },
  { pattern: /stripe\.com\/v3|js\.stripe/i, name: 'Stripe', category: 'functional', risk: 'low', description: 'Stripe — payment processing (necessary for transactions)' },
];

// Known cookie names mapped to trackers
const KNOWN_COOKIES: Record<string, { name: string; category: 'tracking' | 'analytics' | 'functional'; risk: 'high' | 'medium' | 'low'; description: string }> = {
  '_ga': { name: 'Google Analytics', category: 'analytics', risk: 'medium', description: 'Google Analytics user identifier — persists across sessions for up to 2 years' },
  '_gid': { name: 'Google Analytics', category: 'analytics', risk: 'medium', description: 'Google Analytics 24-hour user identifier' },
  '_gat': { name: 'Google Analytics', category: 'analytics', risk: 'low', description: 'Google Analytics rate throttle' },
  '_gcl_au': { name: 'Google Ads', category: 'tracking', risk: 'high', description: 'Google Ads conversion linker — connects ad clicks to site actions' },
  '_fbp': { name: 'Facebook', category: 'tracking', risk: 'high', description: 'Facebook Pixel browser ID — tracks you across the web for ad targeting' },
  '_fbc': { name: 'Facebook', category: 'tracking', risk: 'high', description: 'Facebook click identifier from ad campaigns' },
  'fr': { name: 'Facebook', category: 'tracking', risk: 'high', description: 'Facebook advertising cookie used for ad delivery and retargeting' },
  '_ttp': { name: 'TikTok', category: 'tracking', risk: 'high', description: 'TikTok tracking pixel identifier' },
  '_tt_enable_cookie': { name: 'TikTok', category: 'tracking', risk: 'high', description: 'TikTok cookie capability check' },
  'IDE': { name: 'Google DoubleClick', category: 'tracking', risk: 'high', description: 'DoubleClick ad targeting — tracks across websites for personalized ads' },
  'NID': { name: 'Google', category: 'tracking', risk: 'medium', description: 'Google preferences and ad personalization cookie' },
  'MUID': { name: 'Microsoft/Bing', category: 'tracking', risk: 'high', description: 'Microsoft universal identifier — tracks across Bing and Microsoft services' },
  '_uetsid': { name: 'Microsoft Ads', category: 'tracking', risk: 'high', description: 'Microsoft UET session tracking for ad conversions' },
  '_uetvid': { name: 'Microsoft Ads', category: 'tracking', risk: 'high', description: 'Microsoft UET visitor tracking — persists across sessions' },
  '_hjid': { name: 'Hotjar', category: 'analytics', risk: 'medium', description: 'Hotjar user identifier for session recordings' },
  '_hjSessionUser': { name: 'Hotjar', category: 'analytics', risk: 'medium', description: 'Hotjar session-level user identifier' },
  'mp_': { name: 'Mixpanel', category: 'analytics', risk: 'medium', description: 'Mixpanel analytics identifier' },
  'ajs_anonymous_id': { name: 'Segment', category: 'analytics', risk: 'medium', description: 'Segment anonymous visitor identifier' },
  '__cf_bm': { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare bot management — necessary for security' },
  'cf_clearance': { name: 'Cloudflare', category: 'functional', risk: 'low', description: 'Cloudflare challenge clearance token' },
  '__stripe_mid': { name: 'Stripe', category: 'functional', risk: 'low', description: 'Stripe fraud prevention identifier' },
  '__stripe_sid': { name: 'Stripe', category: 'functional', risk: 'low', description: 'Stripe session identifier for payments' },
  'PHPSESSID': { name: 'PHP Session', category: 'functional', risk: 'low', description: 'PHP server-side session cookie — standard functionality' },
  'JSESSIONID': { name: 'Java Session', category: 'functional', risk: 'low', description: 'Java server-side session cookie — standard functionality' },
  'csrftoken': { name: 'CSRF Protection', category: 'functional', risk: 'low', description: 'Cross-site request forgery protection token' },
};

function categorizeCookie(cookieStr: string) {
  const [nameVal] = cookieStr.split(';');
  const [name] = nameVal.split('=');
  const cookieName = name.trim();

  // Check exact matches
  if (KNOWN_COOKIES[cookieName]) {
    return { cookieName, ...KNOWN_COOKIES[cookieName] };
  }

  // Check prefix matches
  for (const [key, info] of Object.entries(KNOWN_COOKIES)) {
    if (key.endsWith('_') && cookieName.startsWith(key)) {
      return { cookieName, ...info };
    }
  }

  // Heuristic
  const lower = cookieName.toLowerCase();
  if (lower.includes('track') || lower.includes('uid') || lower.includes('visitor') || lower.includes('_px')) {
    return { cookieName, name: 'Unknown Tracker', category: 'tracking' as const, risk: 'medium' as const, description: 'Likely a tracking cookie based on naming pattern' };
  }
  if (lower.includes('session') || lower.includes('csrf') || lower.includes('token') || lower.includes('auth')) {
    return { cookieName, name: 'Functional', category: 'functional' as const, risk: 'low' as const, description: 'Likely a functional/security cookie' };
  }

  // Parse attributes for additional context
  const parts = cookieStr.toLowerCase();
  const isThirdParty = parts.includes('samesite=none');
  const isLongLived = /max-age=\d{7,}/.test(parts) || /expires=.*20[3-9]/.test(parts);

  if (isThirdParty) {
    return { cookieName, name: 'Third-Party Cookie', category: 'tracking' as const, risk: 'high' as const, description: 'SameSite=None allows cross-site tracking' };
  }
  if (isLongLived) {
    return { cookieName, name: 'Long-Lived Cookie', category: 'analytics' as const, risk: 'medium' as const, description: 'Cookie with extended expiry — persistent tracking possible' };
  }

  return { cookieName, name: 'Unknown', category: 'unknown' as const, risk: 'low' as const, description: 'Purpose unknown — could be functional or tracking' };
}

// SSRF Protection: block private/reserved IPs and cloud metadata endpoints
function isBlockedHostname(hostname: string): boolean {
  const lower = hostname.toLowerCase();

  // Block localhost variants
  if (lower === 'localhost' || lower === 'localhost.localdomain') return true;

  // Block common cloud metadata endpoints
  if (lower === 'metadata.google.internal') return true;
  if (lower === 'metadata.google.com') return true;

  // Strip IPv6 brackets
  const ip = lower.replace(/^\[/, '').replace(/\]$/, '');

  // Handle IPv4-mapped IPv6
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;

  // Block IPv4 private/reserved ranges
  const blockedIPv4 = [
    /^127\./,                          // Loopback
    /^10\./,                           // RFC 1918
    /^172\.(1[6-9]|2[0-9]|3[01])\./,  // RFC 1918
    /^192\.168\./,                     // RFC 1918
    /^169\.254\./,                     // Link-local / AWS metadata
    /^0\./,                            // Current network
    /^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\./,  // Carrier-grade NAT
    /^192\.0\.0\./,                    // IETF protocol assignments
    /^198\.1[89]\./,                   // Benchmarking
    /^255\.255\.255\.255$/,            // Broadcast
  ];
  if (blockedIPv4.some(r => r.test(v4))) return true;

  // Block IPv6 private/reserved
  const blockedIPv6 = [
    /^::1$/,           // Loopback
    /^fc[0-9a-f]{2}:/i,  // Unique local
    /^fd[0-9a-f]{2}:/i,  // Unique local
    /^fe80:/i,         // Link-local
    /^ff[0-9a-f]{2}:/i,  // Multicast
    /^::$/,            // Unspecified
  ];
  if (blockedIPv6.some(r => r.test(ip))) return true;

  return false;
}

// Input length limits
const MAX_URL_LENGTH = 2048;
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB max response to read
const MAX_COOKIES = 100; // Max Set-Cookie headers to process
const MAX_SCRIPT_MATCHES = 500; // Max script src regex iterations
const MAX_THIRD_PARTY_DOMAINS = 50; // Already sliced at response time

// Read a response body with a hard byte cap. Aborts the stream once the cap is hit.
async function readCappedText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        // Decode what fits, then bail. Truncation is intentional.
        const remaining = value.byteLength - (received - maxBytes);
        if (remaining > 0) out += decoder.decode(value.subarray(0, remaining), { stream: false });
        try { await reader.cancel(); } catch { /* ignore */ }
        break;
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* ignore */ }
  }
  return out;
}

// Origin allowlist + CORS helpers come from lib/origin.ts (shared with /challenge).
// Configure via ALLOWED_ORIGINS env var.

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(origin) });
}

// Rate limit: 10 requests per minute per IP
const RATE_LIMIT_CONFIG = { limit: 10, windowMs: 60_000 };

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const cors = corsHeadersFor(origin);

  // Strict origin check — reject requests from origins not in the allowlist.
  // This is one of three layers (origin check, POW challenge, rate limit).
  // Note: Origin is set by the browser and cannot be spoofed from page JS, but
  // CAN be spoofed by curl/scripts. The POW below is what actually defends
  // against scripted abuse.
  if (!isOriginAllowed(origin)) {
    return NextResponse.json(
      { error: 'Origin not allowed.' },
      { status: 403, headers: cors }
    );
  }

  // Rate limiting (per IP) — async because Redis is async
  const clientIP = getClientIP(request.headers);
  const rl = await rateLimit(clientIP, RATE_LIMIT_CONFIG);
  const allHeaders: Record<string, string> = { ...cors, ...rl.headers };

  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429, headers: allHeaders }
    );
  }

  // Altcha proof-of-work check. The client must have called /challenge, solved
  // the SHA-256 puzzle, and put the solution in the Authorization header.
  // This is what makes scripted abuse expensive — every call costs ~100ms of CPU.
  const solution = parseAltchaAuthHeader(request.headers.get('authorization'));
  const altchaResult = verifySolution(solution);
  if (!altchaResult.valid) {
    return NextResponse.json(
      {
        error:
          'Missing or invalid proof-of-work token. Call /challenge first, solve it, and send the solution as the Authorization header.',
        reason: altchaResult.reason,
      },
      { status: 401, headers: allHeaders }
    );
  }

  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400, headers: allHeaders });
    }

    // Input length check
    if (url.length > MAX_URL_LENGTH) {
      return NextResponse.json({ error: 'URL is too long (max 2048 characters)' }, { status: 400, headers: allHeaders });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400, headers: allHeaders });
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400, headers: allHeaders });
    }

    // SSRF Protection: block private/internal networks
    if (isBlockedHostname(parsedUrl.hostname)) {
      return NextResponse.json(
        { error: 'Cannot scan private IP addresses, localhost, or internal networks.' },
        { status: 400, headers: allHeaders }
      );
    }

    // Block non-standard ports commonly used for internal services
    const port = parsedUrl.port ? parseInt(parsedUrl.port, 10) : (parsedUrl.protocol === 'https:' ? 443 : 80);
    if (port !== 80 && port !== 443 && port !== 8080 && port !== 8443) {
      return NextResponse.json(
        { error: 'Only standard web ports (80, 443, 8080, 8443) are supported.' },
        { status: 400, headers: allHeaders }
      );
    }

    const targetUrl = parsedUrl.href;

    // Fetch the URL with a timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    let response: Response;
    try {
      response = await fetch(targetUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
        },
        redirect: 'manual',  // Don't auto-follow redirects (SSRF prevention)
      });
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out (10s). The site may be slow or blocking automated requests.'
        : 'Failed to reach this URL. The site may be down or blocking requests.';
      return NextResponse.json({ error: message }, { status: 502, headers: allHeaders });
    }
    clearTimeout(timeout);

    // Reject redirect responses — with redirect:'manual' the body is empty/opaque,
    // and silently "scanning" an unfollowed redirect would give misleading results.
    // The Location header could also target an internal host we already blocked.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location') || '';
      return NextResponse.json(
        {
          error: `This URL redirects (HTTP ${response.status}). Please scan the final destination directly.`,
          redirectTo: location.slice(0, 500) || null,
        },
        { status: 400, headers: allHeaders }
      );
    }

    // Extract Set-Cookie headers
    const setCookies: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        setCookies.push(value);
      }
    });

    // Some servers send multiple cookies in one header
    // Also check getSetCookie if available
    const rawSetCookiesAll = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || setCookies;
    // Cap cookie array — a hostile server could send thousands of Set-Cookie headers
    const rawSetCookies = rawSetCookiesAll.slice(0, MAX_COOKIES);

    const cookies = rawSetCookies.map(cookieStr => {
      const categorized = categorizeCookie(cookieStr);
      // Extract attributes
      const parts = cookieStr.split(';').map(p => p.trim());
      const attributes: Record<string, string> = {};
      for (const part of parts.slice(1)) {
        const [k, v] = part.split('=');
        attributes[k.trim().toLowerCase()] = v?.trim() || 'true';
      }
      return {
        ...categorized,
        raw: cookieStr.length > 200 ? cookieStr.substring(0, 200) + '...' : cookieStr,
        secure: 'secure' in attributes,
        httpOnly: 'httponly' in attributes,
        sameSite: attributes['samesite'] || 'not set',
        domain: attributes['domain'] || parsedUrl.hostname,
        path: attributes['path'] || '/',
        maxAge: attributes['max-age'] || null,
        expires: attributes['expires'] || null,
      };
    });

    // Read HTML body for script analysis — capped to MAX_BODY_SIZE to prevent
    // memory exhaustion from malicious or huge target pages.
    const html = await readCappedText(response, MAX_BODY_SIZE);

    // Scan for tracking scripts
    const trackers = TRACKER_PATTERNS.filter(t => t.pattern.test(html)).map(t => ({
      name: t.name,
      category: t.category,
      risk: t.risk,
      description: t.description,
    }));

    // Count third-party script domains — capped at MAX_SCRIPT_MATCHES iterations
    // so pathological pages (e.g. 100k <script> tags) can't DoS the endpoint.
    // Bound URL length in the character class too, belt-and-suspenders against ReDoS.
    const scriptSrcRegex = /src=["'](https?:\/\/[^"']{1,2048})["']/gi;
    const thirdPartyDomains = new Set<string>();
    let match;
    let scriptIterations = 0;
    while ((match = scriptSrcRegex.exec(html)) !== null) {
      if (++scriptIterations > MAX_SCRIPT_MATCHES) break;
      if (thirdPartyDomains.size >= MAX_THIRD_PARTY_DOMAINS) break;
      try {
        const scriptUrl = new URL(match[1]);
        if (scriptUrl.hostname !== parsedUrl.hostname) {
          thirdPartyDomains.add(scriptUrl.hostname);
        }
      } catch {
        // skip invalid URLs
      }
    }

    // Check for meta pixel / other inline tracking
    const inlineTrackers: string[] = [];
    if (/fbq\s*\(\s*['"]init/i.test(html)) inlineTrackers.push('Facebook Pixel (inline)');
    if (/gtag\s*\(\s*['"]config/i.test(html)) inlineTrackers.push('Google gtag (inline)');
    if (/ga\s*\(\s*['"]create/i.test(html)) inlineTrackers.push('Google Analytics (inline)');
    if (/_linkedin_partner_id/i.test(html)) inlineTrackers.push('LinkedIn Insight (inline)');
    if (/twq\s*\(\s*['"]init/i.test(html)) inlineTrackers.push('Twitter Pixel (inline)');
    if (/pintrk\s*\(\s*['"]load/i.test(html)) inlineTrackers.push('Pinterest Tag (inline)');

    // HTTPS check
    const isHTTPS = parsedUrl.protocol === 'https:';

    // Content Security Policy
    const csp = response.headers.get('content-security-policy');
    const hasCSP = !!csp;

    // Permissions Policy
    const permPolicy = response.headers.get('permissions-policy');
    const hasPermPolicy = !!permPolicy;

    // HSTS
    const hsts = response.headers.get('strict-transport-security');
    const hasHSTS = !!hsts;

    return NextResponse.json({
      url: targetUrl,
      status: response.status,
      cookies,
      trackers,
      inlineTrackers,
      thirdPartyDomains: Array.from(thirdPartyDomains).slice(0, MAX_THIRD_PARTY_DOMAINS),
      security: {
        isHTTPS,
        hasCSP,
        hasPermPolicy,
        hasHSTS,
      },
      summary: {
        totalCookies: cookies.length,
        trackingCookies: cookies.filter(c => c.category === 'tracking').length,
        analyticsCookies: cookies.filter(c => c.category === 'analytics').length,
        functionalCookies: cookies.filter(c => c.category === 'functional').length,
        totalTrackers: trackers.length,
        thirdPartyScripts: thirdPartyDomains.size,
        highRiskItems: cookies.filter(c => c.risk === 'high').length + trackers.filter(t => t.risk === 'high').length,
      },
    }, { headers: allHeaders });
  } catch (err) {
    const errorType = err instanceof Error ? err.constructor.name : 'Unknown';
    console.error(`Scan error (${errorType}): ${err instanceof Error ? err.message : 'unknown'}`);
    return NextResponse.json({ error: 'An unexpected error occurred while scanning.' }, { status: 500, headers: allHeaders });
  }
}
