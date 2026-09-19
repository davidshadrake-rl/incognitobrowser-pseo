/**
 * Is Redis evicting the keys that make a solved proof-of-work single-use?
 *
 * Added because the adversarial review was right that it was missing, and it is
 * a closer match to this discipline than anything else here: a control failing
 * open at runtime with no error, no exception and no 503.
 *
 * The mechanism. API-ON-DROPLET.md:89 configures a 256 MB Redis with
 * maxmemory-policy allkeys-lru. Single use is a SET NX on `pow:<signature>`.
 * Under memory pressure, allkeys-lru evicts whatever it likes — including
 * those pow: keys — and app/scan-url/route.ts then reads `fresh !== null`,
 * concludes the token has never been used, and serves the scan. There is no
 * error path here at all: eviction is Redis working as configured. A solved
 * token becomes replayable for its remaining lifetime and every response stays
 * 200.
 *
 * evicted_keys is cumulative since the server started, so the number alone says
 * little. What says something is the number MOVING between runs, which is why
 * the previous value is kept in rasp-runtime-state.json.
 *
 * Read-only: `redis-cli info` and `config get` change nothing, and both are
 * localhost-only on this box.
 *
 * Deliberately NOT flagged: a non-zero evicted_keys on a first run is reported
 * at `medium`, not `high`, because it may be entirely historical — an old
 * burst, or the pre-2026-09-18 /event keyspace that was fixed precisely because
 * it could evict real counters to make room for itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { readState, writeState } from './rasp-restart-oom-watch.mjs';

export default check({
  id: 'rasp-redis-eviction',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'Redis is not evicting keys — an eviction silently turns single-use proof-of-work back into replayable proof-of-work.',
  async run(ctx) {
    const baseline = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/rasp-baseline.json'), 'utf-8')).redis;

    const out = String(ctx.ssh([
      'echo "--RASP:STATS--"',
      "redis-cli info stats 2>&1 | grep -E '^evicted_keys|^expired_keys' || true",
      'echo "--RASP:POLICY--"',
      'redis-cli config get maxmemory-policy 2>&1 | tail -1 || true',
      'echo "--RASP:MAXMEM--"',
      'redis-cli config get maxmemory 2>&1 | tail -1 || true',
      'echo "--RASP:USED--"',
      "redis-cli info memory 2>&1 | grep -E '^used_memory:' || true",
      'echo "--RASP:END--"',
    ].join('; '), { timeoutMs: 25_000 }));

    if (!out.includes('--RASP:END--')) throw new ctx.Skip(`redis-cli read did not complete: ${out.slice(0, 200) || '(empty)'}`);
    // Split on marker lines. The first version of this used a lazy regex
    // between markers, and an EMPTY section swallowed the next one — which is
    // how this suite's first run reported a kernel OOM kill on a box whose
    // oom-kill count was zero. A parser bug in a security check looks exactly
    // like a finding about the system, which is the most expensive kind of
    // false positive there is.
    const parts = {};
    let cur = null;
    for (const line of out.split('\n')) {
      const m = /^--RASP:([A-Z]+)--$/.exec(line.trim());
      if (m) { cur = m[1]; parts[cur] = []; continue; }
      if (cur) parts[cur].push(line);
    }
    const section = (n) => (parts[n] || []).join('\n').trim();

    const statsRaw = section('STATS');
    if (!statsRaw) {
      // Could not ask Redis at all. That is not "no evictions".
      throw new ctx.Skip(`redis-cli info stats returned nothing (redis-cli missing, or the server is not answering): ${out.slice(0, 200)}`);
    }

    const findings = [];
    let checked = 0;

    const evicted = Number(/evicted_keys:(\d+)/.exec(statsRaw)?.[1]);
    const state = readState(ctx.repoRoot);
    if (Number.isFinite(evicted)) {
      checked++;
      const prev = state.evictedKeys;
      if (typeof prev === 'number' && evicted > prev) {
        findings.push(finding({
          severity: 'high',
          title: `Redis evicted ${evicted - prev} key(s) since the last run`,
          detail: 'Eviction is how single-use proof-of-work fails open. An evicted pow:<signature> makes app/scan-url read the token as fresh and serve the scan — no error, no 503, response 200. It also silently loses /event counters.',
          evidence: `redis-cli info stats → evicted_keys=${evicted} (was ${prev} at ${state._updatedAt || 'the previous run'})`,
          remediation: 'Find what is filling Redis: redis-cli --bigkeys, redis-cli info keyspace. Then either raise maxmemory or bound the keyspace that grew.',
        }));
      } else if (typeof prev !== 'number' && evicted > 0) {
        findings.push(finding({
          severity: 'medium',
          title: `Redis has evicted ${evicted} keys since it started`,
          detail: 'Cumulative, so this may be historical. It is recorded as the baseline now; any increase from here is graded high, because each eviction of a pow: key is one replayable proof-of-work.',
          evidence: `redis-cli info stats → evicted_keys=${evicted} (no previous value recorded); ${statsRaw.replace(/\n/g, ' | ')}`,
          remediation: 'Check redis-cli info keyspace for which keyspace is large, and re-run tomorrow to see whether it is still moving.',
        }));
      }
      writeState(ctx.repoRoot, { evictedKeys: evicted, evictedKeysSeenAt: new Date().toISOString() });
    }

    const policy = section('POLICY');
    if (policy) {
      checked++;
      if (policy !== baseline.maxmemoryPolicy) {
        findings.push(finding({
          severity: 'medium',
          title: `Redis maxmemory-policy is ${policy}, expected ${baseline.maxmemoryPolicy}`,
          detail: policy === 'noeviction'
            ? 'noeviction is not simply "worse" than the documented allkeys-lru — it fails the other way. Nothing evicts a pow: key behind the app’s back, so single-use proof-of-work stays honest; instead, once memory is full every write is refused, /scan-url takes its fail-closed 503 path and /event silently stops counting. Either way the deployed behaviour is no longer what the runbook says, so whoever reads it during an incident will predict the wrong failure.'
            : 'The policy decides what happens when memory fills, and the answer changes which controls fail and how. An unexpected value means the deployed behaviour is no longer the documented one.',
          evidence: `redis-cli config get maxmemory-policy → ${policy} (API-ON-DROPLET.md:89 sets ${baseline.maxmemoryPolicy})`,
          remediation: 'Reconcile /etc/redis/redis.conf with API-ON-DROPLET.md, or update the runbook if the change was deliberate.',
        }));
      }
    }

    const maxmem = Number(section('MAXMEM'));
    const used = Number(/used_memory:(\d+)/.exec(section('USED'))?.[1]);
    // maxmemory=0 is Redis for "no limit", and it is the dangerous reading, not
    // the neutral one: the eviction arm above can never fire, and Redis is free
    // to grow until the KERNEL picks a victim on a box that also runs MySQL.
    // The first version of this check skipped the whole block when maxmem was
    // 0, i.e. it went quiet in exactly the state worth reporting.
    if (Number.isFinite(maxmem) && maxmem === 0) {
      checked++;
      findings.push(finding({
        severity: 'high',
        title: 'Redis has no maxmemory limit at all (maxmemory=0)',
        detail: 'API-ON-DROPLET.md:89 records a 256 MB cap, and the memory budget for this box is written around it (MySQL ~1.5G, Apache+PHP ~1G, Redis 256M, ib-api 768M). With no cap Redis grows until the kernel OOM killer chooses something to kill — which is the collateral-damage outcome the systemd ceilings on ib-api exist to prevent, arriving by a route nothing was watching.',
        evidence: `redis-cli config get maxmemory → 0 (unlimited); used_memory=${Number.isFinite(used) ? used : '?'}; expected ${baseline.maxmemoryBytes} per API-ON-DROPLET.md:89`,
        remediation: 'redis-cli config set maxmemory 256mb and persist it in /etc/redis/redis.conf, or update the runbook if running uncapped was a deliberate decision.',
      }));
    } else if (Number.isFinite(maxmem) && maxmem > 0 && Number.isFinite(used)) {
      checked++;
      if (maxmem !== baseline.maxmemoryBytes) {
        findings.push(finding({
          severity: 'low',
          title: `Redis maxmemory is ${(maxmem / 1024 / 1024).toFixed(0)} MB, the runbook says ${(baseline.maxmemoryBytes / 1024 / 1024).toFixed(0)} MB`,
          detail: 'Not dangerous by itself, but the box’s memory budget was sized against the documented number, so a change here moves the line that keeps MySQL alive.',
          evidence: `redis-cli config get maxmemory → ${maxmem} (API-ON-DROPLET.md:89 sets ${baseline.maxmemoryBytes})`,
          remediation: 'Reconcile /etc/redis/redis.conf with the runbook, or update the runbook.',
        }));
      }
      const ratio = used / maxmem;
      if (ratio >= baseline.usedMemoryWarnRatio) {
        findings.push(finding({
          severity: 'medium',
          title: `Redis is at ${(ratio * 100).toFixed(0)}% of its ${(maxmem / 1024 / 1024).toFixed(0)} MB cap`,
          detail: 'This is the state just before evictions begin, which is the state just before single-use proof-of-work starts failing open. Cheaper to act on now than to read about in evicted_keys tomorrow.',
          evidence: `redis-cli info memory → used_memory=${used}; config get maxmemory → ${maxmem}`,
          remediation: 'redis-cli --bigkeys, and check the /event keyspace TTLs (35 days, ~21,000 keys/day is the documented shape).',
        }));
      }
    }

    return { findings, checked };
  },
});
