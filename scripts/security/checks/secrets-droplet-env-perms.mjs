/**
 * Where the three secrets we do NOT hold locally actually live.
 *
 * REDIS_URL, ALTCHA_HMAC_KEY and STATS_TOKEN exist only on the droplet, in
 * /etc/ib-api.env, loaded by the ib-api systemd unit. API-ON-DROPLET.md says
 * that file is "readable only by root and www-data" — and nothing enforces it.
 * A `chmod 644` during troubleshooting is one keystroke and leaves no trace.
 *
 * That matters more here than it would on a dedicated host. The same box runs
 * the team's WordPress and MySQL under the same Apache and the same uid. Any
 * low-privilege code execution through the WordPress stack — a plugin bug, an
 * upload handler, a stale theme — reads a world-readable /etc/ib-api.env. And
 * ALTCHA_HMAC_KEY is what makes the proof-of-work on /scan-url unforgeable, on
 * an API that has no auth anywhere by design. Losing it does not look like a
 * breach; it looks like the abuse controls quietly stopping.
 */
import { check, finding, Skip } from '../lib/harness.mjs';

export default check({
  id: 'secret-droplet-env-file-perms',
  discipline: 'secrets',
  cadence: 'weekly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: true,
  requires: ['ssh'],
  describe: '/etc/ib-api.env stays 0640 root:www-data, and no env file has been left inside /opt/ib-api.',
  /**
   * Read-only by construction: one `stat`, one `find`, one `ls`. No writes, no
   * service restart, no `cat` of the file itself — this check never needs to
   * see the values to know whether they are protected, and reading them would
   * pull three production secrets into a laptop's process memory and a CI log
   * for no benefit.
   *
   * The second half covers a different route to the same exposure.
   * scripts/deploy-api.sh rsyncs the repo's build output into /opt/ib-api and
   * then chowns the whole tree to www-data. An .env that found its way into
   * that directory would be handed to the web user by the deploy itself.
   */
  async run(ctx) {
    // One ssh round trip. Sections are separated by markers so a partial
    // response cannot be misread as a pass.
    const script = [
      'echo ---MODE---',
      "stat -c '%a %U %G' /etc/ib-api.env 2>&1 || echo MISSING",
      'echo ---STRAY---',
      "find /opt/ib-api -maxdepth 2 \\( -name '.env*' -o -name '.secrets*' -o -name '*.pem' -o -name 'id_rsa' -o -name 'id_ed25519' \\) 2>/dev/null",
      'echo ---END---',
    ].join('; ');

    const out = ctx.ssh(script, { timeoutMs: 30_000 }); // throws Skip when there is no droplet login
    if (!out.includes('---END---')) {
      throw new Skip(`ssh returned an incomplete response (no end marker): ${out.trim().slice(0, 160)}`);
    }

    const modeBlock = out.split('---MODE---')[1].split('---STRAY---')[0].trim();
    const strayBlock = out.split('---STRAY---')[1].split('---END---')[0].trim();

    const findings = [];
    let checked = 0;

    checked += 1;
    const m = /^([0-7]{3,4})\s+(\S+)\s+(\S+)$/.exec(modeBlock);
    if (!m) {
      findings.push(finding({
        severity: 'medium',
        title: '/etc/ib-api.env could not be inspected',
        detail:
          'stat returned something this check cannot read — the file may be missing, or the deploy user may no longer be able to see it. '
          + 'Either way the permissions on the file holding ALTCHA_HMAC_KEY, STATS_TOKEN and REDIS_URL are currently unverified, which is not the same as fine.',
        evidence: `ssh: stat -c '%a %U %G' /etc/ib-api.env → ${JSON.stringify(modeBlock.slice(0, 200))}`,
        remediation: 'Check the file exists and that the deploy user can stat it: `ssh <droplet> "ls -l /etc/ib-api.env"`.',
        file: '/etc/ib-api.env',
      }));
    } else {
      const [, modeRaw, owner, group] = m;
      const mode = modeRaw.length === 4 ? modeRaw.slice(1) : modeRaw;
      const other = Number(mode[2]);
      if (other !== 0) {
        findings.push(finding({
          severity: 'high',
          title: `/etc/ib-api.env is readable beyond root and www-data (mode ${mode})`,
          detail:
            'The "other" permission bits are not zero, so every local account on this box can read the file. '
            + 'That box also runs the team\'s WordPress and MySQL, so this hands ALTCHA_HMAC_KEY and STATS_TOKEN to anything that gets even low-privilege execution through the WordPress stack. '
            + 'With the ALTCHA key, the proof-of-work gating /scan-url can be forged offline and the API\'s main abuse control stops meaning anything.',
          evidence: `ssh: stat -c '%a %U %G' /etc/ib-api.env → ${modeBlock}`,
          remediation: 'chmod 640 /etc/ib-api.env && chown root:www-data /etc/ib-api.env, then rotate ALTCHA_HMAC_KEY and STATS_TOKEN — assume they were read.',
          file: '/etc/ib-api.env',
        }));
      } else if (Number(mode[1]) > 4) {
        findings.push(finding({
          severity: 'medium',
          title: `/etc/ib-api.env is group-writable (mode ${mode})`,
          detail:
            'The group can write the file, so anything running as www-data can rewrite the API\'s environment — point REDIS_URL elsewhere, replace ALTCHA_HMAC_KEY with a known value. '
            + 'www-data is also the WordPress user on this box.',
          evidence: `ssh: stat -c '%a %U %G' /etc/ib-api.env → ${modeBlock}`,
          remediation: 'chmod 640 /etc/ib-api.env',
          file: '/etc/ib-api.env',
        }));
      }
      if (owner !== 'root' || group !== 'www-data') {
        findings.push(finding({
          severity: 'medium',
          title: `/etc/ib-api.env ownership drifted to ${owner}:${group}`,
          detail:
            'API-ON-DROPLET.md documents root:www-data — root owns it, the service group reads it. Different ownership usually means a wider reader set than intended, '
            + 'and it is the kind of change a troubleshooting session leaves behind.',
          evidence: `ssh: stat -c '%a %U %G' /etc/ib-api.env → ${modeBlock} (expected owner root, group www-data)`,
          remediation: 'chown root:www-data /etc/ib-api.env',
          file: '/etc/ib-api.env',
        }));
      }
    }

    checked += 1;
    const strays = strayBlock.split('\n').map((s) => s.trim()).filter(Boolean).filter((s) => s.startsWith('/'));
    if (strays.length) {
      findings.push(finding({
        severity: 'high',
        title: `${strays.length} env or key file left inside /opt/ib-api`,
        detail:
          'scripts/deploy-api.sh rsyncs build output into /opt/ib-api and then chowns the whole tree to www-data. '
          + 'An env file or private key sitting there is therefore readable by the web user on a box that also serves WordPress, '
          + 'and it is not managed by anything — no deploy will ever remove it.',
        evidence: `ssh: find /opt/ib-api -maxdepth 2 ... → ${strays.join(', ')}`,
        remediation: 'Remove the files. The service reads its environment from /etc/ib-api.env via the systemd unit; nothing under /opt/ib-api should hold credentials.',
      }));
    }

    return { checked, findings };
  },
});
