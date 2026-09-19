/**
 * The firewall is on, denies by default, and allows only what we said.
 *
 * The runbook leans on ufw explicitly as the backstop for the bind-address
 * assumption that listening-socket-baseline grades (API-ON-DROPLET.md:284):
 * "Redis, MySQL and the Node service all bind localhost already; this is what
 * keeps that true if one of them is ever misconfigured." Two layers, and the
 * realistic way to lose both at once is mundane — someone opens 3100 to test
 * the API directly during an incident, gets their answer, and never closes it.
 * From that moment the bind address is the only thing left, and nothing
 * anywhere sends an alert about either.
 *
 * The inactive case is graded separately and first, because `ufw status` on a
 * disabled firewall prints an EMPTY rule list. A check that only diffed rules
 * would read that as "no unexpected rules" and pass with the firewall off —
 * the same shape of silent-green failure this whole suite exists to stop.
 *
 * Read-only: `ufw status verbose` reports state.
 *
 * This check DOES grade the allow list, where rasp-host-guardrails deliberately
 * does not (it grades only that the firewall is up, on the reasonable ground
 * that the rule set is the owner's to change). The two are not in conflict: a
 * rule set that changes should change scripts/security/data/cnast-droplet-baseline.json
 * in the same commit, which is the point of having a declared baseline for a
 * box that has no Terraform and no Ansible.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline } from './cnast-lib.mjs';

/**
 * ufw prints rules as `80 ALLOW IN Anywhere`, `22/tcp ALLOW IN Anywhere`,
 * `443 (v6) ALLOW IN Anywhere (v6)`. The v6 duplicates are the same rule.
 */
function parseRules(text) {
  const rules = [];
  for (const line of text.split('\n')) {
    const m = /^\s*(\S+)(\s+\(v6\))?\s+(ALLOW|DENY|REJECT|LIMIT)\s+(IN|OUT|FWD)\s+(.*)$/.exec(line);
    if (!m) continue;
    const [, target, v6, action, direction, from] = m;
    const port = Number(String(target).split('/')[0]);
    rules.push({ target, port: Number.isFinite(port) ? port : null, action, direction, from: from.trim(), v6: Boolean(v6), line: line.trim() });
  }
  return rules;
}

export default check({
  id: 'ufw-default-deny',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'ufw is active, denies inbound by default, and allows exactly the ports the baseline declares.',
  async run(ctx) {
    const want = baseline(ctx).ufw;
    const sections = droplet(ctx);
    const raw = section(ctx, sections, 'UFW');

    const findings = [];
    let checked = 0;

    // Inactive first, and return. Everything below reads an empty rule list on
    // a disabled firewall, which must never be mistaken for a clean one.
    checked++;
    if (!/^Status:\s*active/mi.test(raw)) {
      return {
        checked,
        findings: [finding({
          severity: 'high',
          title: 'ufw is not active',
          detail: 'The one control that keeps Redis, MySQL and the Node API unreachable if any of them is ever misbound is switched off. Redis on this box has no password, so that pairing is the difference between a misconfiguration and a compromise.',
          evidence: `ufw status verbose → ${raw.split('\n').slice(0, 3).join(' | ')}`,
          remediation: 'ufw --force enable, after confirming 22/tcp is allowed so the session does not lock itself out.',
        })],
      };
    }

    checked++;
    const defaults = /^Default:\s*(.*)$/mi.exec(raw);
    const incoming = defaults ? /(\w+)\s*\(incoming\)/i.exec(defaults[1]) : null;
    if (!incoming) {
      findings.push(finding({
        severity: 'medium',
        title: 'Could not read ufw\'s default inbound policy',
        detail: 'Reported rather than assumed: an unreadable default policy is an ungraded control.',
        evidence: `ufw status verbose → ${raw.split('\n').slice(0, 5).join(' | ')}`,
        remediation: 'Check by hand: ufw status verbose',
      }));
    } else if (incoming[1].toLowerCase() !== want.defaultIncoming) {
      findings.push(finding({
        severity: 'high',
        title: `ufw's default inbound policy is ${incoming[1]}, not ${want.defaultIncoming}`,
        detail: 'With a default-allow policy the rule list below stops meaning anything: every port that is not explicitly denied is open, including any future service that binds one.',
        evidence: `ufw status verbose → Default: ${defaults[1]}`,
        remediation: 'ufw default deny incoming',
      }));
    }

    const rules = parseRules(raw);
    const allowedIn = rules.filter((r) => r.action === 'ALLOW' && r.direction === 'IN');
    const ports = [...new Set(allowedIn.map((r) => r.port).filter((p) => p !== null))];

    for (const port of ports) {
      checked++;
      if (!want.allowedPorts.includes(port)) {
        findings.push(finding({
          severity: 'high',
          title: `ufw allows inbound ${port}, which the baseline does not`,
          detail: 'The most likely origin is a rule opened to debug something and never removed. If it fronts a service that also assumed it was unreachable, both layers of the localhost-binding argument are gone at once.',
          evidence: `ufw status verbose → ${allowedIn.filter((r) => r.port === port).map((r) => r.line).join(' ;; ')}`,
          remediation: `ufw delete allow ${port} — or, if it is intended, add it to ufw.allowedPorts in scripts/security/data/cnast-droplet-baseline.json in the same commit as whatever needs it.`,
        }));
      }
    }

    for (const port of want.allowedPorts) {
      checked++;
      if (!ports.includes(port)) {
        findings.push(finding({
          severity: port === 22 ? 'high' : 'medium',
          title: `ufw no longer allows inbound ${port}`,
          detail: port === 22
            ? 'Deploys and every one of these checks reach this box over ssh. A missing 22 rule is how a box locks itself out.'
            : 'Both sites are served over this port; 80 also carries the ACME challenge the certificate renewal depends on.',
          evidence: `ufw status verbose allow-in ports observed: ${ports.join(', ') || '(none)'}`,
          remediation: `ufw allow ${port}`,
        }));
      }
    }

    // A non-ALLOW rule is not graded — a hand-added DENY is someone tightening
    // things, not loosening them — but it is shown, because an unexpected rule
    // of any kind means the rule set is not what the repo says it is.
    const nonAllow = rules.filter((r) => r.action !== 'ALLOW');
    if (nonAllow.length) {
      findings.push(finding({
        severity: 'info',
        title: `${nonAllow.length} non-ALLOW ufw rule(s) present`,
        detail: 'Shown for visibility only. Denies and limits are tightening, not loosening, so they are not failures — but they are drift from the declared baseline and worth knowing about.',
        evidence: nonAllow.map((r) => r.line).join(' ;; ').slice(0, 400),
      }));
    }

    return { findings, checked };
  },
});
