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
 *   Replay protection: short TTL (default 90s) + the salt is random per challenge.
 *   We do NOT keep a nonce cache because Vercel runs many instances; that would
 *   require Redis. The TTL window + rate limit makes replays not worth the effort.
 */

import { createHmac, randomBytes, createHash } from 'node:crypto';

const ALGORITHM = 'SHA-256';
const DEFAULT_MAX_NUMBER = 100_000;
const DEFAULT_TTL_SECONDS = 90;

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
  // Pick a random secret number in [0, maxnumber). The client has to find it.
  // Using rejection sampling to avoid modulo bias.
  let secretNumber: number;
  {
    const bound = Math.floor(0x100000000 / maxnumber) * maxnumber;
    while (true) {
      const r = randomBytes(4).readUInt32BE(0);
      if (r < bound) { secretNumber = r % maxnumber; break; }
    }
  }
  const challenge = sha256Hex(salt + secretNumber);
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  const signature = hmacHex(secret, `${challenge}|${expires}|${salt}`);
  return { algorithm: ALGORITHM, salt, challenge, maxnumber, signature, expires };
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
  if (typeof s.number !== 'number' || s.number < 0 || s.number > 10_000_000)
    return { valid: false, reason: 'bad_number' };
  if (typeof s.signature !== 'string' || s.signature.length !== 64)
    return { valid: false, reason: 'bad_signature' };
  if (typeof s.expires !== 'number') return { valid: false, reason: 'bad_expires' };

  const now = Math.floor(Date.now() / 1000);
  if (s.expires < now) return { valid: false, reason: 'expired' };
  // Allow up to 5 min clock skew on the future side
  if (s.expires > now + 600) return { valid: false, reason: 'expires_too_far' };

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
