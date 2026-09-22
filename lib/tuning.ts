/**
 * Tuning knobs for the security stack, configurable via env vars.
 *
 * Centralized so we can adjust everything from the service environment during
 * an incident — no code change, no rebuild required.
 *
 * ## Panic mode (under attack)
 *
 * Set these in /etc/ib-api.env, then restart ib-api:
 *
 *   SCAN_RATE_LIMIT=2           # was 10, now 2 reqs/min/IP
 *   CHALLENGE_RATE_LIMIT=5      # was 30, now 5
 *   POW_MAX_NUMBER=1000000      # was 100k, now 1M (10x more CPU per request)
 *   MAX_BODY_SIZE_MB=1          # was 5, now 1 (less amplification)
 *
 * A service restart takes a few seconds. Effect: each abuse request now costs the
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

/**
 * Read an integer env var, falling back to the default when it is absent or
 * nonsense.
 *
 * `min` and `max` are the interesting part. The old validation was
 * `if (Number.isNaN(parsed) || parsed < 0) return defaultValue`, which accepts
 * zero and accepts values past Number.MAX_SAFE_INTEGER. Both broke
 * createChallenge: POW_MAX_NUMBER=0 made its rejection-sampling bound
 * `Infinity * 0` = NaN, and POW_MAX_NUMBER=99999999999999999999 made it 0.
 * Either way `r < bound` was never true and the loop never terminated — one
 * env typo took /challenge into a spin that blocks Node's single thread, so
 * the whole API stopped answering. A value out of range is a misconfiguration,
 * and the safe reading of a misconfiguration is the default, not the typo.
 *
 * Which knobs may be zero is decided per knob below, not blanket-ly:
 *   - A pure ceiling on how much of a response we collect (cookies, script
 *     matches, third-party domains, URL length, body size) may be 0. Zero
 *     there means "collect nothing" / "accept nothing", which fails closed and
 *     is a coherent thing for an operator to ask for during an incident.
 *   - Anything a loop, a timeout or a division depends on may not be. Zero
 *     there either spins (POW_MAX_NUMBER), disables the control while looking
 *     enabled (a 0 ms rate-limit window makes every key a fresh window, so the
 *     limiter counts to 1 forever and fails OPEN), or aborts every request
 *     before it starts (FETCH_TIMEOUT_MS).
 */
function intEnv(
  name: string,
  defaultValue: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    // Loud, because a silent fallback is how a panic-mode typo survives an
    // incident: the operator sets the value, restarts, and sees no change.
    console.warn(
      `[tuning] ${name}=${JSON.stringify(raw)} is not an integer in [${min}, ${max}]; using ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

// -----------------------------------------------------------------------
// /scan-url
// -----------------------------------------------------------------------

/** Max requests per window per rate-limit key (IP bucket). Default: 10.
 *  0 is allowed and means "refuse every scan" — a deliberate kill switch. */
export const SCAN_RATE_LIMIT = intEnv('SCAN_RATE_LIMIT', 10);

/** Rate-limit window in ms. Default: 60_000 (1 minute).
 *  Floored at 1000: the Redis limiter keys on floor(now / windowMs) and sets
 *  the TTL in whole seconds, so a window under a second cannot be expressed —
 *  and a window of 0 makes every request its own window, which turns the
 *  limiter off while still reporting limits in its headers. */
export const SCAN_RATE_WINDOW_MS = intEnv('SCAN_RATE_WINDOW_MS', 60_000, 1000);

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

/** Fetch timeout in ms for the scanned URL. Default: 10_000.
 *  Range 100–120_000: 0 aborts every scan before the connection opens, and an
 *  arbitrarily large value holds a socket, a response buffer and one of the
 *  MAX_IN_FLIGHT_SCANS slots for as long as a hostile target cares to stall. */
export const FETCH_TIMEOUT_MS = intEnv('FETCH_TIMEOUT_MS', 10_000, 100, 120_000);

/**
 * How many scans may be in flight at once, across all callers. Default: 20.
 *
 * The per-IP rate limit bounds one visitor; it does nothing about a thousand
 * visitors, or a botnet with a thousand addresses. Each scan holds a socket, a
 * response buffer up to MAX_BODY_SIZE and an Apache worker for its whole life,
 * so without a global ceiling the memory cost of a flood is unbounded. Past
 * the cap the route answers 503 immediately rather than queueing, because a
 * queue under flood just converts a fast rejection into a slow one.
 */
export const MAX_IN_FLIGHT_SCANS = intEnv('MAX_IN_FLIGHT_SCANS', 20, 1);

/**
 * How many of those slots ONE rate-limit bucket may hold. Default: 2.
 *
 * The global cap alone does not stop one network taking every slot. Measured
 * 2026-09-21: a scan takes ~790ms typically but may stall for the full
 * FETCH_TIMEOUT_MS against a server the caller controls, so ~4 new scans/sec
 * holds all 20 — about 12% of one core in proof-of-work — and everyone else
 * drops to 4 scans/sec while they are held.
 *
 * At 2, denying the service needs at least 10 distinct networks with rate-limit
 * budget in each, instead of a single one. It also keeps one busy office or
 * carrier NAT from crowding out the rest, which is the commoner and entirely
 * innocent version of the same thing.
 */
export const MAX_IN_FLIGHT_PER_BUCKET = intEnv('MAX_IN_FLIGHT_PER_BUCKET', 2, 1);

/**
 * Where a configuration problem is said out loud. lib/net-address.ts reports a
 * malformed BLOCKED_TARGET_HOSTS entry through this rather than calling console
 * itself: that file handles raw scan material and is held to ZERO console
 * references by tests/audit-6-company.test.ts, because the natural place for
 * a "debug" line that leaks every scanned Set-Cookie is exactly there. Config
 * belongs to this file, and this file is already loud (see intEnv).
 */
export function reportConfigProblem(message: string): void {
  console.warn(`[tuning] ${message}`);
}

/**
 * Hosts and ranges the scanner refuses outright, beyond the private-range guard.
 *
 * Defaults to this project's own droplet. Scanning ourselves is free
 * self-amplification — one inbound request becomes two, one of which skips the
 * rate limiter because it arrives from our own address — and it can reach
 * vhosts on that address that were never meant to be a scan target.
 * Override with BLOCKED_TARGET_HOSTS as a comma-separated list. Each entry is
 * a hostname, an address, or a CIDR range — `20.30.40.0/24`, `2001:db8::/32`:
 *
 *   BLOCKED_TARGET_HOSTS=206.189.186.34,20.30.40.0/24,intranet.corp.example
 *
 * Ranges are what make this usable for a company deployment: a corporate
 * estate on publicly-routable space is the one thing neither the address
 * allowlist (lib/net-address.ts) nor the kernel egress policy can refuse,
 * because both are about private space, and an estate is a range, not a list
 * of hosts. Note the env REPLACES the default rather than adding to it.
 *
 * This is the raw list, normalised. lib/net-address.ts compiles it into
 * hostnames and address blocks, warns loudly about any entry it cannot
 * parse, and judges both legs of the scan route with matchesBlockedTarget().
 */
export const BLOCKED_TARGET_HOSTS: ReadonlySet<string> = new Set(
  (process.env.BLOCKED_TARGET_HOSTS ?? '206.189.186.34')
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/\.+$/, ''))
    .filter(Boolean),
);

// -----------------------------------------------------------------------
// /challenge
// -----------------------------------------------------------------------

/** Max challenge requests per window per IP. Default: 30.
 *  0 is allowed and means "issue no challenges", which stops scans too. */
export const CHALLENGE_RATE_LIMIT = intEnv('CHALLENGE_RATE_LIMIT', 30);

/** Challenge rate-limit window in ms. Default: 60_000 (1 minute).
 *  Floored at 1000 for the same reason as SCAN_RATE_WINDOW_MS. */
export const CHALLENGE_RATE_WINDOW_MS = intEnv('CHALLENGE_RATE_WINDOW_MS', 60_000, 1000);

/**
 * Search space for the proof-of-work. Higher = more CPU per request.
 * 100k ≈ 50–300ms on phones. 1M ≈ 0.5–3s. Default: 100_000.
 *
 * Range 1–10_000_000. The floor is what keeps createChallenge's rejection
 * sampling terminating: at 0 the bound is NaN and the loop spins forever on
 * the one thread that serves the whole API. The ceiling is verifySolution's —
 * it refuses any `number` above 10_000_000, so a larger search space would
 * issue challenges whose correct answer can never be accepted.
 */
export const POW_MAX_NUMBER = intEnv('POW_MAX_NUMBER', 100_000, 1, 10_000_000);

/**
 * How long the challenge token stays valid. Default: 90 seconds.
 *
 * Range 1–600. At 0 every challenge is already expired when it is handed out.
 * Above 600 it exceeds verifySolution's `expires > now + 600` guard, so again
 * the server would issue tokens it will then refuse.
 */
export const POW_TTL_SECONDS = intEnv('POW_TTL_SECONDS', 90, 1, 600);
