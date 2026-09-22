/**
 * The three host-level things the runbook says keep MySQL alive.
 *
 * Added on the reviewer's point. API-ON-DROPLET.md:284-288 names ufw, the
 * hourly logrotate timer and disk headroom as controls, gives each a reason,
 * and then nothing anywhere verifies any of them:
 *
 *   - ufw is what keeps "Redis, MySQL and the Node service all bind localhost"
 *     true if one of them is ever misconfigured. Redis on this box has no
 *     password; a bind-address typo plus a disabled firewall is an open Redis
 *     on the public internet, which is a full compromise of every control that
 *     depends on it.
 *   - logrotate hourly, not nightly, because "a flood filling the disk between
 *     nightly rotations" is the scenario, and "a full disk takes MySQL down".
 *   - disk headroom for the same reason, stated plainly in the runbook.
 *
 * All three are one more line in an ssh call that is already being made, all
 * three are read-only, and each failure is the kind that is invisible right up
 * until it takes WordPress with it.
 *
 * Deliberately NOT flagged: which ports ufw allows. The rule set is the
 * owner's to change (22/80/443 today), and grading it here would fight with
 * legitimate operations. Whether the firewall is ON at all is not a judgement
 * call, so that is what gets graded.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

export default check({
  id: 'rasp-host-guardrails',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'ufw is still up, logrotate still runs hourly, and the disk still has room — the three host controls that keep MySQL alive.',
  async run(ctx) {
    const host = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/rasp-baseline.json'), 'utf-8')).host;

    const out = String(ctx.ssh([
      'echo "--RASP:UFW--"',
      '(sudo -n ufw status 2>/dev/null || ufw status 2>/dev/null || echo "unavailable") | head -1',
      'echo "--RASP:TIMER--"',
      // TimersCalendar, not `systemctl cat`. The hourly setting here arrives as
      // a drop-in that first RESETS the vendor's OnCalendar with an empty
      // assignment and then sets its own, so `cat` prints three OnCalendar
      // lines and the first one is the stale daily value. Reading the file
      // reported a healthy hourly timer as "daily"; TimersCalendar is the
      // merged value systemd will actually fire on.
      `systemctl is-active ${host.logrotateTimer} 2>&1; systemctl show ${host.logrotateTimer} -p TimersCalendar --no-pager 2>&1`,
      'echo "--RASP:DISK--"',
      'df -P -m / /var 2>&1 | tail -n +2',
      'echo "--RASP:END--"',
    ].join('; '), { timeoutMs: 25_000 }));

    if (!out.includes('--RASP:END--')) throw new ctx.Skip(`host read did not complete: ${out.slice(0, 200) || '(empty)'}`);
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

    // ---- ufw ---------------------------------------------------------------
    const ufw = section('UFW');
    if (!ufw || /unavailable/.test(ufw)) {
      // Not knowing is its own finding. It must not read like "firewall fine".
      // But "not installed" is knowing, and it is graded — at high — by
      // ufw-default-deny; this used to blame sudo for a missing binary and
      // double-count the same fact as a second, wrong finding.
      const notInstalled = /command not found|not found|UNAVAILABLE/i.test(ufw || '');
      findings.push(finding({
        severity: notInstalled ? 'info' : 'medium',
        title: notInstalled
          ? 'ufw is not installed on this box (graded at high by ufw-default-deny; not double-counted here)'
          : 'Could not read ufw status (needs root, and sudo -n was refused)',
        detail: 'The firewall state is unverified, which is a different thing from verified-good. It is the control that keeps a localhost-bind mistake from becoming an open Redis.',
        evidence: `ufw status → ${ufw || '(no output)'}`,
        remediation: 'Give the deploy user NOPASSWD sudo for `ufw status` alone, or run `sudo ufw status` by hand and record it.',
      }));
    } else {
      checked++;
      if (!/Status:\s*active/i.test(ufw)) {
        findings.push(finding({
          severity: 'high',
          title: `ufw is not active (${ufw})`,
          detail: 'Redis on this box has no password and MySQL has no remote user — both rely on binding localhost. ufw is the second layer that keeps a single bind-address mistake from exposing them to the internet.',
          evidence: `ufw status → ${ufw}`,
          remediation: 'sudo ufw enable (default deny inbound, allow 22/80/443 — API-ON-DROPLET.md:284).',
        }));
      }
    }

    // ---- logrotate timer ---------------------------------------------------
    const timer = section('TIMER');
    if (timer) {
      checked++;
      const active = /^\s*active\s*$/m.test(timer);
      // TimersCalendar={ OnCalendar=*-*-* *:00:00 ; next_elapse=… }, possibly
      // more than one; hourly in any of them is enough.
      const calRaw = /TimersCalendar=(.*)$/im.exec(timer)?.[1]?.trim() || '';
      const cal = /OnCalendar=([^;}]+)/i.exec(calRaw)?.[1]?.trim() || calRaw;
      const hourlyish = /hourly|\*:00:00/i.test(cal);
      if (!active) {
        findings.push(finding({
          severity: 'medium',
          title: `${host.logrotateTimer} is not active`,
          detail: 'Logs are not being rotated on a schedule. The runbook is explicit about the consequence: a flood fills the disk, and a full disk takes MySQL down.',
          evidence: `systemctl is-active ${host.logrotateTimer} → ${timer.split('\n')[0]}`,
          remediation: `systemctl enable --now ${host.logrotateTimer}`,
        }));
      } else if (cal && !hourlyish) {
        findings.push(finding({
          severity: 'low',
          title: `logrotate runs on "${cal}", not hourly`,
          detail: 'API-ON-DROPLET.md:288 specifies hourly deliberately: nightly rotation leaves a whole night in which a flood can fill the disk between rotations.',
          evidence: `systemctl show ${host.logrotateTimer} -p TimersCalendar → ${timer.replace(/\n/g, ' | ').slice(0, 220)}`,
          remediation: 'Restore the hourly override for logrotate.timer.',
        }));
      }
    }

    // ---- disk --------------------------------------------------------------
    for (const line of section('DISK').split('\n')) {
      // df -P -m: Filesystem 1M-blocks Used Available Capacity Mounted
      const m = /^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(\S+)$/.exec(line.trim());
      if (!m) continue;
      checked++;
      const availMB = Number(m[4]);
      const usedPct = Number(m[5]);
      const mount = m[6];
      if (usedPct > 100 - host.diskMinFreePercent || availMB < host.diskMinFreeMB) {
        findings.push(finding({
          severity: usedPct >= 95 ? 'high' : 'medium',
          title: `${mount} is ${usedPct}% full (${availMB} MB free)`,
          detail: 'A full disk takes MySQL down, and MySQL going down takes the team’s WordPress with it. This is the cheapest of all the collateral-damage signals to act on early.',
          evidence: `df -P -m ${mount} → ${line.trim()}`,
          remediation: 'Check /var/log first (du -sh /var/log/*), then confirm logrotate is rotating hourly.',
        }));
      }
    }

    return { findings, checked };
  },
});
