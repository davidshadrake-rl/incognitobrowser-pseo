/**
 * Is the scanner's egress lockdown actually in force, right now, on the box?
 *
 * ## Why a nightly check and not just the script
 *
 * scripts/droplet-egress-lockdown.sh installs a per-UID iptables chain that
 * stops the ib-api process reaching the private network — the VPC this
 * droplet sits on, RFC 1918, link-local, the metadata address. It is the only
 * control that survives a DNS rebind, because it acts after fetch() has
 * resolved and connected, on the packet itself. It persists via
 * iptables-persistent.
 *
 * "Persists" is a claim about a package and a file in /etc/iptables. A
 * reboot on a box where that package failed to install, an `iptables -F` by
 * anyone debugging anything, a rebuilt droplet from a snapshot taken before
 * 2026-09-22 — every one of those reopens the window silently. The scanner
 * would keep working. Nothing would fail. That is the exact shape of failure
 * this suite exists to catch, so the rule is asserted every night by reading
 * the live table, not the file it was saved to.
 *
 * ## Why the chain's FIRST rule is asserted specifically
 *
 * The first --apply took the API down for about three minutes. OUTPUT
 * filters every packet the uid sends, including the API's REPLIES to Apache,
 * which go to 127.0.0.1:<ephemeral port> and so matched the loopback REJECT.
 * The fix is `-m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT` as rule
 * one. A chain with the REJECTs but without that rule is worse than no chain:
 * the site is down and the firewall looks applied. So this check reads the
 * chain in order and refuses to call it healthy unless that rule is at the
 * top AND an inbound request through Apache gets answered.
 */
import { check, finding } from '../lib/harness.mjs';

const CHAIN = 'IB_API_EGRESS';
const UID = '999';
/** The VPC ranges read off this box; 10/8 must be rejected for both. */
const MUST_REJECT = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '169.254.0.0/16'];

export default check({
  id: 'rasp-egress-lockdown',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'The ib-api egress chain is installed, jumps from OUTPUT for uid 999, allows established replies first, rejects the private ranges — and the API still answers through Apache.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const out = String(ctx.ssh(`
      echo "JUMP4=$(iptables  -C OUTPUT -m owner --uid-owner ${UID} -j ${CHAIN} 2>/dev/null && echo yes || echo no)"
      echo "JUMP6=$(ip6tables -C OUTPUT -m owner --uid-owner ${UID} -j ${CHAIN} 2>/dev/null && echo yes || echo no)"
      echo "---CHAIN4---"; iptables  -S ${CHAIN} 2>/dev/null || echo "NOCHAIN"
      echo "---CHAIN6---"; ip6tables -S ${CHAIN} 2>/dev/null || echo "NOCHAIN"
      echo "---INBOUND---"
      curl -s -o /dev/null -m 8 -w '%{http_code}' -H 'origin: ${ctx.origin}' ${ctx.origin}/api/ip 2>/dev/null || echo "000"
      echo
      echo "---VPC---"
      setpriv --reuid=999 --regid=988 --clear-groups curl -s -o /dev/null -m 4 http://10.116.0.2/ 2>/dev/null && echo reached || echo refused
      echo "---SAVED---"
      grep -c "${CHAIN}" /etc/iptables/rules.v4 2>/dev/null || echo 0
    `, { timeoutMs: 60_000 }));
    checked += 1;

    const section = (name) => {
      const m = new RegExp(`---${name}---\\n([\\s\\S]*?)(?=\\n---|$)`).exec(out);
      return m ? m[1].trim() : '';
    };
    const chain4 = section('CHAIN4');
    const chain6 = section('CHAIN6');
    const inbound = section('INBOUND').trim();
    const vpc = section('VPC').trim();
    const saved = Number(section('SAVED')) || 0;
    const jump4 = /JUMP4=yes/.test(out);
    const jump6 = /JUMP6=yes/.test(out);

    const rules4 = chain4.split('\n').filter((l) => l.startsWith('-A '));
    const firstIsEstablished = /ctstate (RELATED,ESTABLISHED|ESTABLISHED,RELATED)/.test(rules4[0] || '');
    const rejects = MUST_REJECT.filter((net) => !rules4.some((l) => l.includes(`-d ${net}`) && l.includes('REJECT')));

    // The API answering is the precondition for everything else being good
    // news. GET /ip is 405 by design (POST only); 000 means no answer at all.
    const apiUp = /^(200|405)$/.test(inbound);

    if (chain4 === 'NOCHAIN' || !jump4) {
      findings.push(finding({
        severity: 'high',
        title: 'The scanner egress lockdown is NOT in force',
        detail:
          `The ${CHAIN} chain is ${chain4 === 'NOCHAIN' ? 'missing' : 'present but not reached from OUTPUT for uid ' + UID}. The ib-api process can therefore reach this droplet's VPC (10.10.0.0/16, 10.116.0.0/20), the metadata address and every private range. Every code-level guard is upstream of a second DNS resolution inside fetch(), so with this rule gone a rebind walks straight into the private network. Saved rules file mentions the chain ${saved} time(s) — ${saved ? 'so it was applied once and has since been lost from the live table' : 'so it was never persisted'}.`,
        evidence: `JUMP4=${jump4} JUMP6=${jump6} · live chain: ${chain4 === 'NOCHAIN' ? 'none' : rules4.length + ' rules'} · VPC probe as uid 999: ${vpc || 'no answer'}`,
        remediation: './scripts/droplet-egress-lockdown.sh --apply, then --verify. If this recurs after a reboot, iptables-persistent is not restoring /etc/iptables/rules.v4.',
        file: 'scripts/droplet-egress-lockdown.sh',
        line: 1,
      }));
      return { findings, checked };
    }

    if (!firstIsEstablished) {
      findings.push(finding({
        severity: apiUp ? 'high' : 'critical',
        title: apiUp
          ? 'Egress chain lacks the ESTABLISHED,RELATED accept as its first rule'
          : 'Egress chain is installed without the ESTABLISHED,RELATED accept — the API is down',
        detail:
          'Rule one must accept replies on established connections, or the API cannot answer Apache and every route returns 503. That is exactly what the first --apply did on 2026-09-22. ' +
          (apiUp
            ? 'The API happens to be answering right now, which means something else is letting replies through — but the chain as written will take it down the moment that changes.'
            : `Inbound probe returned "${inbound}". The site is down and the firewall looks applied.`),
        evidence: `first rule: ${rules4[0] || '(none)'} · inbound /api/ip => ${inbound}`,
        remediation: 'Re-run ./scripts/droplet-egress-lockdown.sh --apply; the current script emits the conntrack rule first. If the API is down, --revert restores service immediately.',
        file: 'scripts/droplet-egress-lockdown.sh',
        line: 100,
      }));
    }

    if (rejects.length) {
      findings.push(finding({
        severity: 'high',
        title: `Egress chain is missing REJECT rules for ${rejects.join(', ')}`,
        detail: 'The chain exists but does not refuse every range it must. A partially applied policy looks applied and is not.',
        evidence: `missing: ${rejects.join(', ')} · live rules: ${rules4.length}`,
        remediation: './scripts/droplet-egress-lockdown.sh --apply rebuilds the chain from empty.',
        file: 'scripts/droplet-egress-lockdown.sh',
        line: 71,
      }));
    }

    if (vpc !== 'refused') {
      findings.push(finding({
        severity: 'high',
        title: 'The ib-api uid can still reach the VPC',
        detail: `A new connection from uid ${UID} to 10.116.0.2 was ${vpc || 'not clearly refused'}. The chain may be present but not matching — check that the OUTPUT jump uses -m owner --uid-owner ${UID} and that the process actually runs as that uid (systemctl show -p User ib-api).`,
        evidence: `VPC probe: ${vpc || 'no output'} · JUMP4=${jump4}`,
        remediation: 'iptables -S OUTPUT | head; systemctl show -p User -p MainPID ib-api; then --apply again.',
        file: 'scripts/droplet-egress-lockdown.sh',
        line: 146,
      }));
    }

    if (!apiUp && firstIsEstablished) {
      findings.push(finding({
        severity: 'critical',
        title: `The API is not answering through Apache (${inbound})`,
        detail: 'The egress chain looks correct, so this is probably not the firewall — but it was checked from here because the last outage was, and a green firewall on a dead service is not a pass.',
        evidence: `GET ${ctx.origin}/api/ip => ${inbound}`,
        remediation: 'systemctl status ib-api; tail /var/log/apache2/error.log.',
        file: 'API-ON-DROPLET.md',
        line: 1,
      }));
    }

    if (jump4 && !jump6) {
      findings.push(finding({
        severity: 'low',
        title: 'IPv6 egress chain is not jumped to from OUTPUT',
        detail: 'IPv4 is locked down; IPv6 is not. The box has no IPv6 VPC address today, so this is a gap in symmetry rather than a live path — but it becomes one the day IPv6 is enabled on the private interface.',
        evidence: `JUMP6=${jump6} · chain6: ${chain6 === 'NOCHAIN' ? 'none' : 'present'}`,
        remediation: './scripts/droplet-egress-lockdown.sh --apply installs both.',
        file: 'scripts/droplet-egress-lockdown.sh',
        line: 147,
      }));
    }

    if (!saved) {
      findings.push(finding({
        severity: 'medium',
        title: 'Egress chain is live but not persisted',
        detail: '/etc/iptables/rules.v4 does not mention the chain. It is in force until the next reboot and gone after it, with nothing to say so.',
        evidence: `grep -c ${CHAIN} /etc/iptables/rules.v4 => 0`,
        remediation: 'iptables-save > /etc/iptables/rules.v4 (the --apply script does this; check iptables-persistent installed).',
        file: 'scripts/droplet-egress-lockdown.sh',
        line: 149,
      }));
    }

    return { findings, checked };
  },
});
