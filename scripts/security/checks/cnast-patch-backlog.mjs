/**
 * How far behind is the only box we have?
 *
 * There is no staging, no second environment, and no patching cadence written
 * down anywhere in this repo — I grepped API-ON-DROPLET.md and DEPLOYMENT.md.
 * One unpatched Apache or OpenSSL CVE here takes both the privacy tools and the
 * team's WordPress, and there is nowhere to fail over to.
 *
 * It also catches the quieter half: unattended-upgrades installing a kernel and
 * nobody rebooting, so the box runs code it no longer has on disk and the fix
 * that was applied is not actually in effect. `/var/run/reboot-required` is the
 * only signal that exists for that, and nothing reads it.
 *
 * READ-ONLY AND OFFLINE ON THE BOX. `apt-check` reads the cached apt state. It
 * is deliberately NOT `apt-get update`, which would hit the network and take
 * the dpkg lock on a shared production host in the middle of the night. The
 * consequence is honest and worth stating: this check reports what apt last
 * knew, so if unattended-upgrades has stopped refreshing, the count can read
 * low for the wrong reason. That is why unattended-upgrades being enabled is
 * itself one of the graded conditions rather than an aside.
 *
 * Deliberately NOT flagged: the total pending-update count. 61 ordinary updates
 * on an Ubuntu LTS box is a Tuesday, and grading it would put a permanent
 * yellow line in the nightly output that everybody learns to ignore — which
 * would cost more than it buys. The security subset and the reboot flag are the
 * two that mean something.
 *
 * Also deliberately NOT flagged: "Expanded Security Maintenance for
 * Applications is not enabled". ESM is a paid Ubuntu Pro subscription. Naming
 * it as a failure every night on a project that has not bought it is a finding
 * nobody here can close, which is the reason the WordPress backup check was cut
 * from this discipline.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

export default check({
  id: 'os-security-patch-backlog',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'Pending SECURITY updates, a pending reboot, and whether unattended-upgrades is still enabled on the one box that exists.',
  async run(ctx) {
    const want = baseline(ctx).patching;
    const sections = droplet(ctx);
    const patch = section(ctx, sections, 'PATCH');
    const findings = [];
    let checked = 0;

    // apt-check --human-readable prints e.g.
    //   "61 updates can be applied immediately."
    //   "1 of these updates is a standard security update."
    // The security line is singular or plural, and absent when the count is 0.
    checked++;
    const secMatch = /(\d+)\s+of these updates (?:is|are) (?:a )?standard security updates?/i.exec(patch);
    const security = secMatch ? Number(secMatch[1]) : (/is a standard security update|are standard security updates/i.test(patch) ? null : 0);
    const totalMatch = /(\d+)\s+updates? can be applied immediately/i.exec(patch);

    if (security === null) {
      findings.push(finding({
        severity: 'medium',
        title: 'Could not read the pending security-update count',
        detail: 'apt-check answered in a shape this check does not parse. Reported rather than counted as zero: an unparsed answer is not a clean one.',
        evidence: `/usr/lib/update-notifier/apt-check --human-readable → ${patch.replace(/\n/g, ' | ').slice(0, 300)}`,
        remediation: 'Check by hand on the droplet: /usr/lib/update-notifier/apt-check --human-readable',
      }));
    } else if (security > 0) {
      findings.push(finding({
        severity: security >= want.securityUpdatesFailAt ? 'high' : 'medium',
        title: `${security} pending security update${security === 1 ? '' : 's'}`,
        detail: `There is one box and no staging. A security update sitting here is sitting on the team's WordPress and MySQL as much as on our tools. Threshold for high is ${want.securityUpdatesFailAt}.`,
        evidence: `/usr/lib/update-notifier/apt-check --human-readable → ${patch.replace(/\n/g, ' | ').slice(0, 300)}${totalMatch ? ` (of ${totalMatch[1]} updates total)` : ''}`,
        remediation: 'apt-get update && apt-get upgrade, at a time when a brief Apache/MySQL restart is acceptable. Check `apt list --upgradable` first for anything that restarts the database.',
      }));
    }

    checked++;
    const reboot = (sections.REBOOT || '').trim();
    if (want.rebootRequiredIsFinding && reboot === 'REBOOT_REQUIRED') {
      findings.push(finding({
        severity: 'medium',
        title: 'The box is running code it no longer has on disk — a reboot is pending',
        detail: 'Something (usually a kernel or a core library) has been upgraded and the running processes still hold the old version. Until the reboot, the patch that was applied is not in effect, so the apt state reads clean while the vulnerability is still live. On a single host with no failover this needs a scheduled window, not a nightly surprise.',
        evidence: 'test -f /var/run/reboot-required → REBOOT_REQUIRED',
        remediation: 'Schedule a reboot. Confirm ib-api, apache2, mysql and redis-server are all enabled first (api-unit-resource-ceilings grades that for ib-api).',
      }));
    }

    checked++;
    const unattended = (sections.UNATTENDED || '').trim();
    if (want.unattendedUpgradesMustBeEnabled && !/^enabled/m.test(unattended)) {
      findings.push(finding({
        severity: 'high',
        title: `unattended-upgrades is ${unattended || 'not readable'}`,
        detail: 'With no patching cadence documented anywhere in this repo, unattended-upgrades is the entire patching strategy. Disabled, nothing applies security updates to this box at all — and the count above goes quiet for the wrong reason, because nothing is refreshing apt\'s state either.',
        evidence: `systemctl is-enabled unattended-upgrades → ${unattended || '(empty)'}`,
        remediation: 'systemctl enable --now unattended-upgrades, and confirm /etc/apt/apt.conf.d/20auto-upgrades has both Update-Package-Lists and Unattended-Upgrade set to "1".',
      }));
    }

    // Release name as durable context: an Ubuntu LTS approaching EOL is a
    // months-of-notice problem, and this is the only place it would be seen.
    const host = (sections.HOST || '').trim();
    if (host) {
      findings.push(finding({
        severity: 'info',
        title: `Host: ${host.split('\n').join(' · kernel ')}`,
        detail: 'Reported every night so an approaching LTS end-of-life is visible long before it is urgent. Not graded — the upgrade is a scheduled project, not a nightly failure.',
        evidence: `lsb_release -ds; uname -r → ${host.replace(/\n/g, ' | ')}`,
      }));
    }

    return { findings, checked };
  },
});
