/**
 * One ssh session for the whole cnast discipline.
 *
 * This file exports no check. It exists because of a specific objection the
 * reviewer raised against the original design and which I agree with: eleven
 * infrastructure checks each opening their own root session to the shared
 * production box every night is eleven uses of the most privileged credential
 * in this system, to answer questions that fit in one command. The credential
 * is the same one scripts/deploy.sh uses (DEPLOY_USER=root in .secrets), and
 * the strongest finding in this discipline is precisely that too much on this
 * box runs as one uid — so the checks should not casually model the same habit.
 *
 * So: every cnast check calls `droplet(ctx)`, the first one pays for a single
 * batched read-only command, and the rest read the cached sections. The whole
 * batch is `stat`, `ss`, `ufw status`, `systemctl show`, `sshd -T`, `df`,
 * `apt-check`, `grep` and `apache2ctl configtest`. Nothing writes, nothing
 * reloads a service, nothing scans. Measured on the live box: the bounded
 * `find` that used to worry the reviewer runs in 0.01s over 1,077 entries at
 * -maxdepth 2, which is why it is still in the nightly batch — see the note in
 * cnast-webroot-ownership.mjs.
 *
 * Sections are delimited by marker lines. A missing marker means the batch did
 * not complete, and the check that wanted that section throws Skip rather than
 * reading an empty string as "nothing wrong" — the failure mode this entire
 * suite was written to stop.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHE = new WeakMap();

export function baseline(ctx) {
  return JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/cnast-droplet-baseline.json'), 'utf-8'));
}

/**
 * The batch. Every command here is read-only and cheap.
 *
 * `apache2ctl configtest` parses the configuration and exits; it does not
 * reload Apache and cannot interrupt a served request. `sshd -T` dumps the
 * effective config without starting a daemon. `apt-check` reads the cached apt
 * state — it is deliberately NOT `apt-get update`, which would hit the network
 * and take a lock on a box that also serves the team's WordPress.
 *
 * Note the `2>&1 || true` habit: a non-zero exit is often the answer (grep
 * found nothing, the file is absent), and one failing command must not
 * truncate the sections after it.
 */
const SECTIONS = [
  ['HOST', 'lsb_release -ds 2>/dev/null; uname -r'],
  ['SOCKETS', 'ss -ltnpH 2>/dev/null || ss -ltnH 2>/dev/null || echo UNAVAILABLE'],
  ['UFW', 'ufw status verbose 2>&1 || echo UNAVAILABLE'],
  ['SSHD', "sshd -T 2>/dev/null | grep -iE '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|permitemptypasswords|port|x11forwarding) ' || echo UNAVAILABLE"],
  ['FAIL2BAN', 'systemctl is-active fail2ban 2>&1; systemctl is-enabled fail2ban 2>&1'],
  ['UNIT', 'systemctl show ib-api --no-pager -p LoadState -p ActiveState -p UnitFileState -p User -p FragmentPath -p DropInPaths '
    + '-p ProtectSystem -p ProtectHome -p PrivateTmp -p NoNewPrivileges -p ReadWritePaths -p RestrictAddressFamilies '
    + '-p MemoryMax -p MemorySwapMax -p CPUQuotaPerSecUSec -p TasksMax -p LimitNOFILE -p RestartUSec -p StartLimitBurst '
    + '-p StartLimitIntervalUSec -p ExecStart -p Environment 2>&1'],
  ['OWN', "stat -c '%n %U %G %a' /var/www/html /var/www/html/resources /var/www/html/resources-pro /opt/ib-api /etc/ib-api.env 2>&1"],
  // -xdev stops it walking a mount, -maxdepth 2 stops it walking 1,400 pages or
  // node_modules. Measured at 0.01s. Its job is the shape of the tree, not a
  // full audit: if the roots are wrong, the leaves are wrong too.
  ['WRITABLE', "find /var/www/html/resources /var/www/html/resources-pro /opt/ib-api -xdev -maxdepth 2 \\( -perm -g+w -o -perm -o+w \\) -printf '%M %u:%g %p\\n' 2>/dev/null | head -25"],
  ['WRITABLECOUNT', "find /var/www/html/resources /var/www/html/resources-pro /opt/ib-api -xdev -maxdepth 2 \\( -perm -g+w -o -perm -o+w \\) 2>/dev/null | wc -l"],
  ['CONFIGTEST', 'apache2ctl configtest 2>&1 || true'],
  ['SITESENABLED', 'ls -1 /etc/apache2/sites-enabled/ 2>&1'],
  ['VHOST', "grep -nE 'RequestHeader unset|HTTP:Content-Length|SetEnvIf Request_URI|LogFormat|CustomLog|ProxyPass ' /etc/apache2/sites-enabled/*.conf 2>&1 || true"],
  ['HTBAKS', 'ls -1 /var/www/html/.htaccess.bak.* 2>/dev/null | wc -l'],
  ['HTBLOCK', "sed -n '/^# BEGIN pseo-security-headers$/,/^# END pseo-security-headers$/p' /var/www/html/.htaccess 2>/dev/null"],
  ['PATCH', '/usr/lib/update-notifier/apt-check --human-readable 2>&1 || echo UNAVAILABLE'],
  ['REBOOT', 'test -f /var/run/reboot-required && echo REBOOT_REQUIRED || echo no-reboot-required'],
  ['UNATTENDED', 'systemctl is-enabled unattended-upgrades 2>&1'],
  ['DISK', 'df -P / 2>&1'],
  ['INODES', 'df -Pi / 2>&1'],
  ['LOGROTATE', 'systemctl is-active logrotate.timer 2>&1; systemctl show logrotate.timer -p TimersCalendar --no-pager 2>&1; grep -h maxsize /etc/logrotate.d/apache2 /etc/logrotate.conf 2>/dev/null || echo NO_MAXSIZE'],
  ['APACHELOGSIZE', 'du -sm /var/log/apache2 2>/dev/null | head -1'],
  ['CERTBOT', 'systemctl is-enabled certbot.timer 2>&1; systemctl is-active certbot.timer 2>&1; systemctl show certbot.timer -p LastTriggerUSec -p NextElapseUSecRealtime --no-pager 2>&1'],
];

/**
 * Collect once per process. Throws Skip (from ctx.ssh) when there is no droplet
 * login — which the runner records as SKIPPED, never as a pass. That is the
 * "posture unchecked" behaviour the design asked for: a laptop with no .secrets
 * must not be able to report an all-clear about a box it never reached.
 */
export function droplet(ctx) {
  if (CACHE.has(ctx)) {
    const cached = CACHE.get(ctx);
    if (cached.error) throw cached.error;
    return cached.sections;
  }
  const command = SECTIONS.map(([name, cmd]) => `echo '---CNAST:${name}---'; ${cmd}`).join('; ') + "; echo '---CNAST:END---'";
  try {
    const out = String(ctx.ssh(command, { timeoutMs: 90_000 }));
    const sections = parseSections(out);
    if (!('END' in sections)) {
      // No end marker: the session died part way through. Every check that
      // wanted a section from this run must skip, because a truncated batch
      // reads exactly like a clean box.
      const err = new ctx.Skip(`droplet batch did not complete (no END marker); last 200 chars: ${out.slice(-200).replace(/\n/g, ' ')}`);
      CACHE.set(ctx, { error: err });
      throw err;
    }
    CACHE.set(ctx, { sections, raw: out });
    return sections;
  } catch (err) {
    if (err && err.isSkip) { CACHE.set(ctx, { error: err }); }
    throw err;
  }
}

function parseSections(out) {
  const sections = {};
  let current = null;
  for (const line of out.split('\n')) {
    const m = /^---CNAST:([A-Z0-9]+)---$/.exec(line.trim());
    if (m) { current = m[1]; sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  // Join at the end, so an EMPTY section stays an empty string rather than
  // disappearing. rasp-host-guardrails records what happens otherwise: a lazy
  // between-markers regex let an empty section swallow the next one and the
  // suite reported a kernel OOM kill on a box whose oom-kill count was zero.
  return Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.join('\n').trim()]));
}

/** A section, or a Skip naming which one was missing. Never an empty default. */
export function section(ctx, sections, name) {
  if (!(name in sections)) throw new ctx.Skip(`the droplet batch returned no ${name} section`);
  const value = sections[name];
  if (!value || value === 'UNAVAILABLE') {
    throw new ctx.Skip(`${name} could not be read on the droplet (command unavailable or empty output)`);
  }
  return value;
}

/** `systemctl show` output into a map. Values can contain '='; keys cannot. */
export function showProps(text) {
  const kv = new Map();
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) kv.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return kv;
}
