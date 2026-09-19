/**
 * Can the WordPress uid rewrite our pages and our API's code?
 *
 * This is the structural weakness of the whole deployment, and it is not
 * hypothetical: one 2-vCPU droplet runs the team's WordPress and MySQL, both
 * static sites, and the ib-api service, and Apache's workers, WordPress's PHP
 * and the Node service all run as www-data.
 *
 * Three lines put it there, all doing the same well-meant thing:
 *   scripts/deploy.sh:133               chown -R www-data:www-data resources resources-pro
 *   scripts/deploy-api.sh:95            chown -R www-data:www-data /opt/ib-api
 *   scripts/droplet-server-config.sh:30-31   the same for both web roots
 *
 * What that buys an attacker who finds an ordinary WordPress file-write bug — a
 * plugin upload flaw, the classic one — is not a defaced blog. It is write
 * access to ~1,400 pages served with `script-src 'self' 'unsafe-inline'`, and
 * write access to /opt/ib-api/.next/server/app/scan-url/route.js, which systemd
 * then executes on the next restart. The blast radius of someone else's CMS
 * becomes our privacy product.
 *
 * Static files never need to be writable by the process serving them. Read is
 * enough. The target state in the baseline is root:www-data, 755/644, which is
 * three one-word edits to those three chown lines.
 *
 * ON PRODUCTION SAFETY. The reviewer flagged this check as mismarked safe,
 * because the design ran an unbounded recursive `find` across two ~1,400-page
 * trees plus /opt/ib-api/node_modules every night on a box shared with MySQL.
 * That objection was right about the design and is answered rather than
 * ignored: the walk is now `-xdev -maxdepth 2`, and it shares the single ssh
 * session in cnast-lib.mjs with every other cnast check. Measured on the live
 * box before shipping: 0.01s wall, 0.00s user, 0.00s sys over 1,077 entries.
 * That is less work than one page load, so it stays in the nightly run — a
 * high-severity finding that only fires when someone remembers to pass
 * --opt-in is not a control. If that measurement ever stops holding, narrow it
 * to the `stat` half rather than withholding the check.
 *
 * Deliberately NOT flagged: files under /var/www/html itself. The shared root
 * and everything else in it is the other site's, we have no authority over it,
 * and grading it would produce findings nobody here can fix — the reason
 * wpscan and the WordPress backup check were both dropped from this discipline.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

export default check({
  id: 'webroot-ownership-shared-fate',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'Our static pages and the API\'s code are not owned or writable by www-data — the same uid the team\'s WordPress runs as.',
  async run(ctx) {
    const base = baseline(ctx);
    const sections = droplet(ctx);
    const own = section(ctx, sections, 'OWN');

    const stats = new Map();
    for (const line of own.split('\n')) {
      const m = /^(\S+)\s+(\S+)\s+(\S+)\s+(\d+)$/.exec(line.trim());
      if (m) stats.set(m[1], { owner: m[2], group: m[3], mode: m[4] });
    }
    if (!stats.size) throw new ctx.Skip(`stat returned nothing parseable: ${own.slice(0, 200)}`);

    const findings = [];
    let checked = 0;

    for (const want of base.paths.roots) {
      const got = stats.get(want.path);
      if (!got) {
        checked++;
        findings.push(finding({
          severity: 'high',
          title: `${want.path} does not exist on the droplet`,
          detail: 'One of the three trees this product is served from is missing. Either the deploy target moved or something removed it; either way the posture below could not be graded.',
          evidence: `stat -c '%n %U %G %a' ${want.path} → not present in: ${own.replace(/\n/g, ' | ').slice(0, 200)}`,
          remediation: 'Confirm DEPLOY_HOST, then redeploy.',
        }));
        continue;
      }
      checked++;
      if (got.owner === 'www-data') {
        findings.push(finding({
          severity: 'high',
          title: `${want.path} is owned by www-data — the WordPress uid can rewrite it`,
          detail: want.path.startsWith('/opt')
            ? 'This is the API\'s own code. A file-write bug anywhere in the co-hosted WordPress rewrites .next/server/app/*/route.js, and systemd executes it on the next restart. The service that fetches attacker-supplied URLs is the worst possible thing to leave writable by another application.'
            : 'These pages are served with script-src \'self\' \'unsafe-inline\'. A file-write bug in the co-hosted WordPress — a plugin upload flaw is the usual one — therefore becomes stored script execution on a privacy product, with no bug of our own involved.',
          evidence: `stat -c '%n %U %G %a' ${want.path} → ${got.owner} ${got.group} ${got.mode} (expected ${want.owner} ${want.group} ${want.mode})`,
          remediation: `Change the three deploy chowns to root:www-data (scripts/deploy.sh:133, scripts/deploy-api.sh:95, scripts/droplet-server-config.sh:30-31) and run: chown -R root:www-data ${want.path}. Apache only needs read.`,
          file: 'scripts/deploy.sh',
          line: 133,
        }));
      } else if (got.owner !== want.owner) {
        findings.push(finding({
          severity: 'medium',
          title: `${want.path} is owned by ${got.owner}, not ${want.owner}`,
          detail: 'Not the www-data case, but not the declared posture either, so something outside the deploy scripts has touched it.',
          evidence: `stat -c '%n %U %G %a' ${want.path} → ${got.owner} ${got.group} ${got.mode} (expected ${want.owner} ${want.group} ${want.mode})`,
          remediation: `chown -R ${want.owner}:${want.group} ${want.path}`,
        }));
      }
    }

    // The bounded walk. Group-writable matters even once the owner is root,
    // because www-data is the group on all three trees by design (Apache needs
    // to read them).
    const writable = sections.WRITABLE ?? '';
    const countRaw = (sections.WRITABLECOUNT || '').trim();
    const count = /^\d+$/.test(countRaw) ? Number(countRaw) : null;
    if (count === null) {
      findings.push(finding({
        severity: 'info',
        title: 'The bounded writability walk did not report a count',
        detail: 'Reported rather than treated as zero. A walk that produced no answer has proved nothing about the tree.',
        evidence: `find ... -maxdepth 2 -perm -g+w -o -perm -o+w | wc -l → ${JSON.stringify(countRaw)}`,
      }));
    } else {
      checked += 1;
      if (count > 0) {
        findings.push(finding({
          severity: 'medium',
          title: `${count} file(s) in the served trees are group- or world-writable`,
          detail: 'Separate from ownership: even with root as the owner, a group-writable file under a tree whose group is www-data is writable by the web user. rsync preserves the mode bits from the machine that built the files, which is the usual way these arrive.',
          evidence: `find /var/www/html/resources /var/www/html/resources-pro /opt/ib-api -xdev -maxdepth 2 \\( -perm -g+w -o -perm -o+w \\) → ${count} hit(s):\n${writable.slice(0, 600)}`,
          remediation: 'Add --chmod=D755,F644 to the deploy rsyncs, or run: find <root> -type f -exec chmod 644 {} \\; -o -type d -exec chmod 755 {} \\;',
        }));
      }
    }

    return { findings, checked };
  },
});
