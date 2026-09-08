/**
 * Browser-side client for the scanner API — the ONE place that knows how to
 * talk to /challenge and /scan-url.
 *
 * Why this exists: the cookie scanner had a correct challenge→solve→scan
 * implementation inline, while the URL checker's "unfurl shortener" feature
 * POSTed to /scan-url with no proof-of-work at all AND against a hostname
 * that doesn't resolve. Two tools, two behaviours, one of them silently dead
 * in production. Any tool that needs the scanner goes through here.
 *
 * API base resolution:
 *   - server mode / Vercel:  ''  → same-origin. No env var, no CORS.
 *   - static export (droplet / WordPress): NEXT_PUBLIC_SCAN_API, defaulted in
 *     next.config.ts to the Vercel API host for BUILD_TARGET=static.
 *   Never a hardcoded hostname fallback — the old 'https://api.incognitobrowser.io'
 *   default doesn't resolve and broke every tool that used it on Vercel.
 *
 * No React in here; callers pass an optional onStatus callback for UI.
 */

export const SCAN_API_BASE: string = process.env.NEXT_PUBLIC_SCAN_API ?? '';

export type ScanStatus = 'verifying' | 'solving' | 'scanning';

export interface AltchaChallenge {
  algorithm: string;
  salt: string;
  challenge: string;
  maxnumber: number;
  signature: string;
  expires: number;
}

/** Wire format the server's verifySolution expects, base64-encoded in the Authorization header. */
export interface AltchaSolution {
  algorithm: string;
  salt: string;
  number: number;
  signature: string;
  expires: number;
}

export function encodeAuthorization(solution: AltchaSolution): string {
  return `Altcha ${btoa(JSON.stringify(solution))}`;
}

/**
 * Brute-force the challenge in this tab and return the Authorization header.
 *
 * Uses the synchronous js-sha256 rather than crypto.subtle — the async
 * per-call overhead made 100k iterations take ~30s in real browsers; sync
 * sha256 does the same work in ~200–500ms. Yields to the event loop every
 * 5k iterations so spinners animate and slow devices stay responsive.
 * Also: js-sha256 needs no secure context, so this works over plain HTTP.
 */
export async function solveChallenge(
  c: AltchaChallenge,
  onStatus?: (s: ScanStatus) => void,
): Promise<string> {
  onStatus?.('solving');
  const { sha256 } = await import('js-sha256');
  const target = c.challenge.toLowerCase();
  for (let n = 0; n <= c.maxnumber; n++) {
    if (sha256(c.salt + n) === target) {
      return encodeAuthorization({
        algorithm: c.algorithm,
        salt: c.salt,
        number: n,
        signature: c.signature,
        expires: c.expires,
      });
    }
    if (n % 5000 === 0 && n > 0) {
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  throw new Error('Could not solve challenge within search space');
}

/** Fetch a fresh challenge. Throws with the HTTP status on failure (403 = origin not allowlisted). */
export async function fetchChallenge(
  onStatus?: (s: ScanStatus) => void,
  apiBase: string = SCAN_API_BASE,
): Promise<AltchaChallenge> {
  onStatus?.('verifying');
  const res = await fetch(`${apiBase}/challenge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) throw new Error(`Challenge service returned ${res.status}`);
  return (await res.json()) as AltchaChallenge;
}

export interface ScanResult<T = unknown> {
  res: Response;
  /** Parsed JSON body — present for both 2xx and error responses (the API always returns JSON). */
  data: T & { error?: string; redirectTo?: string; url?: string };
}

/**
 * Full flow: challenge → solve → POST /scan-url with the proof in Authorization.
 * Returns the raw Response plus parsed body so callers keep their own
 * status handling (e.g. the URL checker treats a 400 + redirectTo as success —
 * that's how it unfurls shorteners).
 */
export async function scanUrl<T = unknown>(
  url: string,
  onStatus?: (s: ScanStatus) => void,
  apiBase: string = SCAN_API_BASE,
): Promise<ScanResult<T>> {
  const challenge = await fetchChallenge(onStatus, apiBase);
  const authorization = await solveChallenge(challenge, onStatus);
  onStatus?.('scanning');
  const res = await fetch(`${apiBase}/scan-url`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify({ url }),
  });
  const data = (await res.json()) as ScanResult<T>['data'];
  return { res, data };
}
