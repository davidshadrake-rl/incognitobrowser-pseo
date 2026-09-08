import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIP, getIpBucket, getRedisClient } from '@/lib/rate-limit';
import { parseAltchaAuthHeader, verifySolution } from '@/lib/altcha';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';
import {
  SCAN_RATE_LIMIT,
  SCAN_RATE_WINDOW_MS,
  MAX_URL_LENGTH as TUNING_MAX_URL_LENGTH,
  MAX_BODY_SIZE as TUNING_MAX_BODY_SIZE,
  MAX_COOKIES as TUNING_MAX_COOKIES,
  MAX_SCRIPT_MATCHES as TUNING_MAX_SCRIPT_MATCHES,
  MAX_THIRD_PARTY_DOMAINS as TUNING_MAX_THIRD_PARTY_DOMAINS,
  FETCH_TIMEOUT_MS,
} from '@/lib/tuning';

// Tracker patterns, cookie classifier, SSRF guard, capped reader and the
// analysis itself live in lib/scanner.ts — shared with the offline Site
// Privacy Report Card batch so the public tool and the published grades
// can never disagree. Validation, fetch policy and error handling stay here.
import { isBlockedHostname, readCappedText, analyzeScan } from '@/lib/scanner';

// Input length limits — sourced from lib/tuning.ts so they can be tweaked
// via Vercel env vars without a redeploy. See SECURITY-DEPLOY.md for panic-mode
// values to set during an active incident.
const MAX_URL_LENGTH = TUNING_MAX_URL_LENGTH;
const MAX_BODY_SIZE = TUNING_MAX_BODY_SIZE;
const MAX_COOKIES = TUNING_MAX_COOKIES;
const MAX_SCRIPT_MATCHES = TUNING_MAX_SCRIPT_MATCHES;
const MAX_THIRD_PARTY_DOMAINS = TUNING_MAX_THIRD_PARTY_DOMAINS;

// Origin allowlist + CORS helpers come from lib/origin.ts (shared with /challenge).
// Configure via ALLOWED_ORIGINS env var.

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, { status: 204, headers: corsHeadersFor(origin, request.headers.get('host')) });
}

// Rate limit — values from lib/tuning.ts. Defaults: 10 reqs per 60s per IP.
const RATE_LIMIT_CONFIG = { limit: SCAN_RATE_LIMIT, windowMs: SCAN_RATE_WINDOW_MS };

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const cors = corsHeadersFor(origin, host);

  // Strict origin check — reject requests from origins not in the allowlist.
  // This is one of three layers (origin check, POW challenge, rate limit).
  // Note: Origin is set by the browser and cannot be spoofed from page JS, but
  // CAN be spoofed by curl/scripts. The POW below is what actually defends
  // against scripted abuse.
  if (!isOriginAllowed(origin, host)) {
    return NextResponse.json(
      { error: 'Origin not allowed.' },
      { status: 403, headers: cors }
    );
  }

  // Rate limit by /24 IPv4 (or /64 IPv6) network bucket, not exact IP.
  // Why: VPN/CGN users rotate egress IPs per connection. Exact-IP limiting
  // gives them effectively unlimited requests. /24 bucketing catches the
  // common case (same VPN exit pool, same /24) while still scoping abuse
  // narrowly enough that legit users on a shared NAT aren't unfairly grouped
  // with the rest of the internet.
  const clientIP = getClientIP(request.headers);
  const bucket = getIpBucket(clientIP);
  const rl = await rateLimit(bucket, RATE_LIMIT_CONFIG);
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
  // Single use: a solved token buys exactly one scan when Redis is configured
  // (SET NX on the signature for the token's remaining lifetime). Without
  // Redis the 90 s TTL + rate limit remain the only replay bound.
  const redis = getRedisClient();
  if (redis && solution) {
    try {
      const fresh = await redis.set(`pow:${solution.signature}`, '1', 'EX', 120, 'NX');
      if (fresh === null) {
        return NextResponse.json({ error: 'This proof-of-work token was already used. Request a new challenge.', reason: 'replayed' }, { status: 401, headers: allHeaders });
      }
    } catch {
      /* Redis hiccup: fall through to the TTL bound rather than fail the scan */
    }
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
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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

    // Read HTML body for script analysis — capped to MAX_BODY_SIZE to prevent
    // memory exhaustion from malicious or huge target pages.
    const html = await readCappedText(response, MAX_BODY_SIZE);

    const result = analyzeScan(targetUrl, parsedUrl, response, html, {
      maxCookies: MAX_COOKIES,
      maxScriptMatches: MAX_SCRIPT_MATCHES,
      maxThirdPartyDomains: MAX_THIRD_PARTY_DOMAINS,
    });
    return NextResponse.json(result, { headers: allHeaders });
  } catch (err) {
    const errorType = err instanceof Error ? err.constructor.name : 'Unknown';
    console.error(`Scan error (${errorType}): ${err instanceof Error ? err.message : 'unknown'}`);
    return NextResponse.json({ error: 'An unexpected error occurred while scanning.' }, { status: 500, headers: allHeaders });
  }
}
