/**
 * Guards for the abuse-resistance controls added on 2026-09-18.
 *
 * These are the controls that answer "the backend is open, what stops it being
 * hammered?". Each one is cheap to delete by accident during a refactor and
 * silent when it is gone — nothing fails, the service just becomes easy to
 * exhaust again. Several are source guards rather than behavioural tests
 * because the routes need a running Next server to exercise; a source guard
 * still fails loudly if the control is removed, which is the point.
 *
 * The server-side half of the same work — systemd memory and CPU ceilings,
 * ufw, the Apache body cap and the log rotation — lives in API-ON-DROPLET.md
 * and cannot be asserted from here.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_IN_FLIGHT_SCANS, BLOCKED_TARGET_HOSTS, FETCH_TIMEOUT_MS } from '../lib/tuning';
import { EVENT_TTL_SECONDS, eventKeys } from '../lib/event-schema';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf-8');

describe('scan-url: a flood cannot outgrow the box', () => {
  const route = src('app/scan-url/route.ts');

  it('caps scans in flight across all callers, not just per IP', () => {
    // The per-IP limiter bounds one visitor. It does nothing about a thousand
    // visitors or a botnet with a thousand addresses, which is the shape the
    // abuse actually takes.
    expect(route).toContain('inFlightScans');
    expect(route).toMatch(/if \(inFlightScans >= MAX_IN_FLIGHT_SCANS\)/);
    expect(route).toContain('inFlightScans++');
    // Released on every path, including the error ones.
    expect(route).toMatch(/finally \{\s*inFlightScans--;/);
    expect(MAX_IN_FLIGHT_SCANS).toBeGreaterThan(0);
    expect(MAX_IN_FLIGHT_SCANS).toBeLessThanOrEqual(50);
  });

  it('holds the timeout open across the body read, not just the headers', () => {
    // A target that answers instantly and then dribbles bytes forever held a
    // scan slot, a socket and an Apache worker indefinitely: the byte cap
    // never fired because the bytes never arrived. clearTimeout must therefore
    // sit in a finally AFTER readCappedText, never between fetch and the read.
    const fetchAt = route.indexOf('await fetch(targetUrl');
    const readAt = route.indexOf('await readCappedText(');
    const clearAt = route.lastIndexOf('clearTimeout(timeout)');
    expect(fetchAt).toBeGreaterThan(-1);
    expect(readAt).toBeGreaterThan(fetchAt);
    expect(clearAt).toBeGreaterThan(readAt);
    expect(route).toMatch(/finally \{\s*clearTimeout\(timeout\);/);
  });

  it('fails closed when the replay store cannot be reached', () => {
    // Swallowing the Redis error made single-use an attacker-removable
    // control: knock Redis over and one solved proof-of-work buys unlimited
    // scans for its whole 90s life.
    expect(route).toContain('replay-store-unavailable');
    expect(route).toMatch(/status: 503/);
    expect(route).not.toMatch(/fall through to the TTL bound rather than fail the scan/);
  });

  it('refuses to scan the host it runs on', () => {
    expect(BLOCKED_TARGET_HOSTS.size).toBeGreaterThan(0);
    expect(BLOCKED_TARGET_HOSTS.has('206.189.186.34')).toBe(true);
    expect(route).toContain('BLOCKED_TARGET_HOSTS.has(hostKey)');
    // ...and on the resolved addresses too, or a DNS name pointing back at us
    // walks past the string check.
    expect(route).toMatch(/BLOCKED_TARGET_HOSTS\.has\(r\.address/);
  });

  it('reports the real timeout rather than a hard-coded one', () => {
    // The message used to say "(10s)" in text while the budget was an env var.
    expect(route).not.toContain('timed out (10s)');
    expect(route).toContain('${seconds}s');
    expect(FETCH_TIMEOUT_MS).toBeGreaterThan(0);
  });
});

describe('event: the counter keyspace is bounded', () => {
  it('keeps a month of counters, not over a year', () => {
    expect(EVENT_TTL_SECONDS).toBe(35 * 86400);
  });

  it('does not mint a key per page per severity per target', () => {
    // ~1,400 funnel pages x 10 events x 5 severities x 9 targets was ~630,000
    // keys a day against a 256 MB Redis.
    const page = eventKeys('2026-09-18', {
      event: 'cta_click', tool: 'cookie-analyzer', severity: 'red',
      target: 'play', platform: 'android', page: '/',
    }).filter((k) => k.includes(':page:'));
    expect(page).toHaveLength(1);
    expect(page[0]).not.toMatch(/sev-|:play$/);
  });

  it('checks the declared body size before buffering it', () => {
    const route = src('app/event/route.ts');
    const declaredAt = route.indexOf("request.headers.get('content-length')");
    const readAt = route.indexOf('await request.text()');
    expect(declaredAt).toBeGreaterThan(-1);
    expect(declaredAt).toBeLessThan(readAt);
    // The post-read check stays: Content-Length can lie.
    expect(route).toMatch(/text\.length > MAX_BODY/);
  });
});

describe('stats: one call cannot collect an unbounded keyspace', () => {
  const route = src('app/stats/route.ts');

  it('stops at a ceiling and says so', () => {
    expect(route).toContain('MAX_KEYS');
    expect(route).toContain('truncated');
    // Silent truncation would read as "that was the whole day".
    expect(route).toMatch(/truncated: true/);
  });
});
