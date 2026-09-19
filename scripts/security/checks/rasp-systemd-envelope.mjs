/**
 * Are the systemd ceilings on ib-api still actually loaded?
 *
 * API-ON-DROPLET.md:283 is blunt about what they are for: without MemoryMax,
 * MemorySwapMax, CPUQuota and TasksMax, an overloaded tools service grows until
 * the kernel picks a victim — and it picks MySQL, so the team's WordPress goes
 * down and does not come back on its own. Those limits live in one drop-in
 * file, /etc/systemd/system/ib-api.service.d/limits.conf, and nothing in this
 * repo has ever verified that the file is present or that its values survived.
 *
 * The ways they quietly go away are all ordinary: a box rebuild that restores
 * the unit but not the drop-in, a package upgrade that rewrites the unit, or
 * someone raising MemoryMax at 2am during an incident and never putting it
 * back. The runbook is the only record, and a runbook does not notice.
 *
 * Read-only: `systemctl show` reports the loaded, merged configuration and
 * changes nothing. One ssh round trip.
 *
 * Deliberately NOT flagged: RestartSec disagreeing between the base unit
 * (API-ON-DROPLET.md:137 shows 3s) and the drop-in (5s) is not treated as two
 * separate faults — we grade the merged value systemd actually uses, which is
 * the only one that has any effect.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

export default check({
  id: 'rasp-systemd-envelope',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'The memory/CPU/task ceilings that stop an API flood from OOM-killing the team’s MySQL are still loaded on ib-api.',
  async run(ctx) {
    const baseline = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/rasp-baseline.json'), 'utf-8'));
    const want = baseline.systemd;
    // RestartUSec, not RestartSec: the drop-in is written as `RestartSec=5`,
    // but `systemctl show` reports the parsed value under RestartUSec (=5s).
    // Asking for the name from the config file gets you no line at all, which
    // this check would then have to report as "unverified" forever.
    const props = ['MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax', 'LimitNOFILE', 'Restart', 'RestartUSec'];

    // ExecStart and Environment come back as long structured lines; grabbing
    // them in the same call keeps this to a single ssh session.
    const out = ctx.ssh(
      `systemctl show ib-api -p ${props.join(' -p ')} -p ExecStart -p Environment -p LoadState -p ActiveState --no-pager`,
      { timeoutMs: 20_000 },
    );

    const kv = new Map();
    for (const line of String(out).split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
    }

    // `systemctl show` exits 0 even for a unit that does not exist, so silence
    // must never read as a pass. The two cases are told apart deliberately:
    // nothing at all means WE could not see (Skip), while LoadState=not-found
    // is something we DID see — the unit that runs the whole API is gone — and
    // that is a finding, not an excuse.
    if (!kv.size) {
      throw new ctx.Skip(`systemctl show ib-api returned nothing usable: ${String(out).slice(0, 200) || '(empty)'}`);
    }

    const findings = [];
    let checked = 0;

    if (kv.get('LoadState') === 'not-found') {
      checked++;
      findings.push(finding({
        severity: 'high',
        title: 'There is no ib-api unit on the box',
        detail: 'systemd does not know this service. Either it was removed, or it was never installed on the host this run is pointed at — and with no unit there are no ceilings, so nothing stands between a tools flood and the team’s MySQL.',
        evidence: `systemctl show ib-api -p LoadState → LoadState=not-found (ActiveState=${kv.get('ActiveState') || '?'})`,
        remediation: 'Confirm which host DEPLOY_HOST points at, then reinstall the unit and its drop-in per API-ON-DROPLET.md.',
      }));
      return { findings, checked };
    }

    for (const p of props) {
      if (!kv.has(p)) {
        findings.push(finding({
          severity: 'medium',
          title: `systemd did not report ${p} for ib-api`,
          detail: 'A property systemd does not report is one we cannot claim is enforced. Treat it as unverified, not as fine.',
          evidence: `systemctl show ib-api -p ${p} → (no line). Full output began: ${String(out).slice(0, 160).replace(/\n/g, ' | ')}`,
          remediation: 'Run the command by hand on the droplet and find out why the property is missing.',
          file: '/etc/systemd/system/ib-api.service.d/limits.conf',
        }));
        continue;
      }
      checked++;
      const got = kv.get(p);
      const expected = String(want[p]);
      if (got !== expected) {
        // 'infinity' is systemd's word for "no ceiling at all", which is the
        // precise state this check exists to catch, so it is called out.
        const uncapped = /^infinity$/i.test(got);
        findings.push(finding({
          severity: uncapped ? 'high' : 'medium',
          title: `ib-api ${p} is ${got}, expected ${expected}`,
          detail: uncapped
            ? `${p} is uncapped on the live unit. API-ON-DROPLET.md:283: without these ceilings an overloaded tools service grows until the kernel picks a victim, and it picks MySQL — WordPress goes down with it.`
            : `${p} drifted from the value the runbook records as deployed. Either the drop-in was edited or it is not being loaded.`,
          evidence: `systemctl show ib-api -p ${p} → ${p}=${got}  (expected ${p}=${expected})`,
          remediation: `Restore ${p}=${expected} in /etc/systemd/system/ib-api.service.d/limits.conf, then: systemctl daemon-reload && systemctl restart ib-api`,
          file: '/etc/systemd/system/ib-api.service.d/limits.conf',
        }));
      }
    }

    // The heap cap can arrive two ways and both are correct: on the command
    // line in ExecStart, or via Environment=NODE_OPTIONS=… in the drop-in
    // (which is how it is actually deployed here). Grading only ExecStart
    // would report a healthy box as broken every night, and a check that cries
    // wolf nightly is a check someone deletes.
    const execStart = kv.get('ExecStart') || '';
    const environment = kv.get('Environment') || '';
    if (execStart || environment) {
      checked++;
      if (!`${execStart} ${environment}`.includes(want.heapCapMustContain)) {
        findings.push(finding({
          severity: 'high',
          title: `Node heap cap ${want.heapCapMustContain} is in neither ExecStart nor Environment`,
          detail: 'MemoryMax stops the cgroup, but only after the kernel has already had to act. The heap cap is what makes V8 give up first, inside its own budget, instead of being killed alongside whatever else shares the box.',
          evidence: `ExecStart=${execStart.slice(0, 200)} | Environment=${environment.slice(0, 200)}`,
          remediation: `Put NODE_OPTIONS/ExecStart back with ${want.heapCapMustContain} (see API-ON-DROPLET.md:283), then daemon-reload and restart ib-api.`,
          file: '/etc/systemd/system/ib-api.service.d/limits.conf',
        }));
      }
    }

    // Not a ceiling, but the same round trip answers it and a dead unit makes
    // every other RASP check's silence meaningless.
    const active = kv.get('ActiveState');
    if (active) {
      checked++;
      if (active !== 'active') {
        findings.push(finding({
          severity: 'high',
          title: `ib-api is ${active}, not active`,
          detail: 'Every tool that needs a server — the scanner, the DNS leak test, What’s My IP — is down while this is true.',
          evidence: `systemctl show ib-api -p ActiveState → ActiveState=${active} (LoadState=${kv.get('LoadState') || '?'})`,
          remediation: 'journalctl -u ib-api -n 100 --no-pager, then systemctl start ib-api.',
        }));
      }
    }

    return { findings, checked };
  },
});
