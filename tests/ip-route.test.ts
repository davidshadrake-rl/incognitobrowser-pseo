/**
 * POST /ip — self-hosted "what's my IP" endpoint.
 *
 * Guards the properties that matter for a privacy tool:
 *   - reads the client IP from proxy headers (first x-forwarded-for hop)
 *   - maps Vercel's per-request geo headers, decoding URL-encoding
 *   - degrades to a loopback placeholder (local:true) with no headers
 *   - never cacheable (Cache-Control: no-store) — the body is per-visitor PII
 *   - origin-gated like every other route
 *   - makes NO outbound request (there's nothing to mock — that's the point)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

const ORIGIN = 'https://incognitobrowser.io';

async function loadRoute() {
  const origin = await import('../lib/origin');
  origin._resetOriginCacheForTests();
  return import('../app/ip/route');
}

function req(headers: Record<string, string> = {}, withOrigin = true): NextRequest {
  return new NextRequest('https://api.incognitobrowser.io/ip', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(withOrigin ? { origin: ORIGIN } : {}), ...headers },
    body: '{}',
  });
}

beforeEach(() => {
  process.env.ALLOWED_ORIGINS = ORIGIN;
});
afterEach(() => {
  delete process.env.ALLOWED_ORIGINS;
});

describe('POST /ip', () => {
  it('returns the first x-forwarded-for hop as the client IP (v4)', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ip).toBe('203.0.113.9');
    expect(body.version).toBe('v4');
    expect(body.local).toBe(false);
  });

  it('detects IPv6', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-forwarded-for': '2001:db8::1' }));
    const body = await res.json();
    expect(body.ip).toBe('2001:db8::1');
    expect(body.version).toBe('v6');
  });

  it('maps and URL-decodes the Vercel geo headers', async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      req({
        'x-forwarded-for': '203.0.113.9',
        'x-vercel-ip-city': 'Culver%20City',
        'x-vercel-ip-country-region': 'CA',
        'x-vercel-ip-country': 'US',
        'x-vercel-ip-timezone': 'America/Los_Angeles',
      }),
    );
    const body = await res.json();
    expect(body.city).toBe('Culver City');
    expect(body.region).toBe('CA');
    expect(body.countryCode).toBe('US');
    expect(body.country).toBe('United States');
    expect(body.timezone).toBe('America/Los_Angeles');
  });

  it('degrades to a loopback placeholder with local:true when no proxy headers exist', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req());
    const body = await res.json();
    expect(body.local).toBe(true);
    expect(body.ip).toBe('127.0.0.1');
    expect(body.city).toBeNull();
    expect(body.country).toBeNull();
  });

  it('is never cacheable — per-visitor PII must not sit at the edge', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-forwarded-for': '203.0.113.9' }));
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(res.headers.get('cache-control')).toMatch(/private/);
    expect(res.headers.get('vary')).toMatch(/Origin/);
  });

  it('rejects a non-allowlisted origin with 403', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ origin: 'https://evil.example' }, false));
    expect(res.status).toBe(403);
  });

  it('sets CORS headers for an allowed origin so the static droplet build can call it cross-origin', async () => {
    const { POST } = await loadRoute();
    const res = await POST(req({ 'x-forwarded-for': '203.0.113.9' }));
    expect(res.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });

  it('OPTIONS preflight allows POST', async () => {
    const { OPTIONS } = await loadRoute();
    const res = await OPTIONS(req());
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toMatch(/POST/);
  });
});
