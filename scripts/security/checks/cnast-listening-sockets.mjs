/**
 * Nothing but 22, 80 and 443 answers from outside.
 *
 * Three services on this box are safe only because of where they bind, and all
 * three lose that the same way — an edit to one line:
 *
 *   Redis   API-ON-DROPLET.md:94, "Redis binds to 127.0.0.1 by default on
 *           Ubuntu. Leave it that way." It has no password. A redis-server
 *           package upgrade that restores the stock redis.conf, or a debugging
 *           edit that never got reverted, puts an unauthenticated Redis on the
 *           public internet, which is a full compromise of the box — including
 *           the single-use proof-of-work tokens and every rate-limit counter.
 *   MySQL   the team's WordPress database.
 *   ib-api  pinned to -H 127.0.0.1 (API-ON-DROPLET.md:135). A hand edit to
 *           0.0.0.0 bypasses every Apache-level control at once: the 1 MiB body
 *           cap, the four RequestHeader unset lines, and the no-IP logging that
 *           is the product's privacy promise. Nothing in the app would notice,
 *           because nothing in the app knows Apache exists.
 *
 * This is the replacement for an external port scan, and it is strictly better:
 * it sees the bind address rather than guessing from outside, it cannot be
 * confused by a developer network's transparent proxy (which the reviewer
 * measured reporting a completed connection to example.com:8080), and it puts
 * no traffic on the box at all. The one thing it cannot see is a DigitalOcean
 * cloud firewall disagreeing with the host, which is a one-time question for
 * the DO console rather than a nightly job.
 *
 * Read-only: `ss -ltnp` lists sockets.
 *
 * Deliberately NOT a failure: a new LOOPBACK listener. New local services are
 * ordinary, and grading them would fight with legitimate work on a box we share
 * with another team's site. A new loopback port is reported as info so it is
 * visible; a new PUBLIC one is a finding, because that is not ordinary.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

/**
 * ss prints local addresses as 0.0.0.0:22, *:443, [::]:22, [::1]:6379 and
 * 127.0.0.53%lo:53. Split on the LAST colon, because IPv6 is full of them.
 */
function parseSockets(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    const cols = line.trim().split(/\s+/);
    if (cols.length < 4) continue;
    // `ss -ltnH` (no -p) has no State column repeated; both forms put the local
    // address in the 4th column when the header is suppressed.
    const local = cols[3];
    const idx = local.lastIndexOf(':');
    if (idx < 0) continue;
    const addr = local.slice(0, idx);
    const port = Number(local.slice(idx + 1));
    if (!Number.isFinite(port)) continue;
    const bare = addr.replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    const loopback = bare.startsWith('127.') || bare === '::1' || bare === '::ffff:127.0.0.1';
    const process = cols.slice(4).join(' ');
    rows.push({ addr, bare, port, loopback, process, line: line.trim() });
  }
  return rows;
}

export default check({
  id: 'listening-socket-baseline',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'Redis, MySQL and the Node API still bind loopback only, and nothing unexpected answers on a public address.',
  async run(ctx) {
    const want = baseline(ctx).sockets;
    const sections = droplet(ctx);
    const raw = section(ctx, sections, 'SOCKETS');
    const rows = parseSockets(raw);
    if (!rows.length) throw new ctx.Skip(`ss returned no parseable listening sockets: ${raw.slice(0, 200)}`);

    const findings = [];
    let checked = 0;

    // 1. The three (four, counting MySQL X) that must never face outward.
    for (const entry of want.mustBeLoopbackOnly) {
      checked++;
      const exposed = rows.filter((r) => r.port === entry.port && !r.loopback);
      if (exposed.length) {
        findings.push(finding({
          severity: 'critical',
          title: `${entry.port} is listening on a public address`,
          detail: entry.what,
          evidence: `ss -ltnp → ${exposed.map((r) => r.line).join(' ;; ')}`,
          remediation: entry.port === 6379
            ? 'Set `bind 127.0.0.1 ::1` in /etc/redis/redis.conf and restart redis-server. Check ufw at the same time — both layers should have held.'
            : `Rebind ${entry.port} to 127.0.0.1 and restart the service.`,
        }));
      }
    }

    // 2. Anything ELSE facing outward. This is the part that catches a service
    //    nobody told us about.
    const publicRows = rows.filter((r) => !r.loopback);
    for (const r of publicRows) {
      if (want.publicPortsAllowed.includes(r.port)) continue;
      if (want.mustBeLoopbackOnly.some((e) => e.port === r.port)) continue; // already reported above
      checked++;
      findings.push(finding({
        severity: 'high',
        title: `An unexpected service answers on public port ${r.port}`,
        detail: `The declared public surface of this box is ${want.publicPortsAllowed.join(', ')}. Anything else is either a service nobody recorded or a debugging listener left behind, and on a host that also serves the team's WordPress neither is acceptable without a decision.`,
        evidence: `ss -ltnp → ${r.line}`,
        remediation: 'Identify the process, then either bind it to 127.0.0.1 or record it in scripts/security/data/cnast-droplet-baseline.json with a reason.',
      }));
    }

    // 3. The expected public ports are actually up. A missing 443 here is the
    //    site being down, and it is worth one line.
    for (const port of want.publicPortsAllowed) {
      checked++;
      if (!rows.some((r) => r.port === port && !r.loopback)) {
        findings.push(finding({
          severity: port === 22 ? 'medium' : 'high',
          title: `Nothing is listening on public port ${port}`,
          detail: port === 22
            ? 'sshd is not answering on a public address, which is how this box is administered and deployed to.'
            : 'Apache is not listening on a port both sites depend on. Port 80 also carries the ACME challenge that renews the certificate.',
          evidence: `ss -ltnp → no public listener on ${port}. Observed: ${rows.map((r) => `${r.addr}:${r.port}`).join(' ')}`,
          remediation: 'systemctl status apache2 ssh',
        }));
      }
    }

    // 4. New loopback services, as visible context rather than a verdict.
    const newLocal = [...new Set(rows.filter((r) => r.loopback && !want.knownLoopbackPorts.includes(r.port)).map((r) => r.port))];
    if (newLocal.length) {
      findings.push(finding({
        severity: 'info',
        title: `New loopback listener(s): ${newLocal.join(', ')}`,
        detail: 'Not a failure — local services come and go. Reported so a new one is a decision rather than a discovery, since the next question after "what is that" is usually "does ufw still cover it".',
        evidence: `ss -ltnp → ${rows.filter((r) => newLocal.includes(r.port)).map((r) => r.line).join(' ;; ')}`,
        remediation: 'Add the port to knownLoopbackPorts in cnast-droplet-baseline.json once it is understood.',
      }));
    }

    return { findings, checked };
  },
});
