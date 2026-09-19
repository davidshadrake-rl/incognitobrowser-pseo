/**
 * Single-use proof-of-work must not be skipped when Redis is unhealthy — and
 * the three routes that deliberately fail OPEN must stay that way.
 *
 * This is the check for the worst thing anyone found on 2026-09-18, and it is
 * worth stating exactly, because the first fix missed it. getRedisClient() does
 * not throw when Redis is sick: it RETURNS NULL, for CLIENT_RETRY_DELAY_MS
 * (10 seconds) after any error. app/scan-url/route.ts guarded the single-use
 * claim with `if (redis && solution)`, so a null client skipped the claim
 * entirely — no error, no 503, scan served. One induced Redis blip therefore
 * bought a window in which a single solved token could be replayed without
 * limit. The try/catch that was added only ever covered the rarer path, where
 * a live client's command throws.
 *
 * It is worse than a ten-second window, too. rateLimit() runs earlier in the
 * SAME request and uses the same client, so its own Redis error stamps
 * _clientFailedAt before the route ever reaches line 118 — the first request
 * after any hiccup already skips the claim.
 *
 * tests/hardening.test.ts:53 greps route.ts for the literal string
 * 'replay-store-unavailable' and passes whether or not the branch that emits
 * it can be reached. So this check does the opposite: REDIS_URL points at a
 * closed loopback port, the REAL ioredis fails the way it fails on the droplet
 * when redis-server is stopped, and the check asks what the route returned.
 *
 * WHY THE REAL ioredis AND NOT A FAKE. The property under test is the
 * interaction between lib/rate-limit.ts's client backoff and the route's
 * guard, and that turns on the real client's error TIMING — when the 'error'
 * event fires relative to the route's own getRedisClient() call. A fake that
 * "returns an error" would be grading the fake's idea of failure. A closed
 * loopback port costs nothing, reaches no network, and is exactly the
 * production failure.
 *
 * The second half pins the OTHER three routes, from
 * scripts/security/data/api-redis-posture.json. Four routes answer the same
 * outage four different ways on purpose, that is recorded nowhere in tests/,
 * and "harmonise the Redis error handling" is a plausible, well-meaning
 * refactor whose harmonised answer would be /event's fail-open.
 *
 * This lives in its own file, and its scenarios run under their own module
 * generation, because poisoning lib/rate-limit.ts's _client/_clientFailedAt
 * singletons leaks into anything that shares the module instance — the /stats
 * table would intermittently see storage:'none' for no visible reason.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

export default check({
  id: 'api-replay-fail-closed',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A solved proof-of-work buys exactly one scan even when the replay store is unreachable.',
  async run(ctx) {
    const o = await observe();
    const posture = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/api-redis-posture.json'), 'utf-8'));
    const findings = [];
    let checked = 0;

    const rows = o.redis.rows;
    const control = rows.find((r) => r.route === 'scan-url-control');
    // The control proves the harness can still drive a scan to its ordinary
    // refusal. Without it, a wall of 503s could just as easily mean the probe
    // broke the route, and reporting that as "fails closed, all good" is the
    // exact silent-green this suite exists to prevent.
    if (!control || control.status !== 400) {
      throw new Skip(
        `the control request (REDIS_URL unset) returned ${control ? control.status : 'nothing'} instead of the ordinary 400; the Redis-down rows cannot be distinguished from a broken harness`,
      );
    }
    checked += 1;

    // --- /scan-url: the replay rows ----------------------------------------
    const replays = rows.filter((r) => r.route === 'scan-url');
    for (const r of replays) {
      checked += 1;
      if (r.status === 503 && r.reason === 'replay-store-unavailable') continue;
      if (r.status === 429) continue; // the limiter got there first; not a replay verdict
      findings.push(finding({
        severity: 'high',
        title: 'The single-use proof-of-work claim is skipped when the replay store is unreachable',
        detail:
          'With REDIS_URL set and Redis refusing connections, getRedisClient() returns null and getRedisStatus() reports "backoff" — Redis is expected and broken, not absent. The route must refuse. Instead it carried on past the claim, which means a solved token is replayable for its whole remaining life by anyone who can make Redis stop answering. That is an attacker-removable security control.',
        evidence: `REDIS_URL=redis://127.0.0.1:${o.redis.closedPort} (closed) · ${r.label} => ${r.status} reason=${JSON.stringify(r.reason)} error=${JSON.stringify(r.error)} · getRedisStatus()=${r.redisStatus}`,
        remediation: 'Keep the `solution && !redis && getRedisStatus() === "backoff"` guard in app/scan-url/route.ts:119 returning 503 replay-store-unavailable. "disabled" (REDIS_URL unset) may still fall through — that is documented local-dev degradation.',
        file: 'app/scan-url/route.ts',
        line: 119,
      }));
    }
    if (!replays.length) {
      throw new Skip('the harness produced no /scan-url rows under a dead Redis; nothing was graded');
    }

    // --- the other three routes' deliberately different postures ------------
    for (const want of posture.rows) {
      if (want.route === 'scan-url') continue; // graded above, with its own evidence
      const got = rows.find((r) => r.route === want.route);
      if (!got) {
        throw new Skip(`the harness produced no row for ${want.route}; its documented Redis posture was not graded`);
      }
      checked += 1;
      const problems = [];
      if (got.status !== want.expectStatus) problems.push(`status ${got.status}, expected ${want.expectStatus}`);
      if (want.expectStorage !== undefined && got.body && got.body.storage !== want.expectStorage) {
        problems.push(`storage ${JSON.stringify(got.body.storage)}, expected ${JSON.stringify(want.expectStorage)}`);
      }
      if (want.expectBody) {
        for (const [k, v] of Object.entries(want.expectBody)) {
          if (!got.body || got.body[k] !== v) problems.push(`body.${k} = ${JSON.stringify(got.body && got.body[k])}, expected ${JSON.stringify(v)}`);
        }
      }
      if (!problems.length) continue;
      findings.push(finding({
        severity: 'medium',
        title: `/${want.route} changed how it answers a Redis outage`,
        detail: `${want.note} The four routes answer this outage four different ways on purpose; a change here is either a deliberate decision that belongs in scripts/security/data/api-redis-posture.json, or a refactor that harmonised away a difference that was load-bearing.`,
        evidence: `REDIS_URL=redis://127.0.0.1:${o.redis.closedPort} (closed) · POST /${want.route} => ${problems.join('; ')} · getRedisStatus()=${got.redisStatus}`,
        remediation: `Restore the documented posture, or update scripts/security/data/api-redis-posture.json with the reason it changed.`,
        file: `app/${want.route}/route.ts`,
        line: null,
      }));
    }

    return { findings, checked };
  },
});
