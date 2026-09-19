/**
 * Disk headroom, inodes, and the rotation that is supposed to protect them.
 *
 * The runbook names the scenario in one line (API-ON-DROPLET.md:288): "A flood
 * filling the disk between nightly rotations. A full disk takes MySQL down."
 * The mitigation is two ordinary pieces of system configuration — `maxsize
 * 200M` in the logrotate config and an hourly timer instead of a daily one —
 * and both are the kind of thing a package upgrade reverts without a word.
 *
 * 80 GB sounds like a great deal of room until api.log and the vhost access log
 * are being filled by somebody hammering an open, unauthenticated API. And the
 * consequence lands on the wrong service: MySQL failing on a full disk is a
 * WordPress outage, not a tools outage. The tools would keep answering.
 *
 * Inodes are measured as well as bytes, because they run out independently and
 * a static site export is hundreds of thousands of small files. A box can be at
 * 9% of its bytes and out of inodes.
 *
 * Read-only: `df`, `systemctl is-active`, one grep, one `du -sm`.
 *
 * OVERLAP: rasp-host-guardrails also watches ufw, the logrotate timer and disk
 * headroom, and it grades the timer's merged TimersCalendar, which is the
 * better way to read the hourly setting — the drop-in resets the vendor's
 * OnCalendar with an empty assignment first, so reading the file gets the stale
 * daily value. This check does not try to re-litigate that. What it adds is the
 * `maxsize` half (the timer firing hourly is useless if rotation only triggers
 * on size and the size directive is gone), inodes, and the Apache log directory
 * as a named number so growth is visible before it is a problem.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

/** `df -P` / `df -Pi`: one header line, then the filesystem. Capacity is column 5. */
function parseDf(text) {
  const rows = text.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  if (!rows.length) return null;
  const cols = rows[0].split(/\s+/);
  if (cols.length < 6) return null;
  const pct = Number(String(cols[4]).replace('%', ''));
  return Number.isFinite(pct) ? { filesystem: cols[0], used: cols[2], available: cols[3], percent: pct, mount: cols[5], line: rows[0] } : null;
}

export default check({
  id: 'disk-and-logrotate-headroom',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'The root filesystem has bytes and inodes to spare, and log rotation is still bounded by size — the pair that stops an API flood from taking MySQL down.',
  async run(ctx) {
    const want = baseline(ctx).disk;
    const sections = droplet(ctx);
    const findings = [];
    let checked = 0;

    const bytes = parseDf(section(ctx, sections, 'DISK'));
    const inodes = parseDf(section(ctx, sections, 'INODES'));
    if (!bytes && !inodes) throw new ctx.Skip(`df returned nothing parseable: ${(sections.DISK || '').slice(0, 160)}`);

    for (const [label, row, limit] of [['bytes', bytes, want.maxUsedPercent], ['inodes', inodes, want.maxInodeUsedPercent]]) {
      if (!row) {
        findings.push(finding({
          severity: 'medium',
          title: `Could not read ${label} usage for /`,
          detail: 'Reported rather than skipped past: an unreadable df is an ungraded control on the resource whose exhaustion takes the database down.',
          evidence: `df -P${label === 'inodes' ? 'i' : ''} / → ${(label === 'inodes' ? sections.INODES : sections.DISK || '').replace(/\n/g, ' | ').slice(0, 200)}`,
        }));
        continue;
      }
      checked++;
      if (row.percent >= limit) {
        findings.push(finding({
          severity: row.percent >= 95 ? 'high' : 'medium',
          title: `/ is ${row.percent}% full (${label})`,
          detail: `A full root filesystem takes MySQL down, which is the team's WordPress rather than our tools — the tools would keep answering while the site that pays the bills does not. Threshold ${limit}%.`,
          evidence: `df -P${label === 'inodes' ? 'i' : ''} / → ${row.line}`,
          remediation: 'Check /var/log/apache2 and /var/log/journal first; both grow under a flood. Then verify logrotate ran: journalctl -u logrotate --since "-2 days".',
        }));
      }
    }

    // Rotation. The timer's cadence is rasp-host-guardrails' to grade; the
    // size bound is graded here, because an hourly timer that rotates only on
    // age still lets one bad hour fill the disk.
    const logrotate = section(ctx, sections, 'LOGROTATE');
    checked++;
    if (!/^active/m.test(logrotate)) {
      findings.push(finding({
        severity: 'high',
        title: 'logrotate.timer is not active',
        detail: 'Nothing is rotating the logs. Under any sustained traffic — legitimate or not — api.log and access.log grow until the filesystem is full, and the first thing to fail is the database.',
        evidence: `systemctl is-active logrotate.timer → ${logrotate.split('\n')[0] || '(empty)'}`,
        remediation: 'systemctl enable --now logrotate.timer',
      }));
    }

    checked++;
    if (want.logrotateMaxsizeRequired && !/maxsize/i.test(logrotate)) {
      findings.push(finding({
        severity: 'medium',
        title: 'No `maxsize` directive in the Apache logrotate configuration',
        detail: 'Without a size bound, rotation happens on a schedule alone, so the protection is only as good as the gap between runs — which is the exact window the runbook describes: "a flood filling the disk between nightly rotations". maxsize 200M turns the hourly timer into a real cap.',
        evidence: `grep -h maxsize /etc/logrotate.d/apache2 /etc/logrotate.conf → ${logrotate.split('\n').filter((l) => /maxsize|NO_MAXSIZE/.test(l)).join(' | ') || '(no match)'}`,
        remediation: 'Add `maxsize 200M` to /etc/logrotate.d/apache2 and confirm the hourly timer per API-ON-DROPLET.md:288.',
      }));
    }

    // Growth, as a number rather than a verdict. Worth having in the record
    // every night so an abnormal week is visible as a trend, not a surprise.
    const logsMb = /^(\d+)/.exec((sections.APACHELOGSIZE || '').trim());
    if (logsMb) {
      findings.push(finding({
        severity: Number(logsMb[1]) > 2048 ? 'low' : 'info',
        title: `/var/log/apache2 is ${logsMb[1]} MB`,
        detail: 'Context for the headroom numbers above. A sudden jump here is what a flood looks like from the disk\'s point of view, and it is the first place to look when / starts filling.',
        evidence: `du -sm /var/log/apache2 → ${(sections.APACHELOGSIZE || '').trim()}`,
      }));
    }

    return { findings, checked };
  },
});
