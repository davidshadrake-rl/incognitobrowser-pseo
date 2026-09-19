/**
 * The internal services are actually unreachable from the internet.
 *
 * NOT in the original design, added on a reviewer's argument that I agree
 * with. API-ON-DROPLET.md asserts that ufw defaults to deny inbound and that
 * Redis, MySQL and the Node service all bind localhost. Those are the two
 * sentences holding up everything else in the abuse-resistance section, and
 * nothing anywhere tests either of them. A runbook is not a control.
 *
 * What is behind those two ports is the whole system:
 *   :3100  ib-api itself — every route, with no authentication anywhere by
 *          design, because Apache's origin gate and proof-of-work sit in
 *          front. Reachable directly, all of that is bypassed.
 *   :6379  Redis — the single-use ALTCHA claim keys (SET NX), every
 *          rate-limit counter, and the dns-leak records. Redis has no
 *          password here; it does not need one while it is on loopback.
 *
 * The design dropped this under "port scanning or subdomain enumeration",
 * which is too broad a drop. Two TCP connects to two known ports on our own
 * host is not a scan, will not draw a DigitalOcean abuse flag, and cannot get
 * the deploy machine's address blocked. The line worth holding is: named
 * ports we own, never a range, never someone else's host.
 *
 * Reading the result:
 *   connected        → FINDING. The service is on the public internet.
 *   ECONNREFUSED     → the port is closed. Nothing is listening on the public
 *                      interface, which is the intended state for a loopback
 *                      bind. Not a finding, but it means ufw is not what is
 *                      stopping you — worth saying, because it is the
 *                      difference between one control and two.
 *   timeout          → the packet was dropped. That is ufw doing its job.
 */
import net from 'node:net';
import dns from 'node:dns/promises';
import { check, finding, Skip } from '../lib/harness.mjs';

const PORTS = [
  { port: 3100, what: 'ib-api (the Node service)', why: 'Every one of the seven routes, with the Apache origin gate, the proof-of-work and the per-IP limits all in front of it rather than inside it. Reached directly, none of them apply: unmetered scans, unmetered challenges, and the SSRF guard as the only thing left.' },
  { port: 6379, what: 'Redis', why: 'It holds the single-use proof-of-work claim keys, every rate-limit counter and the dns-leak records, and it has no password because it is on loopback. Anyone who can reach it can reset every counter, replay every solved token, and read what visitors tested.' },
];

function tryConnect(host, port, timeoutMs = 6_000) {
  return new Promise((resolve) => {
    let settled = false;
    const started = Date.now();
    const done = (r) => { if (!settled) { settled = true; try { s.destroy(); } catch { /* gone */ } resolve({ ...r, ms: Date.now() - started }); } };
    const s = net.connect({ host, port });
    s.setTimeout(timeoutMs, () => done({ state: 'timeout' }));
    s.on('connect', () => done({ state: 'connected' }));
    s.on('error', (e) => done({ state: 'error', code: e.code, message: String(e.message || e) }));
  });
}

export default check({
  id: 'dast-internal-ports-closed',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The Node service on 3100 and Redis on 6379 are not reachable from the public internet, which the runbook asserts and nothing else tests.',

  async run(ctx) {
    const host = new URL(ctx.origin).hostname;
    let addr;
    try {
      const r = await dns.lookup(host, { family: 4 });
      addr = r.address;
    } catch (e) {
      throw new Skip(`could not resolve ${host} to an address to probe (${e.message})`);
    }

    const findings = [];
    let checked = 0;

    for (const p of PORTS) {
      checked++;
      const r = await tryConnect(addr, p.port);
      if (r.state === 'connected') {
        findings.push(finding({
          severity: 'critical',
          title: `${p.what} is reachable from the internet on ${addr}:${p.port}`,
          detail: p.why,
          evidence: `TCP connect ${addr}:${p.port} → established in ${r.ms}ms (resolved from ${host})`,
          remediation: `On the droplet: confirm the service binds 127.0.0.1 and not 0.0.0.0 (ss -ltnp | grep ${p.port}), and that ufw is enabled with default deny incoming and only 22/80/443 allowed (ufw status verbose).`,
          file: 'API-ON-DROPLET.md',
        }));
        continue;
      }
      if (r.state === 'error' && r.code === 'ECONNREFUSED') {
        findings.push(finding({
          severity: 'info',
          title: `${addr}:${p.port} refused the connection rather than dropping it`,
          detail: 'Nothing is listening on the public interface, which is the intended state — but a refusal means the packet reached the host, so ufw is not the control that stopped it. The loopback bind is doing all the work alone. That is one control where the runbook describes two.',
          evidence: `TCP connect ${addr}:${p.port} → ECONNREFUSED in ${r.ms}ms`,
          remediation: 'Check `ufw status verbose` on the droplet: default deny incoming should drop these, not refuse them.',
          file: 'API-ON-DROPLET.md',
        }));
      }
    }

    return { findings, checked };
  },
});
