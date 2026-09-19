/**
 * Does an accepted scan actually claim its proof-of-work token, and what
 * happens when the store that holds the claim is sick?
 *
 * This is the check that would have caught the 2026-09-18 fail-open. The
 * single-use claim lives behind `if (redis && solution)` in
 * app/scan-url/route.ts, and lib/rate-limit.ts's getClient() does not throw
 * when Redis is unhealthy — it RETURNS NULL for ten seconds after any error
 * event. So the likeliest failure, a blip on a 2 vCPU box shared with MySQL,
 * skipped the claim entirely: no error, no 503, scan served, one solved token
 * replayable for its whole 90s life at zero CPU cost. tests/hardening.test.ts
 * had a test named "fails closed when the replay store cannot be reached"
 * which passed by grepping the source for the string 'replay-store-unavailable'.
 * The string was there. The behaviour was not.
 *
 * So this check does not read source and does not read a status code over the
 * network. It runs the real route against a fake ioredis with real SET NX
 * semantics, makes that client sick the way a loaded box makes the real one
 * sick — an 'error' event, and a throwing command — and reads what the route
 * did: which key it claimed, whether a socket was opened, and whether the
 * refusal came from the null-client branch or from the throw branch.
 *
 * It also pins the compensating control that bounds the damage when the store
 * is gone: the rate limiter must degrade to in-memory counting, not to no
 * counting. tests/rate-limit.test.ts only ever runs with REDIS_URL unset, so
 * the transition itself has never been exercised.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './iast-probe.mjs';

const ROUTE = 'app/scan-url/route.ts';
const LIMITER = 'lib/rate-limit.ts';

export default check({
  id: 'iast-pow-replay-claim-observed',
  discipline: 'iast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Runs /scan-url against an instrumented Redis and asserts the single-use claim is written, replays are refused, and a sick store fails closed.',
  async run() {
    const obs = await observe();
    const r = obs.redis || {};
    const scenarios = ['healthy', 'replay', 'storeThrows', 'backoff', 'degradedRateLimit'].filter((k) => r[k]);
    if (scenarios.length < 5) {
      throw new Skip(`the probe produced only ${scenarios.length}/5 store scenarios (${scenarios.join(', ') || 'none'})`);
    }

    const findings = [];

    // 1. The claim is written at all, and written before the socket opens.
    const h = r.healthy;
    if (!h.setCalls.length) {
      findings.push(finding({
        severity: 'high',
        title: 'An accepted scan claimed no proof-of-work token',
        detail: 'Single use is the only thing stopping one solved puzzle from buying every scan the rate limiter allows. With a healthy store present and a valid solution, no claim was written.',
        evidence: `healthy store, valid PoW, public target → HTTP ${h.status}, Redis commands: none of shape set(pow:…)`,
        remediation: `Restore the SET NX claim in ${ROUTE}.`,
        file: ROUTE,
      }));
    } else {
      const call = h.setCalls[0];
      const shapeOk = String(call[0]).startsWith('pow:') && call[1] === '1' && call.includes('EX') && call.includes('NX');
      if (!shapeOk || !h.claimedKeyMatchesSignature) {
        findings.push(finding({
          severity: 'high',
          title: 'The single-use claim is not keyed to the token it is meant to burn',
          detail: 'The claim must be SET NX on the solution signature with an expiry. A different key, a missing NX or a missing expiry each turn it into something other than single use.',
          evidence: `observed: set(${call.map((x) => JSON.stringify(x)).join(', ')}); keyed to this solution's signature: ${h.claimedKeyMatchesSignature}`,
          file: ROUTE,
        }));
      }
      if (h.fetchCount !== 1) {
        findings.push(finding({
          severity: 'medium',
          title: `A healthy accepted scan made ${h.fetchCount} outbound requests`,
          detail: 'One accepted scan is one fetch. Anything else changes what a single solved token costs us.',
          evidence: `healthy store → HTTP ${h.status}, ${h.fetchCount} fetches recorded`,
          file: ROUTE,
        }));
      }
    }

    // 2. A replayed token buys nothing — observed as "no socket", not as a status.
    const rep = r.replay;
    if (rep.secondStatus !== 401 || rep.secondReason !== 'replayed') {
      findings.push(finding({
        severity: 'high',
        title: 'A solved proof-of-work token was accepted twice',
        detail: 'The second use of the same signature must be refused by the SET NX claim. It was not, so a token is worth as many scans as the rate limiter allows rather than one.',
        evidence: `same Authorization header twice → first HTTP ${rep.firstStatus}, second HTTP ${rep.secondStatus} (reason: ${rep.secondReason})`,
        file: ROUTE,
      }));
    }
    if (rep.fetchesAfterSecond > rep.fetchesAfterFirst) {
      findings.push(finding({
        severity: 'high',
        title: 'A replayed token still opened a socket',
        detail: 'Even if the reply is a 401, the outbound request was already made — the refusal costs the attacker nothing and costs us a scan.',
        evidence: `fetch recorder: ${rep.fetchesAfterFirst} after the first request, ${rep.fetchesAfterSecond} after the replay`,
        file: ROUTE,
      }));
    }

    // 3. A store that throws must fail closed.
    const t = r.storeThrows;
    if (t.status !== 503 || t.reason !== 'replay-store-unavailable' || t.fetchCount !== 0) {
      findings.push(finding({
        severity: 'high',
        title: 'The route did not fail closed when the replay store threw',
        detail: 'If a command error is swallowed, whoever can make Redis stop answering — including by flooding it — has switched single use off.',
        evidence: `set() throws → HTTP ${t.status} (reason: ${t.reason}), ${t.fetchCount} fetches`,
        remediation: `The catch around the SET NX in ${ROUTE} must return 503, not continue.`,
        file: ROUTE,
      }));
    }

    // 4. The one that shipped. A null client, not a throw.
    const b = r.backoff;
    if (b.status !== 503 || b.reason !== 'replay-store-unavailable' || b.fetchesDuringSecond !== 0) {
      findings.push(finding({
        severity: 'high',
        title: 'The replay check fails OPEN while the Redis client is in backoff',
        detail: 'After any ioredis error event, getRedisClient() returns null for ten seconds while REDIS_URL is still set — a configured store that is temporarily unreachable. A guard of the shape `if (redis && solution)` skips the single-use claim entirely in that window: no error, no 503, scan served. One induced blip then buys a solved token unlimited replays for its remaining life. A grep for the string "replay-store-unavailable" reports green throughout.',
        evidence: `ioredis 'error' event → getRedisStatus() "${b.redisStatusAfter}", client null: ${b.redisClientIsNullAfter}; next scan with a valid token → HTTP ${b.status} (reason: ${b.reason}), ${b.fetchesDuringSecond} fetches, ${b.setCallsDuringSecond} claim attempts`,
        remediation: `In ${ROUTE}, refuse with 503 when a solution is present, the client is null and getRedisStatus() is 'backoff'. 'disabled' (REDIS_URL unset) is local dev and may still fall through.`,
        file: ROUTE,
      }));
    } else if (b.redisStatusAfter !== 'backoff' || b.setCallsDuringSecond !== 0) {
      // The right answer for the wrong reason is worth knowing about: it means
      // the scenario stopped reproducing the null-client window, so the guard
      // above is no longer being exercised by anything.
      findings.push(finding({
        severity: 'low',
        title: 'The backoff scenario no longer reproduces a null Redis client',
        detail: 'The route refused correctly, but not through the branch this check exists to pin. Either lib/rate-limit.ts no longer nulls the client after an error event, or the probe stopped inducing it. Either way the fail-open guard is currently untested.',
        evidence: `getRedisStatus() after the induced error: "${b.redisStatusAfter}"; claim attempts during the refused scan: ${b.setCallsDuringSecond} (expected 0)`,
        file: LIMITER,
      }));
    }

    // 5. The compensating control. When Redis dies the limiter is supposed to
    //    fall back to in-memory counting (lib/rate-limit.ts catches, sets
    //    _clientFailedAt and calls rateLimitInMemory). If it instead stopped
    //    counting, the blast radius of every finding above widens from "a
    //    replayable token" to "a replayable token with no rate limit".
    const d = r.degradedRateLimit;
    if (d.denied === 0) {
      findings.push(finding({
        severity: 'high',
        title: 'The rate limiter stops enforcing when Redis fails',
        detail: 'Every Redis command throwing should degrade the limiter to a per-process in-memory counter, not switch it off. As observed it allowed every request, which means the same event that breaks the replay store also removes the per-IP bound.',
        evidence: `${d.calls} consecutive POST /ip from one /24 with every Redis pipeline throwing → ${d.allowed} allowed, ${d.denied} denied (limit is 60/min)`,
        file: LIMITER,
      }));
    } else if (d.firstDeniedAt > 62) {
      findings.push(finding({
        severity: 'low',
        title: `The degraded limiter allowed ${d.firstDeniedAt} requests before refusing`,
        detail: 'The in-memory fallback should hold roughly the same ceiling as the Redis path. A materially higher one means a Redis outage quietly raises every limit.',
        evidence: `${d.calls} requests with Redis throwing → first 429 at request ${d.firstDeniedAt + 1}; /ip is configured at 60 per 60s`,
        file: LIMITER,
      }));
    }

    return { findings, checked: scenarios.length };
  },
});
