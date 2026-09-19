/**
 * Can anyone, from outside, find out whether the API's controls are ON?
 *
 * Today: no. One environment variable, REDIS_URL, silently switches off three
 * controls at once and changes no response code:
 *   - proof-of-work single-use (app/scan-url/route.ts takes the null-client
 *     branch and serves the scan),
 *   - the shared rate limiter (lib/rate-limit.ts drops to a per-process Map,
 *     so every worker gets its own full allowance),
 *   - /event counting (every increment is discarded).
 * All three fail open, quietly, with 200s throughout.
 *
 * lib/rate-limit.ts exports getRedisDiagnostic() for precisely this question
 * and it has never been called — a grep across app/ lib/ tests/ scripts/ and
 * e2e/ returns only its own definition. This check asserts that wiring exists,
 * and then asks the live box.
 *
 * Why /stats and not a new /health: /stats already has the STATS_TOKEN bearer
 * check with a timing-safe compare and its own 10/min limiter, so reporting
 * runtime state there adds no unauthenticated surface. An open /health would
 * be an eighth route telling anyone who asks when the controls are weakest.
 *
 * The live probe is ONE authenticated POST. It costs a Redis SCAN of one day's
 * counter keys, which the owner already runs by hand.
 *
 * Deliberately NOT flagged: `storage: 'none'` on a LOCAL run against a dev
 * server would be normal, so this check only ever probes ctx.apiBase, which is
 * the deployed instance.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

/** Call sites only: the definition itself and its own return statement don't count. */
function countCallSites(source, fnName) {
  let n = 0;
  const re = new RegExp(`\\b${fnName}\\s*\\(`, 'g');
  for (const line of source.split('\n')) {
    if (new RegExp(`(export\\s+)?function\\s+${fnName}\\b`).test(line)) continue;
    const m = line.match(re);
    if (m) n += m.length;
  }
  return n;
}

export default check({
  id: 'rasp-stats-runtime-telemetry',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Runtime health of the Redis-backed controls is reachable and healthy — the diagnostic is wired up, and the live instance says Redis is really there.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    // ---- half one: is the diagnostic wired to anything at all? ------------
    const rlPath = join(ctx.repoRoot, 'lib/rate-limit.ts');
    const statsPath = join(ctx.repoRoot, 'app/stats/route.ts');
    if (!existsSync(rlPath) || !existsSync(statsPath)) {
      throw new ctx.Skip(`expected lib/rate-limit.ts and app/stats/route.ts; missing ${existsSync(rlPath) ? statsPath : rlPath}`);
    }
    const rl = readFileSync(rlPath, 'utf-8');
    const stats = readFileSync(statsPath, 'utf-8');

    checked++;
    const rlCalls = countCallSites(rl, 'getRedisDiagnostic');
    const statsUsesIt = /getRedisDiagnostic/.test(stats);
    if (!statsUsesIt && rlCalls === 0) {
      const defLine = rl.split('\n').findIndex((l) => /export function getRedisDiagnostic/.test(l)) + 1;
      findings.push(finding({
        severity: 'high',
        title: 'getRedisDiagnostic() is exported and never called — the API cannot report whether its own controls are on',
        detail: 'REDIS_URL going missing or wrong in /etc/ib-api.env disables proof-of-work single-use, the shared rate limiter and /event counting, all three at once, with every response still 200. The function written to surface that is dead code, so nothing inside or outside the process can see it happen.',
        evidence: `lib/rate-limit.ts:${defLine} defines getRedisDiagnostic(); grep across app/ lib/ finds 0 call sites, and app/stats/route.ts does not mention it.`,
        remediation: 'Add a `runtime` block to the POST handler in app/stats/route.ts: { ...getRedisDiagnostic(), inFlightScans, uptimeSec: process.uptime(), pid }. Keep lastError behind STATS_TOKEN — it can carry a connection string.',
        file: 'lib/rate-limit.ts',
        line: defLine || null,
      }));
    }

    // The contradiction the same fix should close: the interface promises a
    // response header naming the backend, and the code deletes the value.
    checked++;
    const voidLine = rl.split('\n').findIndex((l) => /^\s*void backend;/.test(l)) + 1;
    if (voidLine && /Surfaced as a/.test(rl)) {
      findings.push(finding({
        severity: 'low',
        title: 'The rate limiter computes which backend served a request, then throws it away',
        detail: 'RateLimitResult documents `backend` as being surfaced to callers, but buildHeaders discards it. A silent fall from Redis to a per-process Map is therefore invisible in the response as well as in the logs — the two places anyone would look.',
        evidence: `lib/rate-limit.ts:${voidLine} is \`void backend;\`, while the docstring above RateLimitResult.backend says it is surfaced. Both are in the same file.`,
        remediation: 'Either emit the header (X-RateLimit-Backend) or correct the docstring. Emitting it is more useful: it makes the fallback observable from any response.',
        file: 'lib/rate-limit.ts',
        line: voidLine,
      }));
    }

    // ---- half two: ask the live instance ----------------------------------
    // No token means the runtime question cannot be asked at all. If the source
    // half already found something we report that rather than swallowing it;
    // if it did not, there is genuinely nothing to report and this is a SKIP,
    // never a pass.
    if (!ctx.statsToken) {
      if (!findings.length) {
        throw new ctx.Skip('no STATS_TOKEN (pass --stats-token, set STATS_TOKEN in the environment, or add it to .secrets) — the live runtime probe cannot run');
      }
      findings.push(finding({
        severity: 'info',
        title: 'The live half of this check did not run: no STATS_TOKEN',
        detail: 'The source findings above stand, but the deployed instance was not asked whether Redis is currently configured for it.',
        evidence: `ctx.statsToken is null; target would have been POST ${ctx.apiBase}/stats`,
        remediation: 'Add STATS_TOKEN to .secrets (the same value as in /etc/ib-api.env) or export it before the run.',
      }));
      return { findings, checked };
    }

    const url = `${ctx.apiBase}/stats`;
    const res = await ctx.http(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${ctx.statsToken}`,
        origin: ctx.origin,
      },
      body: '{}',
      timeoutMs: 20_000,
    });
    checked++;

    if (!res.ok) {
      throw new ctx.Skip(`POST ${url} did not complete: ${res.error}`);
    }

    // 404 is the route saying "STATS_TOKEN is unset on the box", which is a
    // different fact from a wrong token (401) and from a healthy answer (200).
    // Telling them apart is the point; a check that reads 404 as "fine" would
    // be the same silence this suite exists to end.
    if (res.status === 404) {
      findings.push(finding({
        severity: 'medium',
        title: '/api/stats answers 404 — STATS_TOKEN is not set on the live box',
        detail: 'The only authenticated window into this service’s runtime state does not exist in production. Nothing can be asked about Redis, in-flight scans or uptime without shipping a new route.',
        evidence: `POST ${url} (Bearer, ${res.text.length} byte body) → 404`,
        remediation: 'Set STATS_TOKEN in /etc/ib-api.env to a long random value, restart ib-api, and put the same value in .secrets.',
      }));
      return { findings, checked };
    }
    if (res.status === 401) {
      findings.push(finding({
        severity: 'medium',
        title: 'The STATS_TOKEN we hold is not the one the live box accepts',
        detail: 'Either the token on the droplet was rotated without updating .secrets, or the value here is stale. Until they match, nobody is reading this service’s runtime state.',
        evidence: `POST ${url} with our bearer token → 401 ${JSON.stringify(res.json || res.text.slice(0, 80))}`,
        remediation: 'Compare with STATS_TOKEN in /etc/ib-api.env on the droplet.',
      }));
      return { findings, checked };
    }
    if (res.status === 429) {
      throw new ctx.Skip(`POST ${url} → 429: the /stats limiter (10/min per bucket) is holding this run off; nothing was observed`);
    }
    if (res.status !== 200) {
      findings.push(finding({
        severity: 'medium',
        title: `/api/stats answered ${res.status}`,
        detail: 'An unexpected status from the one route that reports runtime state. Whatever it means, the state was not read.',
        evidence: `POST ${url} → ${res.status} ${res.text.slice(0, 200)}`,
        remediation: 'journalctl -u ib-api -n 50 --no-pager.',
      }));
      return { findings, checked };
    }

    const body = res.json || {};

    // The signal that exists TODAY, with no code change: storage:'none' means
    // getRedisClient() returned null for this very request — REDIS_URL absent,
    // or the client inside its 10s post-error backoff. Either way the three
    // Redis-backed controls are off right now.
    checked++;
    if (body.storage === 'none') {
      findings.push(finding({
        severity: 'high',
        title: 'The live API has no usable Redis: single-use proof-of-work, the shared rate limit and /event counting are all off',
        detail: 'app/stats/route.ts reports storage:"none" only when getRedisClient() returns null. In that state a solved proof-of-work token can be replayed for its whole 90s life, the per-IP limit is per-process, and every event increment is discarded — with every response still 200.',
        evidence: `POST ${url} → 200 ${JSON.stringify(body).slice(0, 200)}`,
        remediation: 'Check REDIS_URL in /etc/ib-api.env and `systemctl status redis-server` on the droplet, then restart ib-api.',
      }));
    } else if (body.storage !== 'redis') {
      findings.push(finding({
        severity: 'medium',
        title: `/api/stats reported an unrecognised storage value: ${JSON.stringify(body.storage)}`,
        detail: 'This check grades the storage field; a value it does not know about means it cannot tell whether Redis is backing the controls.',
        evidence: `POST ${url} → 200 ${JSON.stringify(body).slice(0, 200)}`,
        remediation: 'Update this check alongside whatever changed in app/stats/route.ts.',
      }));
    }

    // Once the runtime block exists, grade it. Until then, say plainly that the
    // richer answer is unavailable rather than implying it passed.
    const runtime = body.runtime;
    if (runtime && typeof runtime === 'object') {
      checked++;
      if (runtime.redisUrlSet === false) {
        findings.push(finding({
          severity: 'high',
          title: 'REDIS_URL is not set in the live API’s environment',
          detail: 'Not a blip: the variable is simply absent from /etc/ib-api.env, so the three Redis-backed controls have been off since the last restart.',
          evidence: `POST ${url} → 200 runtime.redisUrlSet=false, status=${JSON.stringify(runtime.status)}`,
          remediation: 'Add REDIS_URL=redis://127.0.0.1:6379 to /etc/ib-api.env and restart ib-api.',
        }));
      } else if (runtime.hasClient === false || runtime.status === 'backoff') {
        findings.push(finding({
          severity: 'high',
          title: `Redis is configured but not usable right now (status=${JSON.stringify(runtime.status)})`,
          detail: 'This is the state the fail-closed replay path was written for. While it lasts, /scan-url answers 503 rather than serving replayable scans — correct, but it means the tool is down.',
          evidence: `POST ${url} → 200 runtime.hasClient=${runtime.hasClient} status=${JSON.stringify(runtime.status)} lastError=${JSON.stringify(String(runtime.lastError || '').slice(0, 120))}`,
          remediation: 'systemctl status redis-server; redis-cli ping.',
        }));
      } else if (runtime.lastError) {
        findings.push(finding({
          severity: 'medium',
          title: 'The Redis client has recorded an error since the process started',
          detail: 'It recovered — but each error opens a 10-second window in which getRedisClient() returns null, and that window is where the single-use control used to fail open.',
          evidence: `POST ${url} → 200 runtime.lastError=${JSON.stringify(String(runtime.lastError).slice(0, 160))}`,
          remediation: 'Look for the cause in the Redis log; recurring errors mean recurring windows.',
        }));
      }
    } else {
      findings.push(finding({
        severity: 'info',
        title: '/api/stats carries no `runtime` block yet',
        detail: 'Only the coarse storage field could be graded. In-flight scans, uptime, the Redis status and the last client error are still unobservable.',
        evidence: `POST ${url} → 200, keys: ${Object.keys(body).join(', ') || '(none)'}`,
        remediation: 'See the remediation on the getRedisDiagnostic finding above.',
      }));
    }

    return { findings, checked };
  },
});
