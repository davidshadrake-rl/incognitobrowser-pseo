/**
 * Tuning knobs for the security stack, configurable via env vars.
 *
 * Centralized so we can adjust everything from the Vercel dashboard during
 * an incident — no code change, no rebuild required.
 *
 * ## Panic mode (under attack)
 *
 * Set these in Vercel → Settings → Environment Variables, then redeploy:
 *
 *   SCAN_RATE_LIMIT=2           # was 10, now 2 reqs/min/IP
 *   CHALLENGE_RATE_LIMIT=5      # was 30, now 5
 *   POW_MAX_NUMBER=1000000      # was 100k, now 1M (10x more CPU per request)
 *   MAX_BODY_SIZE_MB=1          # was 5, now 1 (less amplification)
 *
 * Vercel redeploys take ~60s. Effect: each abuse request now costs the
 * attacker ~2s of CPU instead of 200ms, only 2 requests/min get through
 * per IP, and outbound bandwidth per scan is capped at 1MB.
 *
 * To return to normal: delete the env vars (defaults take over) and redeploy.
 *
 * ## Adjusting individual values
 *
 * Each variable is documented inline. Most defaults are tuned for ~normal
 * traffic on a 9M-user marketing site with no auth wall. Adjust if you see
 * patterns of abuse or legitimate users hitting limits.
 */

function intEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return defaultValue;
  return parsed;
}

// -----------------------------------------------------------------------
// /scan-url
// -----------------------------------------------------------------------

/** Max requests per window per rate-limit key (IP bucket). Default: 10. */
export const SCAN_RATE_LIMIT = intEnv('SCAN_RATE_LIMIT', 10);

/** Rate-limit window in ms. Default: 60_000 (1 minute). */
export const SCAN_RATE_WINDOW_MS = intEnv('SCAN_RATE_WINDOW_MS', 60_000);

/** Max URL length the API will accept. Default: 2048. */
export const MAX_URL_LENGTH = intEnv('MAX_URL_LENGTH', 2048);

/** Max response body size from scanned targets, in bytes. Default: 5 MB. */
export const MAX_BODY_SIZE =
  intEnv('MAX_BODY_SIZE_MB', 5) * 1024 * 1024;

/** Max Set-Cookie headers processed per scan. Default: 100. */
export const MAX_COOKIES = intEnv('MAX_COOKIES', 100);

/** Max script-src regex iterations per scan. Default: 500. */
export const MAX_SCRIPT_MATCHES = intEnv('MAX_SCRIPT_MATCHES', 500);

/** Max third-party domains returned in the response. Default: 50. */
export const MAX_THIRD_PARTY_DOMAINS = intEnv('MAX_THIRD_PARTY_DOMAINS', 50);

/** Fetch timeout in ms for the scanned URL. Default: 10_000. */
export const FETCH_TIMEOUT_MS = intEnv('FETCH_TIMEOUT_MS', 10_000);

// -----------------------------------------------------------------------
// /challenge
// -----------------------------------------------------------------------

/** Max challenge requests per window per IP. Default: 30. */
export const CHALLENGE_RATE_LIMIT = intEnv('CHALLENGE_RATE_LIMIT', 30);

/** Challenge rate-limit window in ms. Default: 60_000 (1 minute). */
export const CHALLENGE_RATE_WINDOW_MS = intEnv('CHALLENGE_RATE_WINDOW_MS', 60_000);

/** Search space for the proof-of-work. Higher = more CPU per request.
 *  100k ≈ 50–300ms on phones. 1M ≈ 0.5–3s. Default: 100_000. */
export const POW_MAX_NUMBER = intEnv('POW_MAX_NUMBER', 100_000);

/** How long the challenge token stays valid. Default: 90 seconds. */
export const POW_TTL_SECONDS = intEnv('POW_TTL_SECONDS', 90);
