import path from 'node:path';
/** lib/event-schema — the allowlist that keeps /event from being a free-text sink, and the bounded key fan-out. */
import { describe, expect, it } from 'vitest';
import { validateEvent, eventKeys, dayOf, EVENT_TTL_SECONDS } from '../lib/event-schema';
import fs from 'node:fs';

describe('validateEvent', () => {
  it('accepts a full valid payload and strips nothing it needs', () => {
    const r = validateEvent({ event: 'cta_click', tool: 'whats-my-ip', niche: 'vpn-privacy', severity: 'red', target: 'play', platform: 'android', inApp: false });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ event: 'cta_click', tool: 'whats-my-ip', niche: 'vpn-privacy', severity: 'red', target: 'play', platform: 'android', inApp: false });
  });
  it('rejects unknown events, free text, arrays, and bad enums', () => {
    expect(validateEvent({ event: 'pageview' }).ok).toBe(false);
    expect(validateEvent({ event: 'cta_click', tool: 'Whats My IP' }).ok).toBe(false);
    expect(validateEvent({ event: 'cta_click', tool: 'a'.repeat(60) }).ok).toBe(false);
    expect(validateEvent({ event: 'cta_click', niche: '<script>' }).ok).toBe(false);
    expect(validateEvent({ event: 'cta_click', severity: 'purple' }).ok).toBe(false);
    expect(validateEvent({ event: 'cta_click', target: 'evil.example' }).ok).toBe(false);
    expect(validateEvent({ event: 'cta_click', platform: 'toaster' }).ok).toBe(false);
    expect(validateEvent({ event: 'cta_click', inApp: 'yes' }).ok).toBe(false);
    expect(validateEvent(['cta_click']).ok).toBe(false);
    expect(validateEvent(null).ok).toBe(false);
    expect(validateEvent('cta_click').ok).toBe(false);
  });
  it('ignores unknown extra fields rather than storing them', () => {
    const r = validateEvent({ event: 'tool_run', tool: 'hash-generator', email: 'x@y.z', ip: '1.2.3.4' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.value)).toEqual(['event', 'tool']);
  });
});

describe('eventKeys', () => {
  it('fans out to a bounded set of day-bucketed counters with no identifying data', () => {
    const keys = eventKeys('2026-09-08', { event: 'cta_click', tool: 'whats-my-ip', platform: 'android', target: 'play', severity: 'red', inApp: true });
    expect(keys).toEqual([
      'evt:2026-09-08:_all',
      'evt:2026-09-08:cta_click',
      'evt:2026-09-08:cta_click:whats-my-ip:android',
      'evt:2026-09-08:cta_click:whats-my-ip:android:play',
      'evt:2026-09-08:cta_click:whats-my-ip:android:sev-red',
      'evt:2026-09-08:_inapp:cta_click',
    ]);
    expect(keys.length).toBeLessThanOrEqual(6);
    expect(eventKeys('2026-09-08', { event: 'tool_run' })).toEqual(['evt:2026-09-08:_all', 'evt:2026-09-08:tool_run', 'evt:2026-09-08:tool_run:-:-']);
  });
  it('day buckets are UTC dates and the TTL is about 400 days', () => {
    expect(dayOf(new Date('2026-09-08T23:59:59Z'))).toBe('2026-09-08');
    expect(EVENT_TTL_SECONDS).toBe(400 * 86400);
  });
});

describe('/event route (source guards)', () => {
  const src = fs.readFileSync('app/event/route.ts', 'utf-8');
  it('gates on origin, rate-limits by network bucket, caps the body, never stores the IP, and is no-store', () => {
    expect(src).toMatch(/isOriginAllowed\(origin, host\)/);
    expect(src).toMatch(/rateLimit\(`evt:\$\{getIpBucket\(getClientIP\(request\.headers\)\)\}`/);
    expect(src).toMatch(/MAX_BODY = 2048/);
    expect(src).toMatch(/no-store, private/);
    expect(src).not.toMatch(/redis\.(set|rpush|lpush|hset)\(/);
    expect(src).toMatch(/pipe\.incr\(k\)/);
  });
  it('/stats is POST (static export excludes it), 404s without STATS_TOKEN, and requires a bearer token', () => {
    const s = fs.readFileSync('app/stats/route.ts', 'utf-8');
    expect(s).toMatch(/if \(!token\) return new NextResponse\(null, \{ status: 404/);
    expect(s).toMatch(/timingSafeEqual\(/); // constant-time bearer compare (audit 2026-09-08)
    expect(s).toMatch(/rateLimit\(`stats:/); // throttled: a bearer check with no limit is a free brute-force target
    expect(s).toMatch(/export async function POST/);
    expect(s).not.toMatch(/export async function GET/);
  });
});

describe('TOOL_IDS matches the engine registry', () => {
  it('every registered engine is an allowed counter key and nothing else is (except report-card)', async () => {
    const { TOOL_IDS } = await import('../lib/event-schema');
    const src = fs.readFileSync(path.join(process.cwd(), 'components/tools/registry.tsx'), 'utf-8');
    const registered = new Set([...src.matchAll(/^\s*'([a-z0-9-]+)':\s*[A-Z]\w+Tool,?$/gm)].map((m) => m[1]));
    expect(registered.size).toBeGreaterThanOrEqual(17);
    for (const id of registered) expect(TOOL_IDS.has(id), id).toBe(true);
    for (const id of TOOL_IDS) if (id !== 'report-card') expect(registered.has(id), id).toBe(true);
  });
});
