/**
 * A forged client-IP header must not steer the rate limiter (live).
 *
 * Every per-IP limit on all seven routes was bypassable by rotating one header
 * until 2026-09-18. It is now held closed by TWO controls in two places:
 *
 *   1. the vhost's `RequestHeader unset X-Forwarded-For` (and three siblings),
 *      API-ON-DROPLET.md:173-176;
 *   2. getClientIP taking the LAST X-Forwarded-For hop, lib/rate-limit.ts:328-339,
 *      because mod_proxy_http appends the real peer rather than replacing the
 *      header.
 *
 * Either control closes it alone. The first one is NOT IN THIS REPO — it lives
 * in /etc/apache2/sites-available on the droplet and is restored from backups.
 * Restoring an old vhost, rebuilding the box, or putting a CDN in front
 * silently drops it, and no test in this repository can see that. The runbook
 * already prescribes this exact curl as a manual post-change step
 * (API-ON-DROPLET.md:208-211), and manual steps do not get done.
 *
 * WHAT THIS DOES NOT PROBE, having been cut down on review. The original design
 * sent five headers. Four of them cannot fail: getClientIP reads only
 * x-forwarded-for, cf-connecting-ip and x-real-ip, so true-client-ip and
 * Forwarded prove nothing whatever the vhost does; and mod_proxy_http always
 * appends to X-Forwarded-For, so the cf-connecting-ip and x-real-ip branches
 * (which are consulted only when no XFF exists) are unreachable in production
 * by construction. Rows that cannot fail are how a team learns to skim a report.
 * What is left is the XFF row, a multi-hop row that grades the last-hop rule
 * specifically, and a control.
 *
 * Cost: three POSTs to /api/ip against a 60/minute bucket, no state written,
 * no outbound scan. Safe to run nightly.
 */
import { check, finding, Skip } from '../lib/harness.mjs';

const FORGED = '1.2.3.4';
const FORGED_SECOND_HOP = '5.6.7.8';

/**
 * The /24 the address sits in — which is what actually matters, because
 * getIpBucket rate-limits by network and not by address.
 *
 * The comparison is by NETWORK and not by exact address on purpose. The first
 * version of this check asserted that every response echoed an identical IP,
 * and it reported a high-severity bypass on its first real run: the machine it
 * ran from egresses through a rotating pool, so three requests legitimately
 * came back 185.192.16.143, .158 and .112. Nothing was wrong. A check that
 * goes red because the person running it is behind a VPN is a check that gets
 * switched off, and this one guards a control with no other test in the repo.
 */
function net24(ip) {
  if (typeof ip !== 'string') return null;
  const m = /^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/.exec(ip);
  return m ? m[1] : ip; // IPv6 and anything unexpected compare as themselves
}

export default check({
  id: 'live-xff-spoof-rejected',
  discipline: 'api',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The live API derives the rate-limiting client IP from the proxy, not from a header the caller sent.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const post = (headers) => ctx.http(`${ctx.apiBase}/ip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.origin, ...headers },
      body: '{}',
      timeoutMs: 15_000,
    });

    // TWO controls, not one. They establish what this machine's real peer
    // address looks like from the server's side, and — because that address
    // may rotate — which /24 it rotates within.
    const controls = [];
    for (let i = 0; i < 2; i++) {
      const res = await post({});
      if (!res.ok) throw new Skip(`${ctx.apiBase}/ip unreachable: ${res.error}`);
      if (res.status === 429) throw new Skip('the /ip bucket is already at its limit; rerun rather than record a pass');
      if (res.status !== 200 || !res.json || typeof res.json.ip !== 'string') {
        throw new Skip(`${ctx.apiBase}/ip answered ${res.status} without an ip field; nothing to compare forged headers against`);
      }
      controls.push(res.json.ip);
      checked += 1;
    }
    if (controls.includes(FORGED) || controls.includes(FORGED_SECOND_HOP)) {
      // Vanishingly unlikely, and it would make every comparison below vacuous.
      throw new Skip(`this machine's own egress address is one of the values this check forges (${controls.join(', ')})`);
    }
    const controlNets = new Set(controls.map(net24));

    const CASES = [
      { label: 'x-forwarded-for: 1.2.3.4', headers: { 'x-forwarded-for': FORGED },
        why: 'the header the vhost strips and the one mod_proxy_http appends to' },
      { label: 'x-forwarded-for: 1.2.3.4, 5.6.7.8', headers: { 'x-forwarded-for': `${FORGED}, ${FORGED_SECOND_HOP}` },
        why: 'grades the last-hop rule specifically: with the vhost strip gone, only reading the RIGHTMOST entry still refuses this' },
    ];

    for (const c of CASES) {
      const res = await post(c.headers);
      checked += 1;
      if (!res.ok) {
        throw new Skip(`${c.label}: request failed (${res.error}) after the controls succeeded — partial result, not a pass`);
      }
      if (res.status === 429) {
        throw new Skip(`${c.label}: 429 from the /ip bucket; rerun when the minute rolls over rather than recording a pass`);
      }
      const seen = res.json && res.json.ip;

      // The precise signal. If the vhost strip is gone AND getClientIP reads
      // the leftmost hop, the answer is literally 1.2.3.4; if it reads the
      // second-from-right, it is 5.6.7.8. Either is the bypass.
      const tookTheForgery = seen === FORGED || seen === FORGED_SECOND_HOP;
      // The secondary signal: even an address we did not name is a bypass if
      // it moved the rate-limit bucket out of the network our own connections
      // actually come from.
      const movedNetwork = !tookTheForgery && controlNets.size === 1 && !controlNets.has(net24(seen));

      if (!tookTheForgery && !movedNetwork) continue;

      findings.push(finding({
        severity: 'high',
        title: 'A client-supplied header changed the IP the live API rate-limits by',
        detail:
          `${c.why}. Both controls that close this are now absent or ineffective: the vhost's RequestHeader unset lines and getClientIP's last-hop rule. With the bucket under the caller's control, every per-IP limit on all seven routes is bypassable by rotating one header — including the 10 scans/minute that bounds outbound fetches from a box that also serves the team's WordPress and MySQL. The likeliest cause is not a code change: it is a restored vhost backup, a rebuilt droplet, or a CDN newly placed in front.`,
        evidence: `POST ${ctx.apiBase}/ip with ${c.label} => ${res.status}, ip=${JSON.stringify(seen)}; two control requests with no such header reported ${controls.map((x) => JSON.stringify(x)).join(' and ')} (network${controlNets.size > 1 ? 's' : ''} ${[...controlNets].join(', ')})`,
        remediation: 'Restore the four `RequestHeader unset` lines in the :443 vhost (API-ON-DROPLET.md:173-176), `apache2ctl configtest`, reload. If a CDN or load balancer was added deliberately, that block must change instead — the real client address then arrives in those headers and stripping them blinds every per-IP limit.',
        file: 'API-ON-DROPLET.md',
        line: 173,
      }));
    }

    return { findings, checked };
  },
});
