/**
 * Origin allowlist + CORS helper shared by /challenge and /scan-url.
 *
 * Configure via ALLOWED_ORIGINS env var (comma-separated). Falls back to the
 * incognitobrowser.io family if unset, so production keeps working even if the
 * env var is forgotten during a deploy.
 *
 * For test/staging domains, set ALLOWED_ORIGINS on Vercel to something like:
 *   "https://incognitobrowser.io,https://www.incognitobrowser.io,https://lightshapesallthings.info,http://206.189.186.34"
 *
 * IMPORTANT — Origin can be spoofed by non-browser clients. This list is one
 * layer of defense; the POW challenge, rate limit, and SSRF guards do the rest.
 */

const DEFAULT_ALLOWED = [
  'https://incognitobrowser.io',
  'https://www.incognitobrowser.io',
];

let cachedAllowed: string[] | null = null;

export function getAllowedOrigins(): string[] {
  if (cachedAllowed) return cachedAllowed;
  const envValue = process.env.ALLOWED_ORIGINS;
  if (!envValue) {
    cachedAllowed = DEFAULT_ALLOWED;
    return cachedAllowed;
  }
  cachedAllowed = envValue
    .split(',')
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  return cachedAllowed;
}

/** Test-only: reset cache so env changes in tests take effect. */
export function _resetOriginCacheForTests() {
  cachedAllowed = null;
}

/**
 * Is this Origin allowed to call the API?
 *
 * Two ways to be allowed:
 *   1. Same-origin: the Origin's host equals the request's own Host. The
 *      Vercel server-mode deploy serves pages AND the API from one host,
 *      so a page calling its own API is inherently trusted. Without this,
 *      the deployed site could not call itself unless someone remembered
 *      to add its own hostname to ALLOWED_ORIGINS — which is exactly how
 *      production shipped with the cookie scanner and /ip returning 403.
 *   2. Allowlisted: in ALLOWED_ORIGINS (or the default set). This is what
 *      genuinely cross-origin callers need — the static droplet/WordPress
 *      build calls the Vercel API from a different host.
 *
 * `requestHost` is `request.headers.get('host')`. Pass it from every route.
 * Comparing `URL.host` to the Host header keeps ports in the comparison.
 */
export function isOriginAllowed(origin: string | null, requestHost?: string | null): boolean {
  if (!origin) return false;
  if (requestHost) {
    try {
      if (new URL(origin).host === requestHost) return true;
    } catch {
      // malformed Origin — fall through to the allowlist, which will reject it
    }
  }
  return getAllowedOrigins().includes(origin);
}

/**
 * Returns the headers to attach to every response (CORS + security headers).
 * If the incoming Origin is allowed, mirrors it in Access-Control-Allow-Origin.
 * Otherwise omits the ACAO header (browsers will block the response).
 */
export function corsHeadersFor(origin: string | null, requestHost?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Type': 'application/json',
    Vary: 'Origin',
  };
  if (origin && isOriginAllowed(origin, requestHost)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'false';
  }
  return headers;
}
