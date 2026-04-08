import { NextRequest, NextResponse } from 'next/server';

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

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL format
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url.startsWith('http') ? url : `https://${url}`);
    } catch {
      return NextResponse.json({ error: 'Invalid URL format' }, { status: 400 });
    }

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are supported' }, { status: 400 });
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
        redirect: 'follow',
      });
    } catch (err) {
      clearTimeout(timeout);
      const message = err instanceof Error && err.name === 'AbortError'
        ? 'Request timed out (10s). The site may be slow or blocking automated requests.'
        : 'Failed to reach this URL. The site may be down or blocking requests.';
      return NextResponse.json({ error: message }, { status: 502 });
    }
    clearTimeout(timeout);

    // Extract Set-Cookie headers
    const setCookies: string[] = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'set-cookie') {
        setCookies.push(value);
      }
    });

    // Some servers send multiple cookies in one header
    // Also check getSetCookie if available
    const rawSetCookies = (response.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.() || setCookies;

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

    // Read HTML body for script analysis
    const html = await response.text();

    // Scan for tracking scripts
    const trackers = TRACKER_PATTERNS.filter(t => t.pattern.test(html)).map(t => ({
      name: t.name,
      category: t.category,
      risk: t.risk,
      description: t.description,
    }));

    // Count third-party script domains
    const scriptSrcRegex = /src=["'](https?:\/\/[^"']+)["']/gi;
    const thirdPartyDomains = new Set<string>();
    let match;
    while ((match = scriptSrcRegex.exec(html)) !== null) {
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
      thirdPartyDomains: Array.from(thirdPartyDomains).slice(0, 50),
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
    });
  } catch (err) {
    console.error('Scan error:', err);
    return NextResponse.json({ error: 'An unexpected error occurred while scanning.' }, { status: 500 });
  }
}
