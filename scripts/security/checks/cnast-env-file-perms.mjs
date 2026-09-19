/**
 * The only two secrets in this system, and who can read them.
 *
 * /etc/ib-api.env holds ALTCHA_HMAC_KEY and STATS_TOKEN
 * (API-ON-DROPLET.md:107-117). What they are worth, precisely:
 *
 *   STATS_TOKEN       the only authentication credential that exists anywhere
 *                     in this product. Everything else is open by design.
 *   ALTCHA_HMAC_KEY   whoever holds it can mint valid proof-of-work
 *                     signatures, which skips the entire cost defence in front
 *                     of /scan-url. Losing it does not look like a breach; it
 *                     looks like the abuse controls quietly stopping.
 *
 * The file is 0640 root:www-data. www-data is also the uid the team's WordPress
 * PHP runs as, so any ordinary file-read bug over there — a traversal in a
 * plugin, a template include — hands over both. That is not a failure today; it
 * is a design that needs a decision, and it is graded as a standing warning so
 * the decision stays on the table instead of being forgotten. The durable fix
 * is systemd `LoadCredential=` (or a dedicated ib-api uid), which takes
 * www-data out of the picture entirely.
 *
 * The straightforward regression — a `chmod 644` during troubleshooting — is
 * the high-severity half.
 *
 * SECRET VALUES NEVER LEAVE THE BOX. This check runs `stat`, never `cat`. It
 * does not need to see the values to know whether they are protected, and
 * reading them would pull two production secrets into a laptop's memory and a
 * CI log for no benefit at all.
 *
 * OVERLAP: secret-droplet-env-file-perms grades the same file weekly and is
 * withheld behind --opt-in. This one runs nightly inside the shared cnast ssh
 * session, so the fast regression (0644) is caught in a day rather than a week
 * at no extra connection cost. If the two are ever consolidated, keep a nightly
 * one: a world-readable secrets file on a box shared with another application
 * is not a weekly-cadence problem.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

export default check({
  id: 'env-secret-file-perms',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: '/etc/ib-api.env is not readable beyond root — and the standing fact that www-data, the WordPress uid, can read it.',
  async run(ctx) {
    const want = baseline(ctx).paths.envFile;
    const sections = droplet(ctx);
    const own = section(ctx, sections, 'OWN');

    const line = own.split('\n').map((l) => l.trim()).find((l) => l.startsWith(`${want.path} `));
    if (!line) {
      // Absent is not "fine". Either the path moved or stat failed, and both
      // mean the protection on the only credentials in this system is unknown.
      throw new ctx.Skip(`stat produced no line for ${want.path}; observed: ${own.replace(/\n/g, ' | ').slice(0, 200)}`);
    }
    const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/.exec(line);
    if (!m) throw new ctx.Skip(`could not parse the stat line for ${want.path}: ${line}`);
    const [, , owner, group, mode] = m;

    const findings = [];
    let checked = 0;

    const digits = mode.padStart(3, '0');
    const other = Number(digits[digits.length - 1]);
    const groupBits = Number(digits[digits.length - 2]);

    checked++;
    if (other !== 0) {
      findings.push(finding({
        severity: 'critical',
        title: `${want.path} is readable by every user on the box (mode ${mode})`,
        detail: 'Both secrets are now available to any process on a host that runs another team\'s WordPress, MySQL and whatever those pull in. STATS_TOKEN is the product\'s only credential; ALTCHA_HMAC_KEY lets an attacker mint proof-of-work signatures and skip the cost defence in front of the scanner entirely.',
        evidence: `stat -c '%n %U %G %a' ${want.path} → ${owner} ${group} ${mode}`,
        remediation: `chmod 640 ${want.path} && chown root:www-data ${want.path}. Then rotate both secrets: assume they were read.`,
      }));
    }

    checked++;
    if (owner !== want.owner) {
      findings.push(finding({
        severity: 'high',
        title: `${want.path} is owned by ${owner}, not ${want.owner}`,
        detail: 'A secrets file owned by a service account can be rewritten by that service account — including its permission bits.',
        evidence: `stat -c '%n %U %G %a' ${want.path} → ${owner} ${group} ${mode}`,
        remediation: `chown ${want.owner}:${group} ${want.path}`,
      }));
    }

    checked++;
    if (groupBits !== 0 && group !== want.preferredGroup) {
      findings.push(finding({
        severity: 'medium',
        title: `${want.path} is readable by the ${group} group — the same uid as the team's WordPress`,
        detail: 'This is the current, intended arrangement and not a regression: the systemd unit runs as www-data and has to read the file. It is graded as a standing warning because the cost is real — any file-read bug in the co-hosted WordPress yields both secrets — and because a warning is what keeps the fix on the table. systemd LoadCredential= (or a dedicated ib-api uid) removes www-data from the picture without changing how the service starts.',
        evidence: `stat -c '%n %U %G %a' ${want.path} → ${owner} ${group} ${mode}`,
        remediation: 'Move the two secrets to systemd credentials: LoadCredential=ib-api-env:/etc/ib-api.env with the file 0600 root:root, or give ib-api its own uid and chown the file to it.',
      }));
    }

    return { findings, checked };
  },
});
