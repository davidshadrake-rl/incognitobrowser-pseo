/**
 * Are the resource ceilings still there, and are they still coming from the
 * file that is supposed to carry them?
 *
 * The failure the runbook names in its own words (API-ON-DROPLET.md:283):
 * without MemoryMax, MemorySwapMax, CPUQuota and TasksMax, "an overloaded tools
 * service grows until the kernel picks a victim — and it picks MySQL, so
 * WordPress goes down and does not come back on its own". Those values live in
 * a drop-in at /etc/systemd/system/ib-api.service.d/limits.conf, which is a
 * different file from the unit that scripts/deploy-api.sh restarts, and which
 * the runbook's own unit listing at :125-143 does not include. A `systemctl
 * edit`, a rebuild from that listing, or a botched daemon-reload removes it and
 * nothing notices until the OOM killer takes the database.
 *
 * OVERLAP, named rather than hidden: rasp-systemd-envelope grades the same
 * merged ceilings and the same heap flag. It is a good check and this one does
 * not try to replace it. Two things live only here, and they are the ones that
 * catch the failure mode above rather than its symptom:
 *
 *   - DropInPaths must still name limits.conf. If someone moves the values into
 *     the base unit and deletes the drop-in, every merged value still reads
 *     correct and the next box rebuild from the runbook silently ships with no
 *     ceilings at all. Merged-value checks pass right through that.
 *   - The crash-loop brake, StartLimitBurst=5 over StartLimitIntervalUSec=5min.
 *     The runbook lists it beside the ceilings because a restart storm is its
 *     own load; nothing else in the suite reads either property.
 *
 * The ceilings themselves are still asserted here, because a check that only
 * grades provenance would report "the drop-in is present" about a drop-in
 * someone had emptied. If these two checks are ever consolidated, keep the
 * DropInPaths and StartLimit halves — they exist nowhere else.
 *
 * Read-only: one `systemctl show`, shared with the rest of the cnast batch.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline, showProps } from './cnast-lib.mjs';

export default check({
  id: 'api-unit-resource-ceilings',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'The limits.conf drop-in is still the source of ib-api\'s memory/CPU/task ceilings, and the crash-loop brake is still set.',
  async run(ctx) {
    const want = baseline(ctx).unit.ceilings;
    const sections = droplet(ctx);
    const raw = section(ctx, sections, 'UNIT');
    const kv = showProps(raw);
    if (!kv.size) throw new ctx.Skip(`systemctl show ib-api returned nothing usable: ${raw.slice(0, 200)}`);
    if (kv.get('LoadState') === 'not-found') throw new ctx.Skip('there is no ib-api unit on this host — api-unit-sandbox-props reports that as a finding; nothing to grade here');

    const findings = [];
    let checked = 0;

    // Provenance first. This is the half that only exists in this check.
    checked++;
    const dropIns = kv.get('DropInPaths') || '';
    if (!dropIns.includes(want.dropInMustInclude)) {
      findings.push(finding({
        severity: 'medium',
        title: 'The limits.conf drop-in is no longer loaded for ib-api',
        detail: 'The ceilings may still read correctly today because someone copied them into the base unit — but the runbook\'s unit listing does not contain them, so the next rebuild from documentation ships a service with no ceilings and nothing to notice. The drop-in is the record; losing it is the drift.',
        evidence: `systemctl show ib-api -p DropInPaths → DropInPaths=${dropIns || '(none)'} (expected to contain ${want.dropInMustInclude})`,
        remediation: 'Restore /etc/systemd/system/ib-api.service.d/limits.conf with the values in API-ON-DROPLET.md:283 and run systemctl daemon-reload.',
      }));
    }

    checked++;
    if ((kv.get('UnitFileState') || '') !== 'enabled') {
      findings.push(finding({
        severity: 'high',
        title: `ib-api is ${kv.get('UnitFileState') || 'in an unknown enable state'} — it will not come back after a reboot`,
        detail: 'The box has a pending reboot more often than it is rebooted, and a service that is running but not enabled survives only until the next one. Every server-backed tool would then fail with no deploy having happened.',
        evidence: `systemctl show ib-api -p UnitFileState -p ActiveState → UnitFileState=${kv.get('UnitFileState') || '(empty)'}, ActiveState=${kv.get('ActiveState') || '?'}`,
        remediation: 'systemctl enable ib-api',
      }));
    }

    // Then the values themselves.
    for (const prop of ['MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax', 'LimitNOFILE', 'StartLimitBurst', 'StartLimitIntervalUSec']) {
      checked++;
      const got = kv.get(prop);
      if (got === undefined) {
        findings.push(finding({
          severity: 'low',
          title: `systemctl did not report ${prop} for ib-api`,
          detail: 'Reported rather than assumed correct: an absent property is an unverified control, not a satisfied one.',
          evidence: `systemctl show ib-api -p ${prop} → (no line returned)`,
          remediation: `Check by hand: systemctl show ib-api -p ${prop}`,
        }));
        continue;
      }
      if (got !== want[prop]) {
        const isCeiling = ['MemoryMax', 'MemorySwapMax', 'CPUQuotaPerSecUSec', 'TasksMax'].includes(prop);
        findings.push(finding({
          severity: isCeiling ? 'medium' : 'low',
          title: `${prop}=${got} on ib-api, expected ${want[prop]}`,
          detail: isCeiling
            ? 'This is one of the four values that stop an overloaded tools service from growing until the kernel picks MySQL as its victim. "infinity" means the ceiling is gone entirely.'
            : 'The crash-loop brake: without StartLimitBurst over StartLimitIntervalUSec, a service that fails on startup restarts forever and becomes its own load on a 2-vCPU box.',
          evidence: `systemctl show ib-api -p ${prop} → ${prop}=${got} (baseline: ${want[prop]}, from API-ON-DROPLET.md:283)`,
          remediation: `Set ${prop.replace('PerSecUSec', '').replace('USec', '')} in /etc/systemd/system/ib-api.service.d/limits.conf and run systemctl daemon-reload && systemctl restart ib-api.`,
        }));
      }
    }

    // The Node heap cap. It can legitimately live in either ExecStart or
    // Environment=NODE_OPTIONS, so both are read before concluding it is gone.
    checked++;
    const execStart = kv.get('ExecStart') || '';
    const environment = kv.get('Environment') || '';
    if (!execStart.includes(want.heapFlag) && !environment.includes(want.heapFlag)) {
      findings.push(finding({
        severity: 'medium',
        title: `The Node heap cap ${want.heapFlag} is in neither ExecStart nor Environment`,
        detail: 'MemoryMax is the hard stop: V8 grows past its comfortable working set, the cgroup kills the process, and the service restarts mid-request. The heap flag is what makes V8 collect garbage before that happens instead of after. Without it the ceiling still protects MySQL, but ib-api absorbs the failure as a restart rather than as back-pressure.',
        evidence: `systemctl show ib-api -p ExecStart -p Environment → ExecStart=${execStart.slice(0, 220)} | Environment=${environment.slice(0, 120) || '(empty)'}`,
        remediation: 'Either ExecStart=/usr/bin/node --max-old-space-size=448 node_modules/.bin/next start -p 3100 -H 127.0.0.1, or Environment=NODE_OPTIONS=--max-old-space-size=448 in the drop-in.',
      }));
    }

    return { findings, checked };
  },
});
