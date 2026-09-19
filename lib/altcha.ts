/**
 * Altcha-style proof-of-work challenge/response for API gating.
 *
 * Why this exists:
 *   The /scan-url endpoint accepts a user-supplied URL and fetches it server-side.
 *   Without an auth wall (the tool is "public, no signup"), an attacker can just
 *   scrape /scan-url with curl, bypass our CORS check by setting Origin manually,
 *   and abuse the endpoint as a free SSRF / fetch-proxy / amplification source.
 *
 *   This module forces every caller to spend ~100ms of real CPU computing a
 *   SHA-256 puzzle before they can call /scan-url. Combined with rate limiting,
 *   it makes scripted abuse expensive without inconveniencing real users.
 *
 * Protocol (compatible with Altcha widget but works without it):
 *   1. Client GETs /challenge → server returns
 *        { algorithm, salt, challenge, maxnumber, signature, expires }
 *      where:
 *        challenge = SHA-256(salt + secret_number), secret_number ∈ [0, maxnumber]
 *        signature = HMAC-SHA256(SERVER_SECRET, challenge|expires|salt)
 *   2. Client brute-forces n ∈ [0, maxnumber] until SHA-256(salt + n) === challenge.
 *      Typical wall time on a modern phone with maxnumber=100000: ~50-300ms.
 *   3. Client sends { algorithm, salt, number, signature, expires } as the
 *      Authorization header (base64-encoded JSON) on the /scan-url request.
 *   4. Server verifies:
 *        - signature is valid HMAC for our secret
 *        - expires hasn't elapsed
 *        - SHA-256(salt + number) === the challenge implied by the signature
 *
 *   Replay protection: a solved token is single-use. app/scan-url/route.ts
 *   claims it with SET NX on the signature (key `pow:<signature>`) and refuses
 *   a second scan with the same one. If that store cannot be reached the route
 *   fails closed with 503 rather than serving the scan, so the check is not
 *   something an attacker can switch off by knocking Redis over.
 *
 *   This paragraph used to say the opposite — that no nonce cache was kept,
 *   because "a serverless platform runs many instances". That platform is gone
 *   (API-ON-DROPLET.md, 2026-09-18): one Node process, Redis on localhost.
 *   The short TTL (default 90s) and the random per-challenge salt still apply,
 *   and are what bounds a token that is issued but never spent.
 */

import { createHmac, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'SHA-256';
const DEFAULT_MAX_NUMBER = 100_000;
const DEFAULT_TTL_SECONDS = 90;

/**
 * Hard ceiling on the search space, matching verifySolution's own `number`
 * check below. A challenge issued above this is one whose correct answer the
 * verifier would reject.
 */
const MAX_SEARCH_SPACE = 10_000_000;

/**
 * Draws before the rejection-sampling loop gives up and takes the modulo.
 *
 * With a correctly computed bound the rejection probability per draw is under
 * 1/2, so reaching 64 is around a 1-in-2^64 event and the fallback's modulo
 * bias never shows up in practice. It exists so that no arithmetic mistake or
 * unexpected `maxnumber` can turn this into a loop that never exits: this runs
 * on the single thread that serves the whole API, so a spin here is not a slow
 * endpoint, it is a dead server. That is exactly what POW_MAX_NUMBER=0 did —
 * `Math.floor(0x100000000 / 0) * 0` is NaN, and `r < NaN` is never true.
 */
const MAX_SAMPLING_DRAWS = 64;

/**
 * Ceiling on a challenge's lifetime, matching verifySolution's
 * `expires > now + 600` guard. Past it we would sign a token the verifier
 * treats as "expires too far in the future" and refuse.
 */
const MAX_TTL_SECONDS = 600;

export interface Challenge {
  algorithm: 'SHA-256';
  salt: string;
  challenge: string;
  maxnumber: number;
  signature: string;
  expires: number; // unix seconds
}

export interface Solution {
  algorithm: 'SHA-256';
  salt: string;
  number: number;
  signature: string;
  expires: number;
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Server secret — required at runtime. Throws if not set so we fail loud. */
function getSecret(): string {
  const secret = process.env.ALTCHA_HMAC_KEY;
  if (!secret || secret.length < 32) {
    throw new Error(
      'ALTCHA_HMAC_KEY env var is missing or too short. Set it to a 32+ character random string.',
    );
  }
  return secret;
}

/**
 * Build a fresh challenge. Call this from the /challenge endpoint.
 *
 * @param maxnumber Search space for the proof-of-work. Higher = more CPU for client.
 *                  100_000 ≈ 50–300ms on modern hardware. 1_000_000 ≈ 0.5–3s.
 * @param ttlSeconds How long the challenge is valid for. Default 90s.
 */
export function createChallenge(
  maxnumber = DEFAULT_MAX_NUMBER,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Challenge {
  const secret = getSecret();
  const saltBytes = randomBytes(12);
  const salt = saltBytes.toString('hex');
  // Clamp before any arithmetic depends on it. lib/tuning.ts already refuses a
  // POW_MAX_NUMBER outside [1, 10_000_000], but this function is exported and
  // takes the number from its caller, so it does not get to assume that.
  const span =
    Number.isSafeInteger(maxnumber) && maxnumber >= 1
      ? Math.min(maxnumber, MAX_SEARCH_SPACE)
      : DEFAULT_MAX_NUMBER;
  // Pick a random secret number in [0, span). The client has to find it.
  // Using rejection sampling to avoid modulo bias, bounded so it always exits.
  let secretNumber = 0;
  {
    const bound = Math.floor(0x100000000 / span) * span;
    for (let draw = 0; draw < MAX_SAMPLING_DRAWS; draw++) {
      const r = randomBytes(4).readUInt32BE(0);
      secretNumber = r % span;
      if (r < bound) break;
    }
  }
  const challenge = sha256Hex(salt + secretNumber);
  const ttl =
    Number.isSafeInteger(ttlSeconds) && ttlSeconds >= 1
      ? Math.min(ttlSeconds, MAX_TTL_SECONDS)
      : DEFAULT_TTL_SECONDS;
  const expires = Math.floor(Date.now() / 1000) + ttl;
  const signature = hmacHex(secret, `${challenge}|${expires}|${salt}`);
  // `span`, not the caller's `maxnumber`: the client brute-forces the range we
  // advertise, so advertising a range the secret number was not drawn from
  // hands out a challenge nobody can solve.
  return { algorithm: ALGORITHM, salt, challenge, maxnumber: span, signature, expires };
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a client-submitted solution. Call from any endpoint that requires POW.
 * Returns valid=true only if all of: signature matches, hasn't expired, the number
 * actually solves the SHA-256 puzzle implied by the signed challenge.
 */
export function verifySolution(solution: unknown): VerifyResult {
  if (!solution || typeof solution !== 'object') return { valid: false, reason: 'no_solution' };
  const s = solution as Record<string, unknown>;
  if (s.algorithm !== ALGORITHM) return { valid: false, reason: 'bad_algorithm' };
  if (typeof s.salt !== 'string' || s.salt.length > 64) return { valid: false, reason: 'bad_salt' };
  if (typeof s.number !== 'number' || s.number < 0 || s.number > MAX_SEARCH_SPACE)
    return { valid: false, reason: 'bad_number' };
  if (typeof s.signature !== 'string' || s.signature.length !== 64)
    return { valid: false, reason: 'bad_signature' };
  if (typeof s.expires !== 'number') return { valid: false, reason: 'bad_expires' };

  const now = Math.floor(Date.now() / 1000);
  if (s.expires < now) return { valid: false, reason: 'expired' };
  // Allow up to 10 minutes on the future side — the longest TTL createChallenge
  // will sign (MAX_TTL_SECONDS) plus whatever clock skew is left over. The
  // comment here used to say 5 minutes while the code said 600 seconds; the
  // code is the contract createChallenge clamps against, so the prose moved.
  if (s.expires > now + MAX_TTL_SECONDS) return { valid: false, reason: 'expires_too_far' };

  // Reconstruct the challenge the client claims to have solved
  const candidateChallenge = sha256Hex(s.salt + s.number);

  // Now verify the signature was issued for that challenge + expires + salt
  let secret: string;
  try { secret = getSecret(); }
  catch { return { valid: false, reason: 'secret_unset' }; }
  const expectedSig = hmacHex(secret, `${candidateChallenge}|${s.expires}|${s.salt}`);

  // Constant-time-ish compare to avoid timing leaks. (Pure-JS, not actually
  // constant time, but good enough for HMAC where attacker doesn't see timing.)
  if (expectedSig.length !== s.signature.length) return { valid: false, reason: 'sig_mismatch' };
  let diff = 0;
  for (let i = 0; i < expectedSig.length; i++) {
    diff |= expectedSig.charCodeAt(i) ^ (s.signature as string).charCodeAt(i);
  }
  if (diff !== 0) return { valid: false, reason: 'sig_mismatch' };

  return { valid: true };
}

/**
 * Parse the Altcha solution from an Authorization header value.
 * Expects: "Altcha <base64-encoded-json>"
 */
export function parseAltchaAuthHeader(authHeader: string | null): Solution | null {
  if (!authHeader) return null;
  const m = authHeader.match(/^Altcha\s+(.+)$/i);
  if (!m) return null;
  try {
    const decoded = Buffer.from(m[1], 'base64').toString('utf-8');
    const parsed = JSON.parse(decoded);
    if (
      parsed &&
      typeof parsed === 'object' &&
      typeof parsed.salt === 'string' &&
      typeof parsed.number === 'number' &&
      typeof parsed.signature === 'string' &&
      typeof parsed.expires === 'number'
    ) {
      return parsed as Solution;
    }
    return null;
  } catch {
    return null;
  }
}

/** Build the value to send in `Authorization: Altcha <...>` header from a solution. */
export function encodeAltchaAuthHeader(solution: Solution): string {
  return 'Altcha ' + Buffer.from(JSON.stringify(solution), 'utf-8').toString('base64');
}
