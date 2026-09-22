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
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MAX_IN_FLIGHT_SCANS, MAX_IN_FLIGHT_PER_BUCKET, BLOCKED_TARGET_HOSTS, FETCH_TIMEOUT_MS } from '../lib/tuning';
import { EVENT_TTL_SECONDS, eventKeys } from '../lib/event-schema';
import { matchesBlockedTarget } from '../lib/net-address';

const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf-8');

/**
 * Source with its comments removed, for guards that assert on code.
 *
 * A guard in this repo has matched its own explanatory comment twice: the
 * comment quoted the code the guard looked for, the code went, the guard
 * stayed green. Quotes and template literals are walked past so that the
 * `https://` in the route's convenience rewrite is not read as a line
 * comment. Regex literals are not handled; app/scan-url/route.ts has none
 * containing a slash pair or a quote, and if one ever mis-stripped code the
 * positive assertions below go red, which is the safe direction.
 */
function stripComments(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; ) {
    const c = source[i];
    const next = source[i + 1];
    if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < source.length && source[i] !== c) {
        if (source[i] === '\\') out += source[i++];
        out += source[i++] ?? '';
      }
      out += source[i] ?? '';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

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

  it('rejects a foreign scheme BEFORE the convenience rewrite', () => {
    // The rewrite lets a visitor type "example.com". Applied to a string that
    // already has a scheme it produced a single-label hostname that sailed past
    // the protocol allowlist, because the protocol really was https::
    //   file:///etc/passwd -> https://file:///etc/passwd -> hostname "file"
    // A single label reaches the resolver, and on a host with a DNS search
    // suffix "file" can resolve to file.<search-domain> — an internal machine.
    // Found by auditing the owner's own S6 item, which this contradicted.
    expect(route).toContain('const scheme =');
    expect(route).toContain('Only HTTP/HTTPS URLs are supported');
    // The rejection must sit BEFORE the rewrite, or it decides nothing.
    const rejectAt = route.indexOf('!/^https?$/i.test(scheme[1])');
    const rewriteAt = route.indexOf('new URL(scheme ?');
    expect(rejectAt, 'the scheme rejection is gone').toBeGreaterThan(-1);
    expect(rewriteAt, 'the rewrite is gone').toBeGreaterThan(-1);
    expect(rejectAt).toBeLessThan(rewriteAt);
    // And the old shape must not come back.
    expect(route).not.toContain("url.startsWith('http') ? url :");
  });

  it('caps how many slots ONE network can hold, not just the total', () => {
    // Measured 2026-09-21: a scan takes ~790ms typically but can stall for the
    // whole FETCH_TIMEOUT_MS against a server the caller controls. Holding all
    // 20 global slots therefore needs only ~4 new scans/sec — about 12% of one
    // core in proof-of-work — and while they are held everyone else drops to
    // ~4 scans/sec. The per-IP rate limit was the only thing in the way, and
    // ~24 distinct /24 ranges beat it.
    expect(route).toContain('inFlightByBucket');
    expect(route).toMatch(/if \(bucketInFlight >= MAX_IN_FLIGHT_PER_BUCKET\)/);
    // Released, and the key DELETED at zero — a Map keyed on caller-supplied
    // network is otherwise a slow leak whose size the caller chooses.
    expect(route).toContain('inFlightByBucket.delete(bucket)');
    expect(MAX_IN_FLIGHT_PER_BUCKET).toBeGreaterThan(0);
    expect(MAX_IN_FLIGHT_PER_BUCKET).toBeLessThan(MAX_IN_FLIGHT_SCANS);
  });

  it('refuses to scan the host it runs on', () => {
    // The knob still defaults to this droplet, and the compiled form of it —
    // the thing the route actually consults — refuses that address and not
    // the one beside it. The second half is what stops a "block everything"
    // compile error from passing as "blocks the droplet".
    expect(BLOCKED_TARGET_HOSTS.size).toBeGreaterThan(0);
    expect(BLOCKED_TARGET_HOSTS.has('206.189.186.34')).toBe(true);
    expect(matchesBlockedTarget('206.189.186.34')).toBe(true);
    expect(matchesBlockedTarget('206.189.186.35')).toBe(false);

    // Both legs of the route go through matchesBlockedTarget, which is the
    // only reader that understands a range. Until 2026-09-22 they did
    // `BLOCKED_TARGET_HOSTS.has(...)` — exact string match — so a corporate
    // estate on public address space could be refused one host at a time or
    // not at all. Asserted on comment-stripped source, and the stripper is
    // checked first: a comment sentence must be gone and the rewrite's
    // template literal, which contains `//`, must have survived.
    const code = stripComments(route);
    expect(route).toContain('A name with no dot is not a public website.');
    expect(code).not.toContain('A name with no dot is not a public website.');
    expect(code).toContain('`https://${url.trim()}`');
    // The text leg, before the resolver is asked...
    expect(code).toContain('matchesBlockedTarget(hostKey)');
    // ...and every resolved address too, or a DNS name pointing back at us
    // (or into the range) walks past the text check.
    expect(code).toMatch(/matchesBlockedTarget\(r\.address\)/);
    // A revert to the Set lookup would compile and pass every literal-only
    // test while silently un-knowing ranges.
    expect(code).not.toContain('BLOCKED_TARGET_HOSTS.has(');
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

  it('caps the body as it streams, rather than checking a header and then buffering', () => {
    // This test used to assert the ordering "read Content-Length, THEN call
    // request.text()", and passed for as long as that pattern existed. The
    // pattern was the bug: a chunked request sends no Content-Length, so the
    // pre-check was skipped rather than triggered, and request.text() behind
    // it is unbounded. 300MB went resident on a 448MB heap from one
    // unauthenticated POST to this route. The ordering was never the control.
    const route = src('app/event/route.ts');
    expect(route).toContain('readCappedRequestText');
    expect(route).not.toMatch(/await request\.text\(\)/);
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

describe('tuning: a bad env value falls back instead of breaking a control', () => {
  /**
   * lib/tuning.ts reads every knob at module load, so each case needs a fresh
   * module graph. The old validation was `Number.isNaN(parsed) || parsed < 0`,
   * which let through 0 and anything past Number.MAX_SAFE_INTEGER. Both are
   * how a one-character typo in /etc/ib-api.env turns a control off — or, for
   * POW_MAX_NUMBER, hangs the single thread that serves the whole API.
   */
  async function withEnv<T>(vars: Record<string, string>, read: (m: typeof import('../lib/tuning')) => T): Promise<T> {
    const previous = Object.entries(vars).map(([k, _v]) => [k, process.env[k]] as const);
    Object.assign(process.env, vars);
    vi.resetModules();
    try {
      return read(await import('../lib/tuning'));
    } finally {
      for (const [k, v] of previous) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      vi.resetModules();
    }
  }

  it('a malformed BLOCKED_TARGET_HOSTS entry is reported out loud, and the rest of the list still holds', async () => {
    // The compile lives in lib/net-address.ts, which is held to zero console
    // references (tests/audit-6-company.test.ts) — so the warning goes through
    // lib/tuning's reportConfigProblem. This checks the whole path: a bad
    // entry is named at load, the good entry beside it is still refused, and
    // the bad one is not quietly reinterpreted as a hostname that matches
    // nothing while looking configured.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const previous = process.env.BLOCKED_TARGET_HOSTS;
    process.env.BLOCKED_TARGET_HOSTS = '20.30.40.0/33,206.189.186.34';
    vi.resetModules();
    try {
      const m = await import('../lib/net-address');
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toMatch(/BLOCKED_TARGET_HOSTS entry "20\.30\.40\.0\/33" ignored/);
      expect(m.matchesBlockedTarget('206.189.186.34')).toBe(true);
      expect(m.matchesBlockedTarget('20.30.40.7')).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.BLOCKED_TARGET_HOSTS;
      else process.env.BLOCKED_TARGET_HOSTS = previous;
      warn.mockRestore();
      vi.resetModules();
    }
  });

  it('POW_MAX_NUMBER=0 does not reach createChallenge', async () => {
    // `Math.floor(0x100000000 / 0) * 0` is NaN, so the rejection-sampling loop
    // in lib/altcha.ts never exits. /challenge stops answering, and because
    // Node is single-threaded, so does everything else.
    const v = await withEnv({ POW_MAX_NUMBER: '0' }, (m) => m.POW_MAX_NUMBER);
    expect(v).toBe(100_000);
  });

  it('POW_MAX_NUMBER beyond the safe integer range does not either', async () => {
    // parseInt('99999999999999999999') is 1e20: not NaN, not negative, and it
    // made the same bound exactly 0 — the identical hang by another door.
    const v = await withEnv({ POW_MAX_NUMBER: '99999999999999999999' }, (m) => m.POW_MAX_NUMBER);
    expect(v).toBe(100_000);
  });

  it('POW_MAX_NUMBER above what verifySolution accepts is refused', async () => {
    const v = await withEnv({ POW_MAX_NUMBER: '50000000' }, (m) => m.POW_MAX_NUMBER);
    expect(v).toBe(100_000);
  });

  it('a rate-limit window of 0 is refused, because it fails OPEN', async () => {
    // The Redis limiter keys on floor(now / windowMs). With windowMs=0 every
    // request lands in its own window, so the counter never passes 1 and the
    // limit is never reached — while the response headers still claim a limit.
    expect(await withEnv({ SCAN_RATE_WINDOW_MS: '0' }, (m) => m.SCAN_RATE_WINDOW_MS)).toBe(60_000);
    expect(await withEnv({ CHALLENGE_RATE_WINDOW_MS: '0' }, (m) => m.CHALLENGE_RATE_WINDOW_MS)).toBe(60_000);
  });

  it('a fetch timeout of 0 or one long enough to pin a slot is refused', async () => {
    expect(await withEnv({ FETCH_TIMEOUT_MS: '0' }, (m) => m.FETCH_TIMEOUT_MS)).toBe(10_000);
    expect(await withEnv({ FETCH_TIMEOUT_MS: '3600000' }, (m) => m.FETCH_TIMEOUT_MS)).toBe(10_000);
  });

  it('POW_TTL_SECONDS is kept inside the window verifySolution will accept', async () => {
    // Below 1 the token is born expired; above 600 it trips the verifier's own
    // `expires > now + 600` guard. Either way the server signs tokens it will
    // then refuse, and the scanner looks broken for no visible reason.
    expect(await withEnv({ POW_TTL_SECONDS: '0' }, (m) => m.POW_TTL_SECONDS)).toBe(90);
    expect(await withEnv({ POW_TTL_SECONDS: '100000' }, (m) => m.POW_TTL_SECONDS)).toBe(90);
  });

  it('MAX_IN_FLIGHT_SCANS=0 is refused; the rate limits are the kill switch', async () => {
    expect(await withEnv({ MAX_IN_FLIGHT_SCANS: '0' }, (m) => m.MAX_IN_FLIGHT_SCANS)).toBe(20);
  });

  it('zero IS accepted where it means "collect nothing" and fails closed', async () => {
    // These are pure ceilings on how much of a response we keep. Zero is a
    // coherent thing for an operator to ask for during an incident, and it
    // degrades safely — unlike a zero window or a zero search space.
    expect(await withEnv({ MAX_COOKIES: '0' }, (m) => m.MAX_COOKIES)).toBe(0);
    expect(await withEnv({ MAX_SCRIPT_MATCHES: '0' }, (m) => m.MAX_SCRIPT_MATCHES)).toBe(0);
    expect(await withEnv({ MAX_THIRD_PARTY_DOMAINS: '0' }, (m) => m.MAX_THIRD_PARTY_DOMAINS)).toBe(0);
    expect(await withEnv({ MAX_URL_LENGTH: '0' }, (m) => m.MAX_URL_LENGTH)).toBe(0);
    expect(await withEnv({ SCAN_RATE_LIMIT: '0' }, (m) => m.SCAN_RATE_LIMIT)).toBe(0);
    expect(await withEnv({ CHALLENGE_RATE_LIMIT: '0' }, (m) => m.CHALLENGE_RATE_LIMIT)).toBe(0);
  });

  it('the panic-mode settings in the file header are all still accepted', async () => {
    // lib/tuning.ts opens with a copy-paste block for "under attack". A guard
    // that refuses the documented incident response is worse than no guard.
    const panic = await withEnv(
      {
        SCAN_RATE_LIMIT: '2',
        CHALLENGE_RATE_LIMIT: '5',
        POW_MAX_NUMBER: '1000000',
        MAX_BODY_SIZE_MB: '1',
      },
      (m) => ({
        scan: m.SCAN_RATE_LIMIT,
        challenge: m.CHALLENGE_RATE_LIMIT,
        pow: m.POW_MAX_NUMBER,
        body: m.MAX_BODY_SIZE,
      }),
    );
    expect(panic).toEqual({ scan: 2, challenge: 5, pow: 1_000_000, body: 1024 * 1024 });
  });

  it('garbage falls back rather than parsing to a partial number', async () => {
    expect(await withEnv({ SCAN_RATE_LIMIT: '-1' }, (m) => m.SCAN_RATE_LIMIT)).toBe(10);
    expect(await withEnv({ SCAN_RATE_LIMIT: 'lots' }, (m) => m.SCAN_RATE_LIMIT)).toBe(10);
  });
});
