/**
 * The other direction of the shared-fate problem: ib-api writing into WordPress.
 *
 * ib-api is the one process on this box that fetches attacker-supplied URLs,
 * and it still has an open DNS-rebinding gap recorded at
 * API-ON-DROPLET.md:343-348. It runs as www-data. Without ProtectSystem, a
 * compromise of that service can drop a PHP webshell straight into the
 * WordPress DocumentRoot, because www-data can write all of /var/www/html — a
 * tools bug becoming the team's incident.
 *
 * ProtectSystem=strict plus a ReadWritePaths that names only the service's own
 * directory turns that from a webshell into a permission error.
 *
 * A NOTE ABOUT EVIDENCE, because this check exists partly as a correction. An
 * earlier draft of this discipline reported the sandbox as MISSING on the
 * strength of the unit text printed in API-ON-DROPLET.md:125-143, which shows
 * only NoNewPrivileges and PrivateTmp. The runbook is stale — the live unit has
 * more than it documents, exactly as it omits the limits.conf drop-in from the
 * same service. Asserting system state from a document is the precise failure
 * API-ON-DROPLET.md:337-340 records about tests/ssrf-protection.test.ts grading
 * a hand-copied replica. So this check reads `systemctl show`, which reports
 * the merged configuration systemd is actually enforcing, and nothing else.
 *
 * Read-only: `systemctl show` reports state and changes none of it.
 *
 * Deliberately NOT flagged: CapabilityBoundingSet being the full default set,
 * and RestrictAddressFamilies being unset. On a service that already runs as a
 * non-root user with NoNewPrivileges=yes, a wide bounding set grants nothing
 * that process can reach — flagging it would be a generic-hardening finding of
 * the kind that gets a check switched off, and it would sit next to real ones
 * and drag them down with it. The service also has to open arbitrary outbound
 * sockets to do its job, so an address-family restriction is a narrow win at
 * best. ProtectHome is not graded either: there are no user home directories
 * with anything in them on this box.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline, showProps } from './cnast-lib.mjs';

export default check({
  id: 'api-unit-sandbox-props',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'The ib-api unit still confines the URL-fetching service to its own directory, so a compromise cannot write a webshell into the team\'s WordPress root.',
  async run(ctx) {
    const want = baseline(ctx).unit.sandbox;
    const sections = droplet(ctx);
    const kv = showProps(section(ctx, sections, 'UNIT'));

    const findings = [];
    let checked = 0;

    // `systemctl show` exits 0 for a unit that does not exist, so silence must
    // never read as a pass. Nothing at all means we could not see (Skip);
    // LoadState=not-found is something we DID see, and it is a finding.
    if (!kv.size) throw new ctx.Skip(`systemctl show ib-api returned nothing usable: ${section(ctx, sections, 'UNIT').slice(0, 200)}`);
    if (kv.get('LoadState') === 'not-found') {
      return {
        checked: 1,
        findings: [finding({
          severity: 'high',
          title: 'systemd has no ib-api unit',
          detail: 'The service that backs every server-side tool is not installed on the host this run points at. With no unit there is no sandbox and no ceilings.',
          evidence: `systemctl show ib-api -p LoadState → LoadState=not-found (ActiveState=${kv.get('ActiveState') || '?'})`,
          remediation: 'Confirm DEPLOY_HOST, then reinstall the unit and its drop-in per API-ON-DROPLET.md.',
        })],
      };
    }

    checked++;
    const protectSystem = kv.get('ProtectSystem') || '';
    if (!want.ProtectSystemAcceptable.includes(protectSystem)) {
      findings.push(finding({
        severity: 'high',
        title: `ib-api runs with ProtectSystem=${protectSystem || '(unset)'}`,
        detail: 'Without ProtectSystem=strict, a www-data process can write anywhere www-data can write — which on this box is all of /var/www/html, the team\'s WordPress DocumentRoot. This is the service that fetches attacker-supplied URLs and has a known open DNS-rebinding gap.',
        evidence: `systemctl show ib-api -p ProtectSystem → ProtectSystem=${protectSystem || '(empty)'} (want one of ${want.ProtectSystemAcceptable.join('/')})`,
        remediation: 'In /etc/systemd/system/ib-api.service.d/limits.conf add ProtectSystem=strict and ReadWritePaths=/opt/ib-api/.next, then systemctl daemon-reload && systemctl restart ib-api.',
      }));
    }

    checked++;
    const rwp = kv.get('ReadWritePaths') || '';
    const escapes = want.readWritePathsMustNotTouch.filter((p) => rwp.split(/\s+/).some((entry) => entry && (entry === p || entry.startsWith(`${p}/`))));
    if (escapes.length) {
      findings.push(finding({
        severity: 'high',
        title: `ReadWritePaths punches a hole into ${escapes.join(', ')}`,
        detail: 'ProtectSystem is only as strong as its exceptions. A ReadWritePaths entry under /var/www hands the sandbox\'s whole purpose back: the service can write into a directory Apache serves.',
        evidence: `systemctl show ib-api -p ReadWritePaths → ReadWritePaths=${rwp}`,
        remediation: 'Narrow ReadWritePaths to /opt/ib-api (or /opt/ib-api/.next, which is all Next.js writes at runtime).',
      }));
    }

    checked++;
    if ((kv.get('PrivateTmp') || '').toLowerCase() !== want.PrivateTmp) {
      findings.push(finding({
        severity: 'medium',
        title: `PrivateTmp=${kv.get('PrivateTmp') || '(unset)'} on ib-api`,
        detail: 'A shared /tmp between this service and the WordPress PHP workers is a symlink-race surface in both directions, on a box where the two applications otherwise share a uid.',
        evidence: `systemctl show ib-api -p PrivateTmp → PrivateTmp=${kv.get('PrivateTmp') || '(empty)'}`,
        remediation: 'PrivateTmp=true in the unit or its drop-in.',
      }));
    }

    checked++;
    if ((kv.get('NoNewPrivileges') || '').toLowerCase() !== want.NoNewPrivileges) {
      findings.push(finding({
        severity: 'high',
        title: `NoNewPrivileges=${kv.get('NoNewPrivileges') || '(unset)'} on ib-api`,
        detail: 'Without it, any setuid binary reachable from the service is an escalation path out of the www-data account, which is the only thing standing between a tools compromise and the whole box.',
        evidence: `systemctl show ib-api -p NoNewPrivileges → NoNewPrivileges=${kv.get('NoNewPrivileges') || '(empty)'}`,
        remediation: 'NoNewPrivileges=true in the unit or its drop-in.',
      }));
    }

    // Reported, not graded: the service shares its uid with Apache and the
    // WordPress PHP workers. That is the finding webroot-ownership-shared-fate
    // owns; repeating it as a failure here would double-bill one problem.
    checked++;
    if ((kv.get('User') || '') === 'www-data') {
      findings.push(finding({
        severity: 'info',
        title: 'ib-api runs as www-data, the same uid as Apache and WordPress PHP',
        detail: 'Recorded here as context for the sandbox properties above. The durable fix is a dedicated uid (or DynamicUser= with LoadCredential= for /etc/ib-api.env), which would also take www-data out of the picture for the secrets file. Graded by webroot-ownership-shared-fate and env-secret-file-perms, not here.',
        evidence: `systemctl show ib-api -p User → User=${kv.get('User')}`,
      }));
    }

    return { findings, checked };
  },
});
