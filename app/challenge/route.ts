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
import { rateLimit, getClientIP } from '@/lib/rate-limit';
import { getAllowedOrigins, corsHeadersFor, isOriginAllowed } from '@/lib/origin';

// Issue at most 30 challenges/min/IP. Tighter than /scan-url because each
// challenge represents a future scan attempt — if you're requesting more than
// one every 2 seconds, you're either DoS'ing us or building a bot.
const CHALLENGE_RATE_LIMIT = { limit: 30, windowMs: 60_000 };

// Challenge difficulty. Browser solves in ~50–300ms with maxnumber=100k.
// Raise if you see abuse; lower if real users complain about lag.
const POW_MAX_NUMBER = 100_000;
const POW_TTL_SECONDS = 90;

export async function OPTIONS(request: NextRequest) {
  const origin = request.headers.get('origin');
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeadersFor(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const cors = corsHeadersFor(origin);

  // Strict origin check — reject requests that aren't from an allowlisted origin.
  // Note: Origin can be spoofed by non-browser clients. This isn't the only
  // defense — the POW itself, the rate limit, and the server-side scan validation
  // are all in play. This just filters out the easy/lazy abusers.
  if (!isOriginAllowed(origin)) {
    return NextResponse.json(
      { error: 'Origin not allowed.' },
      { status: 403, headers: cors },
    );
  }

  // Rate limit per IP
  const ip = getClientIP(request.headers);
  const rl = rateLimit(`challenge:${ip}`, CHALLENGE_RATE_LIMIT);
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

  // Echo back the allowed origins (debug) — clients use this if they want to
  // pre-check before solving. Omit in production by setting DEBUG_ORIGINS=0.
  const debug =
    process.env.DEBUG_ORIGINS !== '0'
      ? { allowedOriginCount: getAllowedOrigins().length }
      : undefined;

  return NextResponse.json(
    { ...challenge, ...debug },
    { headers: allHeaders },
  );
}
