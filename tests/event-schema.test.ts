import path from 'node:path';
/** lib/event-schema — the allowlist that keeps /event from being a free-text sink, and the bounded key fan-out. */
import { describe, expect, it } from 'vitest';
import { validateEvent, eventKeys, dayOf, EVENT_TTL_SECONDS } from '../lib/event-schema';
import { allFunnelPaths } from '../lib/funnels';
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
  it('accepts only the three Pro benefit ids and the five placement reasons', () => {
    for (const benefit of ['tracker-blocking', 'hides-ad-boxes', 'photo-cleaning']) {
      expect(validateEvent({ event: 'cta_click', tool: 'ad-blocker-test', target: 'play', benefit })).toEqual({ ok: true, value: { event: 'cta_click', tool: 'ad-blocker-test', target: 'play', benefit } });
    }
    for (const benefit of ['vpn', 'fingerprint-protection', 'Tracker-Blocking', 'tracker-blocking ', '', 42, null]) {
      expect(validateEvent({ event: 'cta_click', benefit }), String(benefit)).toEqual({ ok: false, error: 'bad benefit' });
    }
    for (const reason of ['scrolled', 'in-view', 'hidden', 'on-load', 'own-scroll']) {
      expect(validateEvent({ event: 'result_card_placed', reason }).ok, reason).toBe(true);
    }
    for (const reason of ['jumped', 'In-View', '', 1, null]) {
      expect(validateEvent({ event: 'result_card_placed', reason }), String(reason)).toEqual({ ok: false, error: 'bad reason' });
    }
  });
  it('accepts result_card_placed as ResultCard sends it', () => {
    const page = allFunnelPaths()[0];
    const r = validateEvent({ event: 'result_card_placed', tool: 'screenshot-leak-checker', severity: 'red', reason: 'scrolled', page, platform: 'android', inApp: false });
    expect(r).toEqual({ ok: true, value: { event: 'result_card_placed', tool: 'screenshot-leak-checker', severity: 'red', reason: 'scrolled', page, platform: 'android', inApp: false } });
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
  it('puts the benefit on the click key and the reason on its own key, still at most 7 keys', () => {
    const page = allFunnelPaths()[0];
    // Every field set: the cap holds (the page key is the one cut; no real event carries both a target and a reason).
    const every = eventKeys('2026-09-16', { event: 'cta_click', tool: 'ad-blocker-test', niche: 'ad-tracking', severity: 'red', target: 'play', platform: 'android', inApp: true, page, benefit: 'tracker-blocking', reason: 'scrolled' });
    expect(every.length).toBeLessThanOrEqual(7);
    expect(every).toContain('evt:2026-09-16:cta_click:ad-blocker-test:android:play:b-tracker-blocking');

    // What ResultCard really sends keeps its page key, which scripts/funnels/stats.ts reads.
    const click = eventKeys('2026-09-16', { event: 'cta_click', tool: 'ad-blocker-test', severity: 'red', target: 'play', platform: 'android', inApp: true, page, benefit: 'tracker-blocking' });
    expect(click.length).toBeLessThanOrEqual(7);
    expect(click).toContain('evt:2026-09-16:cta_click:ad-blocker-test:android:play:b-tracker-blocking');
    // Page key carries neither the target nor the severity for a click. Both
    // suffixes were dropped on 2026-09-18 to bound Redis key cardinality —
    // pages x events x severities x targets was ~630,000 keys/day. Nothing
    // read either: scripts/funnels/stats.ts captures the target in group 4 of
    // its page regex and never uses it, and reads severity only for
    // result_shown. Per-target and per-benefit clicks live on the tool key,
    // asserted on the line above.
    expect(click).toContain(`evt:2026-09-16:page:cta_click:${page}`);
    expect(click).not.toContain(`evt:2026-09-16:page:cta_click:${page}:sev-red:play`);
    // Severity still rides along for result_shown, the one event that reads it.
    expect(eventKeys('2026-09-16', { event: 'result_shown', tool: 'ad-blocker-test', severity: 'red', page }))
      .toContain(`evt:2026-09-16:page:result_shown:${page}:sev-red`);
    const placed = eventKeys('2026-09-16', { event: 'result_card_placed', tool: 'ad-blocker-test', severity: 'red', platform: 'ios', inApp: true, page, reason: 'own-scroll' });
    expect(placed.length).toBeLessThanOrEqual(7);
    expect(placed).toContain('evt:2026-09-16:result_card_placed:ad-blocker-test:ios:r-own-scroll');
    // Same rule: no severity on a page key that is not result_shown. This one
    // is not read at all — scripts/funnels/stats.ts's page regex only matches
    // funnel_view|funnel_run|result_shown|cta_click|funnel_click — so the
    // colour was minting keys nobody ever looked at.
    expect(placed).toContain(`evt:2026-09-16:page:result_card_placed:${page}`);
    expect(placed).not.toContain(`evt:2026-09-16:page:result_card_placed:${page}:sev-red`);
    // No benefit, no suffix: older click keys keep their shape.
    expect(eventKeys('2026-09-16', { event: 'cta_click', tool: 'ad-blocker-test', target: 'email' })).toContain('evt:2026-09-16:cta_click:ad-blocker-test:-:email');
  });
  it('day buckets are UTC dates and the TTL is about a month', () => {
    expect(dayOf(new Date('2026-09-08T23:59:59Z'))).toBe('2026-09-08');
    // Was 400 days, cut to 35 on 2026-09-18: a year of every counter bucket
    // at once against a 256 MB allkeys-lru Redis meant a burst of new keys
    // would evict real ones. scripts/funnels/stats.ts looks back 14 days by
    // default, so nothing reads past this.
    expect(EVENT_TTL_SECONDS).toBe(35 * 86400);
    expect(EVENT_TTL_SECONDS).toBeGreaterThan(14 * 86400);
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

describe('GATE_IDS matches GATE_COPY', () => {
  it('every gate a component can show is an allowed counter key, and no other', async () => {
    const { GATE_IDS } = await import('../lib/event-schema');
    const { GATE_COPY } = await import('../lib/card-copy');
    const declared = new Set(Object.keys(GATE_COPY));
    expect(declared.size).toBeGreaterThan(0);
    for (const id of declared) expect(GATE_IDS.has(id), id).toBe(true);
    for (const id of GATE_IDS) expect(declared.has(id), id).toBe(true);
  });
});
