/**
 * Is the Apache config on the box the one this repo describes?
 *
 * scripts/droplet-htaccess.conf says in its own header: "edit the source file,
 * never the server copy". Meanwhile scripts/droplet-server-config.sh:41 leaves
 * a timestamped `.htaccess.bak.<epoch>` in the DocumentRoot on every run, so
 * there is a growing pile of old copies sitting one `cp` away from being
 * restored. Restoring one reverts the CSP to a version that still named two
 * vercel.app origins — subdomains that become free for anyone to register once
 * that account closes, which is a ready-made exfiltration destination named in
 * our own connect-src — and drops the four `RequestHeader unset` lines that
 * make every per-IP limit meaningful.
 *
 * This is the drift that already happened once: the live CSP went on allowing
 * those two origins for three weeks after this repo stopped naming them,
 * because the guard that was supposed to catch it never opened a .conf file.
 *
 * scripts/deploy.sh:57-95 does compare the live block before deploying, which
 * is good and is not duplicated lightly — but it only runs when someone
 * deploys, and the interesting window is precisely the one where nobody is
 * deploying. A nightly comparison closes it.
 *
 * The vhost half grades directives rather than text, because the vhost is not
 * generated from anything in this repo and a hash of it would be a permanent
 * false positive.
 *
 * `apache2ctl configtest` is included for a reason the runbook states plainly
 * (API-ON-DROPLET.md:218): "A syntax error takes WordPress down with it." A
 * config that no longer parses survives until the next reload or reboot, and
 * then takes the team's site with ours. configtest parses and exits; it does
 * not reload anything.
 *
 * Deliberately NOT flagged: comment-only differences between the live block and
 * the source are graded as a separate, lower finding from directive
 * differences. Both are drift and both are reported, but conflating a stale
 * comment with a missing security directive is how a check earns a reputation
 * for crying wolf.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

/** Strip comments and blank lines: what Apache actually acts on. */
function directives(text) {
  return text.split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .filter((l) => l.trim() && !l.trim().startsWith('#'));
}

export default check({
  id: 'apache-managed-block-drift',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'The live .htaccess managed block still matches scripts/droplet-htaccess.conf, the vhost still strips forged client-IP headers and caps bodies, and the config still parses.',
  async run(ctx) {
    const base = baseline(ctx);
    const want = base.apache;
    const sections = droplet(ctx);
    const findings = [];
    let checked = 0;

    // 1. The managed block, directive by directive.
    const live = section(ctx, sections, 'HTBLOCK');
    if (!live.includes(want.managedBlockBegin) || !live.includes(want.managedBlockEnd)) {
      checked++;
      findings.push(finding({
        severity: 'high',
        title: 'The managed security-headers block is missing from the live .htaccess',
        detail: 'Without it both static sites are served with ZERO security headers — no CSP, no HSTS, no X-Frame-Options — which is exactly the state the 2026-09-08 audit found. A static export runs no Next.js server, so next.config.ts headers() never execute and this block is the only thing a browser receives.',
        evidence: `sed -n '/# BEGIN pseo-security-headers/,/# END pseo-security-headers/p' /var/www/html/.htaccess → ${live ? live.slice(0, 200) : '(empty)'}`,
        remediation: 'Run scripts/droplet-server-config.sh.',
      }));
    } else {
      const httpsHost = new URL(ctx.origin).host;
      const source = readFileSync(join(ctx.repoRoot, 'scripts/droplet-htaccess.conf'), 'utf-8')
        .replace(/__HTTPS_HOST__/g, httpsHost); // the same substitution deploy.sh:68 makes
      const wantDirectives = directives(source);
      const liveDirectives = directives(live);

      checked++;
      const missing = wantDirectives.filter((d) => !liveDirectives.includes(d));
      const extra = liveDirectives.filter((d) => !wantDirectives.includes(d));
      if (missing.length || extra.length) {
        findings.push(finding({
          severity: 'high',
          title: `The live managed block has ${missing.length} missing and ${extra.length} unexpected directive(s)`,
          detail: 'The server copy is not the source. Whatever the difference is today, the mechanism is the one that let the CSP go on naming two soon-to-be-strangers\' domains for three weeks: this file is edited in the repo and applied by a separate script that is easy to forget. scripts/deploy.sh refuses to deploy while these differ, so a deploy is currently blocked too.',
          evidence: [
            missing.length ? `MISSING from the box:\n  ${missing.join('\n  ')}` : '',
            extra.length ? `ONLY on the box:\n  ${extra.join('\n  ')}` : '',
          ].filter(Boolean).join('\n').slice(0, 900),
          remediation: 'Run scripts/droplet-server-config.sh to re-splice the block, then re-run this check.',
          file: 'scripts/droplet-htaccess.conf',
        }));
      } else {
        // Same directives, different comments: real drift, much lower stakes.
        checked++;
        if (source.trim() !== live.trim()) {
          findings.push(finding({
            severity: 'low',
            title: 'The live managed block has the right directives but stale comments',
            detail: 'Nothing a browser sees is wrong. It does mean the server copy predates the current source file, so the next person to read it on the box will be reading instructions that are no longer true — and the comments in this particular file are where the reasoning for the CSP lives.',
            evidence: `live block ${live.trim().length} bytes vs source ${source.trim().length} bytes after __HTTPS_HOST__ substitution; directives identical`,
            remediation: 'Run scripts/droplet-server-config.sh.',
            file: 'scripts/droplet-htaccess.conf',
          }));
        }
      }
    }

    // 2. The vhost directives that live outside this repo's files.
    const vhost = section(ctx, sections, 'VHOST');
    for (const directive of want.proxyVhostMustContain) {
      checked++;
      if (!vhost.includes(directive)) {
        findings.push(finding({
          severity: 'high',
          title: `The vhost no longer carries \`${directive}\``,
          detail: 'mod_proxy_http APPENDS the peer to X-Forwarded-For rather than replacing it. Without these four lines a request arriving with a forged header reaches the app as "1.2.3.4, <real peer>". The app now reads the last hop, so either control closes the hole alone — which is exactly why the runbook says to keep both (API-ON-DROPLET.md:170-172): losing one must not silently depend on the other.',
          evidence: `grep -nE 'RequestHeader unset' /etc/apache2/sites-enabled/*.conf → \n${vhost.split('\n').filter((l) => l.includes('RequestHeader')).join('\n') || '(no RequestHeader lines at all)'}`,
          remediation: 'Restore the four RequestHeader unset lines inside the :443 vhost\'s mod_proxy block, then apache2ctl configtest && systemctl reload apache2.',
        }));
      }
    }

    checked++;
    if (!vhost.includes(want.bodyCapPattern)) {
      findings.push(finding({
        severity: 'medium',
        title: 'The vhost body cap `<If "%{HTTP:Content-Length} -gt 1048576">` is gone',
        detail: 'API-ON-DROPLET.md:291-298 records that the tidier-looking LimitRequestBody is SILENTLY INERT for proxied requests — a 1.5 MB POST reached Node and was answered 200. Only this form works. Note that config text is not proof of enforcement on this box, which is why rasp-apache-body-cap probes the behaviour; this line catches the config being tidied before the behaviour changes.',
        evidence: `grep -nE 'HTTP:Content-Length' /etc/apache2/sites-enabled/*.conf → ${vhost.split('\n').filter((l) => l.includes('Content-Length')).join(' | ') || '(no match)'}`,
        remediation: 'Restore the <If> block from API-ON-DROPLET.md:170-177. Do not "restore" LimitRequestBody or a RewriteRule [R=413]; neither fires here.',
      }));
    }

    // 3. Does the config still parse?
    const configtest = section(ctx, sections, 'CONFIGTEST');
    checked++;
    if (!/Syntax OK/.test(configtest)) {
      findings.push(finding({
        severity: 'high',
        title: 'apache2ctl configtest does not report Syntax OK',
        detail: 'A config that no longer parses survives until the next reload or reboot and then takes the team\'s WordPress down with our sites — the runbook\'s own warning at API-ON-DROPLET.md:218. Finding it at 2am from a restart is much worse than finding it tonight.',
        evidence: `apache2ctl configtest → ${configtest.replace(/\n/g, ' | ').slice(0, 300)}`,
        remediation: 'Fix the named file and line before anything reloads Apache.',
      }));
    }

    // 4. The backup pile.
    const baksRaw = (sections.HTBAKS || '').trim();
    const baks = /^\d+$/.test(baksRaw) ? Number(baksRaw) : null;
    if (baks !== null) {
      checked++;
      if (baks >= want.backupFileWarnThreshold) {
        findings.push(finding({
          severity: 'low',
          title: `${baks} .htaccess.bak.* copies are sitting in the web root`,
          detail: 'droplet-server-config.sh writes one on every run and removes none. Each is a complete old security-header block, one `cp` away from being the live one — including versions whose CSP named two origins that will become registerable by strangers. They are also in a directory Apache serves, and only the stock `.ht*` rule keeps them from being fetched.',
          evidence: `ls -1 /var/www/html/.htaccess.bak.* | wc -l → ${baks} (warn at ${want.backupFileWarnThreshold})`,
          remediation: 'Keep the newest one or two and delete the rest; better, have droplet-server-config.sh write them outside the DocumentRoot.',
          file: 'scripts/droplet-server-config.sh',
          line: 41,
        }));
      }
    }

    return { findings, checked };
  },
});
