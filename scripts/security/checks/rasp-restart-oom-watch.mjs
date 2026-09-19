/**
 * Did ib-api restart, get OOM-killed, or fall back off Redis since last night?
 *
 * All three are completely silent today. systemd restarts the unit after 5s
 * (StartLimitBurst 5 per 300s), so an input that reliably kills the Node
 * process looks, from outside, like a service that works. The only console
 * calls in the whole app — app/scan-url/route.ts:301, app/challenge/route.ts:88,
 * lib/rate-limit.ts:228, lib/dns-leak-store.ts:58 — go to a journal nobody
 * reads. A climbing NRestarts is the cheapest possible signal that somebody
 * found a request that kills the service.
 *
 * The kernel OOM line matters for a second reason: it names its victim. On a
 * 2 vCPU box that also runs the team's WordPress and MySQL, the victim is the
 * thing the whole abuse-resistance design exists to protect, so we grep the
 * kernel log too, not just this unit's.
 *
 * NRestarts is a counter, not a state, so the check keeps the last value it
 * saw in scripts/security/data/rasp-runtime-state.json and grades the
 * DIFFERENCE. First run has nothing to compare against and says so rather than
 * printing a tick it has not earned.
 *
 * Deliberately NOT flagged: a single restart is reported at `low` and one at
 * deploy time is normal — scripts/deploy-api.sh:95 restarts the unit on every
 * deploy. It is the count climbing without a deploy, and anything that looks
 * like a loop, that matters.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

const STATE_REL = 'scripts/security/data/rasp-runtime-state.json';

export function readState(repoRoot) {
  const p = join(repoRoot, STATE_REL);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf-8')); } catch { return {}; }
}

export function writeState(repoRoot, patch) {
  const p = join(repoRoot, STATE_REL);
  const next = { ...readState(repoRoot), ...patch, _updatedAt: new Date().toISOString() };
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n');
  return next;
}

export default check({
  id: 'rasp-restart-oom-watch',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'ib-api restart count, OOM kills on the box, and the Redis fallback line — the three runtime events nothing currently records.',
  async run(ctx) {
    // One ssh session, four read-only reads, separated by markers so a failure
    // in any one of them is visible instead of merging into its neighbour.
    const script = [
      'echo "--RASP:NRESTARTS--"',
      'systemctl show ib-api -p NRestarts -p ActiveEnterTimestamp --no-pager 2>&1',
      'echo "--RASP:UNITLOG--"',
      "journalctl -u ib-api --since '-24h' --no-pager 2>&1 | grep -ciE 'out of memory|killed|FATAL ERROR' || true",
      'echo "--RASP:KERNOOM--"',
      "journalctl -k --since '-24h' --no-pager 2>&1 | grep -i 'oom-kill' | tail -5 || true",
      'echo "--RASP:REDISFALLBACK--"',
      "journalctl -u ib-api --since '-24h' --no-pager 2>&1 | grep -c 'falling back to in-memory' || true",
      'echo "--RASP:END--"',
    ].join('; ');

    const out = String(ctx.ssh(script, { timeoutMs: 40_000 }));
    if (!out.includes('--RASP:END--')) {
      throw new ctx.Skip(`journalctl/systemctl read did not complete: ${out.slice(0, 200) || '(empty)'}`);
    }
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

    const findings = [];
    let checked = 0;

    // --- restart count -----------------------------------------------------
    const restartsRaw = section('NRESTARTS');
    const nRestarts = Number(/NRestarts=(\d+)/.exec(restartsRaw)?.[1]);
    const activeSince = /ActiveEnterTimestamp=(.*)/.exec(restartsRaw)?.[1]?.trim() || '(unknown)';
    const state = readState(ctx.repoRoot);
    if (Number.isFinite(nRestarts)) {
      checked++;
      const prev = state.nRestarts;
      if (typeof prev === 'number' && nRestarts > prev) {
        const delta = nRestarts - prev;
        findings.push(finding({
          severity: delta >= 3 ? 'high' : 'low',
          title: `ib-api restarted ${delta}× since the last run (NRestarts ${prev} → ${nRestarts})`,
          detail: delta >= 3
            ? 'Three or more restarts between runs is the shape of a crash loop, or of an input that reliably kills the process. systemd hides it: RestartSec=5 brings the service back before anyone notices it left.'
            : 'One restart is what a deploy looks like (scripts/deploy-api.sh:95). If there was no deploy, the process died and nothing said so.',
          evidence: `systemctl show ib-api -p NRestarts → NRestarts=${nRestarts} (was ${prev} at ${state._updatedAt || 'the previous run'}); ActiveEnterTimestamp=${activeSince}`,
          remediation: 'journalctl -u ib-api --since -24h --no-pager, and look at what the last request before each exit was.',
        }));
      } else if (typeof prev !== 'number') {
        findings.push(finding({
          severity: 'info',
          title: `First run: recording NRestarts=${nRestarts} as the baseline`,
          detail: 'There is nothing to compare against yet. Recorded now; the next run grades the difference.',
          evidence: `systemctl show ib-api -p NRestarts → NRestarts=${nRestarts}; ActiveEnterTimestamp=${activeSince}`,
          remediation: 'No action. This is the check announcing that it could not yet detect a change.',
        }));
      }
      writeState(ctx.repoRoot, { nRestarts, nRestartsSeenAt: new Date().toISOString() });
    } else {
      findings.push(finding({
        severity: 'medium',
        title: 'Could not read NRestarts for ib-api',
        detail: '"We could not check" and "nothing happened" must not look the same. This is the former.',
        evidence: `systemctl show ib-api -p NRestarts → ${restartsRaw.slice(0, 200) || '(empty)'}`,
        remediation: 'Run the command on the droplet by hand and find out why it answered nothing.',
      }));
    }

    // --- OOM / fatal in this unit's journal --------------------------------
    const unitHits = Number(section('UNITLOG'));
    if (Number.isFinite(unitHits)) {
      checked++;
      if (unitHits > 0) {
        findings.push(finding({
          severity: 'medium',
          title: `${unitHits} OOM/kill/FATAL line(s) in the ib-api journal in the last 24h`,
          detail: 'The unit is capped at MemoryMax=768M with a 448M Node heap. Hitting that is not a crash to shrug at — it means something made the process allocate past its whole budget.',
          evidence: `journalctl -u ib-api --since '-24h' | grep -ciE 'out of memory|killed|FATAL ERROR' → ${unitHits}`,
          remediation: "journalctl -u ib-api --since -24h --no-pager | grep -iE 'out of memory|killed|FATAL ERROR' -B5 to see what preceded it.",
        }));
      }
    }

    // --- kernel OOM killer, whoever the victim was -------------------------
    const kern = section('KERNOOM');
    checked++;
    if (kern) {
      const mysqlVictim = /mysql|mariadb/i.test(kern);
      findings.push(finding({
        severity: 'high',
        title: mysqlVictim
          ? 'The kernel OOM killer fired and MySQL is named in the line'
          : 'The kernel OOM killer fired on this box in the last 24h',
        detail: mysqlVictim
          ? 'This is the exact outcome the systemd ceilings exist to prevent (API-ON-DROPLET.md:274-275): the box ran out of memory and the kernel took MySQL, so WordPress is down and will not come back on its own.'
          : 'The box ran out of memory and the kernel chose something to kill. The victim is named in the line below.',
        evidence: `journalctl -k --since '-24h' | grep -i 'oom-kill' → ${kern.replace(/\n/g, ' | ').slice(0, 400)}`,
        remediation: 'Identify the victim and the cgroup in the line, then check whether ib-api’s ceilings were in force at the time (rasp-systemd-envelope).',
      }));
    }

    // --- the rate limiter silently going per-process ------------------------
    const fallbacks = Number(section('REDISFALLBACK'));
    if (Number.isFinite(fallbacks)) {
      checked++;
      if (fallbacks > 0) {
        findings.push(finding({
          severity: 'high',
          title: `The rate limiter fell back to in-memory ${fallbacks}× in the last 24h`,
          detail: 'lib/rate-limit.ts:228 logs this and nothing else records it. While it is true the per-IP limit is a per-process Map, and the proof-of-work single-use claim has no shared store to make a claim in.',
          evidence: `journalctl -u ib-api --since '-24h' | grep -c 'falling back to in-memory' → ${fallbacks}`,
          remediation: 'Check Redis: systemctl status redis-server, redis-cli ping, and whether REDIS_URL in /etc/ib-api.env is still right.',
        }));
      }
    }

    return { findings, checked };
  },
});
