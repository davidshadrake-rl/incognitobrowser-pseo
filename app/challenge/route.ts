/**
 * POST /challenge — issues a fresh Altcha proof-of-work challenge.
 *
 * The client must solve the challenge (CPU work) and pass the solution as the
 * Authorization header on the next /scan-url call. See lib/altcha.ts.
 *
 * Why POST and not GET: Next.js 16 with `output: "export"` rejects GET route
 * handlers that aren't marked `force-static`. Our challenge IS dynamic (random
 * salt each call), so static is wrong. POST handlers are silently excluded
 * from static export, which is what we want — the static droplet build skips
 * this route, the Vercel server build still serves it.
 *
 * The body is unused; client can send `{}` or empty.
 *
 * Origin allowlist is configurable via env var ALLOWED_ORIGINS (comma-separated).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createChallenge } from '@/lib/altcha';
import { rateLimit, getClientIP, getIpBucket } from '@/lib/rate-limit';
import { getAllowedOrigins, corsHeadersFor, isOriginAllowed } from '@/lib/origin';
import {
  CHALLENGE_RATE_LIMIT as TUNING_CHALLENGE_RATE_LIMIT,
  CHALLENGE_RATE_WINDOW_MS,
  POW_MAX_NUMBER,
  POW_TTL_SECONDS,
} from '@/lib/tuning';

// Rate limit values from lib/tuning.ts. Defaults: 30 reqs / 60s / IP.
// Tighter than /scan-url because each challenge represents a future scan
// attempt — if you're requesting more than one every 2 seconds, you're either
// DoS'ing us or building a bot.
const CHALLENGE_RATE_LIMIT_CONFIG = {
  limit: TUNING_CHALLENGE_RATE_LIMIT,
  windowMs: CHALLENGE_RATE_WINDOW_MS,
};

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeadersFor(origin, request.headers.get('host')),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  const cors = corsHeadersFor(origin, host);

  // Origin check — same-origin (the deployed site calling its own API) is
  // always allowed; anything else must be in ALLOWED_ORIGINS.
  // Note: Origin can be spoofed by non-browser clients. This isn't the only
  // defense — the POW itself, the rate limit, and the server-side scan validation
  // are all in play. This just filters out the easy/lazy abusers.
  if (!isOriginAllowed(origin, host)) {
    return NextResponse.json(
      { error: 'Origin not allowed.' },
      { status: 403, headers: cors },
    );
  }

  // Rate limit by /24 bucket, not exact IP. Same rationale as /scan-url:
  // catches the VPN/CGN bypass without unfairly grouping legitimate
  // shared-network users with the global internet.
  const ip = getClientIP(request.headers);
  const bucket = getIpBucket(ip);
  const rl = await rateLimit(`challenge:${bucket}`, CHALLENGE_RATE_LIMIT_CONFIG);
  const allHeaders = { ...cors, ...rl.headers };
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many challenge requests.' },
      { status: 429, headers: allHeaders },
    );
  }

  // Generate and return the challenge. Server secret is required.
  let challenge;
  try {
    challenge = createChallenge(POW_MAX_NUMBER, POW_TTL_SECONDS);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    console.error(`Challenge gen failed: ${message}`);
    return NextResponse.json(
      { error: 'Challenge service is misconfigured. Try again later.' },
      { status: 503, headers: allHeaders },
    );
  }

  // Debug echo of the allowlist size is OPT-IN (DEBUG_ORIGINS=1); nothing about
  // the allowlist leaves the server by default.
  const debug =
    process.env.DEBUG_ORIGINS === '1'
      ? { allowedOriginCount: getAllowedOrigins().length }
      : undefined;

  return NextResponse.json(
    { ...challenge, ...debug },
    { headers: allHeaders },
  );
}
