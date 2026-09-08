/**
 * POST /ip — "what's my IP" for the What's My IP tool, self-hosted.
 *
 * Why this exists: the tool used to call api.ipify.org + ipapi.co directly
 * from the browser. Two problems:
 *   1. A privacy tool was shipping every visitor's IP to two third parties.
 *   2. Our own CSP (`connect-src 'self' …`) correctly blocks those hosts on
 *      the Vercel server-mode build, so the tool silently timed out there.
 *
 * This route answers from data we already have on the inbound request — no
 * outbound call, no external dependency:
 *   - IP:  x-forwarded-for / x-real-ip (via getClientIP, same as the other routes)
 *   - Geo: the x-vercel-ip-* headers Vercel attaches to every request
 *          (city, region, country, timezone). Absent on localhost/droplet →
 *          fields come back null and the UI hides them.
 *
 * Deliberately NOT returned: ISP / ASN. That needs an external IP→ASN database.
 * The tool's UI is already conditional on those fields.
 *
 * Why POST: Next.js 16 `output: "export"` rejects non-static GET handlers;
 * POST handlers are excluded from the static export (see challenge/route.ts).
 * The static droplet build calls this cross-origin on the Vercel API, so the
 * caller's origin must be in ALLOWED_ORIGINS.
 *
 * Cache-Control is no-store. This response is per-visitor PII; it must never
 * be cached at the edge.
 */

import { NextRequest, NextResponse } from 'next/server';
import { rateLimit, getClientIP, getIpBucket } from '@/lib/rate-limit';
import { corsHeadersFor, isOriginAllowed } from '@/lib/origin';

// Generous — this only ever returns the caller's own data, so there's no
// amplification. The limit exists so the endpoint can't be scripted as a
// free IP/geo oracle at volume.
const IP_RATE_LIMIT_CONFIG = { limit: 60, windowMs: 60_000 };

const NO_STORE = { 'Cache-Control': 'no-store, private', Vary: 'Origin' };

export interface IpResponse {
  ip: string;
  version: 'v4' | 'v6';
  /** true when no proxy headers were present (local dev) — IP is a loopback placeholder */
  local: boolean;
  city: string | null;
  region: string | null;
  country: string | null;      // display name, e.g. "United States"
  countryCode: string | null;  // ISO 3166-1 alpha-2, e.g. "US"
  timezone: string | null;
}

function decodeHeader(h: Headers, name: string): string | null {
  const v = h.get(name);
  if (!v) return null;
  // Vercel URL-encodes these (e.g. "Culver%20City").
  try { return decodeURIComponent(v); } catch { return v; }
}

function countryName(code: string | null): string | null {
  if (!code) return null;
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function buildIpResponse(headers: Headers): IpResponse {
  const raw = getClientIP(headers);
  const hasIp = !!raw && raw !== 'unknown' && raw !== '::1' && raw !== '127.0.0.1';
  const ip = hasIp ? raw : '127.0.0.1';
  const countryCode = decodeHeader(headers, 'x-vercel-ip-country');
  return {
    ip,
    version: ip.includes(':') ? 'v6' : 'v4',
    local: !hasIp,
    city: decodeHeader(headers, 'x-vercel-ip-city'),
    region: decodeHeader(headers, 'x-vercel-ip-country-region'),
    country: countryName(countryCode),
    countryCode,
    timezone: decodeHeader(headers, 'x-vercel-ip-timezone'),
  };
}

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
  const cors = { ...corsHeadersFor(origin), ...NO_STORE };

  if (!isOriginAllowed(origin)) {
    return NextResponse.json({ error: 'Origin not allowed.' }, { status: 403, headers: cors });
  }

  const bucket = getIpBucket(getClientIP(request.headers));
  const rl = await rateLimit(`ip:${bucket}`, IP_RATE_LIMIT_CONFIG);
  const headers = { ...cors, ...rl.headers };
  if (!rl.allowed) {
    return NextResponse.json({ error: 'Too many requests.' }, { status: 429, headers });
  }

  // Never log the response — it's the visitor's IP + location.
  return NextResponse.json(buildIpResponse(request.headers), { headers });
}
