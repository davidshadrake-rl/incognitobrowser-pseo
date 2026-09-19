/**
 * A forged client-address header must not become the client address.
 *
 * Every per-IP control on this API — 10 scans/min, 30 challenges/min, the /ip
 * and /event and dns-leak buckets — keys off one function, and there is no
 * account or API key behind any of it. If an inbound header can set that key,
 * rotating one header value defeats all of them at once on a box that also
 * serves the team's WordPress and MySQL on 2 vCPU.
 *
 * ON THE RATIONALE, HONESTLY. The design that proposed this check called it
 * critical on the grounds that half the 2026-09-18 fix lives in the Apache
 * vhost (four `RequestHeader unset` lines), is therefore not in this repo, and
 * that restoring a vhost backup silently reopens the bypass. A reviewer showed
 * that is wrong, and the reviewer is right: lib/rate-limit.ts takes the LAST
 * X-Forwarded-For hop and mod_proxy_http APPENDS the real peer, so a forged
 * value can never be last. Either control closes it alone — commit 9fc9fa1 and
 * API-ON-DROPLET.md:196 both say so. Removing the unset lines would not, by
 * itself, make this check fire.
 *
 * What it does prove is the end-to-end property, which nothing else does: that
 * whatever combination of Apache, mod_proxy and app code is deployed today,
 * a value I put in the header is not the value the app believes. That breaks
 * if someone swaps mod_proxy_http for something that replaces rather than
 * appends, if the app is moved to first-hop parsing, or — the realistic one —
 * if a CDN or load balancer is ever put in front of this box, at which point
 * the real address arrives in exactly these headers and the stripping blinds
 * every limiter instead. It is also the verification the runbook already
 * documents by hand ("Check it after any vhost change", API-ON-DROPLET.md)
 * and that nothing runs.
 *
 * Severity is high rather than the reviewer's medium: the reviewer's
 * correction was to the *rationale*, and it stands, but if this check ever
 * fires the state of the world is "every rate limit on an auth-free public API
 * is bypassable", which is not a medium. tests/rate-limit.test.ts pins the
 * same property in source; this is the only thing that asks the live box.
 *
 * x-real-ip, true-client-ip and cf-connecting-ip are unreachable in practice
 * behind ProxyPass (getClientIP returns on X-Forwarded-For before it consults
 * them) and are probed anyway: they are exactly what starts arriving if a CDN
 * is added, and a probe that costs one request is cheaper than finding out.
 *
 * Four POSTs against a 60/min bucket, once a night.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { pace, httpOnce } from './dast-shared.mjs';

// TEST-NET-3 (RFC 5737). Reserved for documentation, routed nowhere, and
// unmistakable in a log if anyone ever wonders where it came from.
const FORGED = '203.0.113.99';

const HEADERS = ['x-forwarded-for', 'x-real-ip', 'true-client-ip', 'cf-connecting-ip'];

export default check({
  id: 'dast-xff-spoof-guard',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'A client-address header supplied by the caller does not become the IP the API rate-limits on.',

  async run(ctx) {
    const findings = [];
    let checked = 0;

    // A control request first. Without knowing what the app calls us when we
    // send nothing, a "not 203.0.113.99" assertion could pass because the
    // route is broken in some other way and returns no ip at all.
    const control = await httpOnce(ctx, `${ctx.apiBase}/ip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.origin },
      body: '{}',
    });
    if (!control.ok) throw new Skip(`POST ${ctx.apiBase}/ip is unreachable (${control.error}) — nothing to grade`);
    if (control.status !== 200 || typeof control.json?.ip !== 'string') {
      throw new Skip(`POST ${ctx.apiBase}/ip answered ${control.status} without an ip field — cannot tell a spoof from a broken route`);
    }
    const realIp = control.json.ip;

    for (const header of HEADERS) {
      await pace();
      checked++;
      const res = await httpOnce(ctx, `${ctx.apiBase}/ip`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ctx.origin, [header]: FORGED },
        body: '{}',
      });
      if (!res.ok) {
        findings.push(finding({
          severity: 'low',
          title: `Could not complete the ${header} spoof probe`,
          detail: 'An unreachable probe is not a pass.',
          evidence: `POST ${ctx.apiBase}/ip with ${header}: ${FORGED} → ${res.error}`,
          remediation: 'Re-run when the droplet is reachable.',
        }));
        continue;
      }
      const seen = res.json?.ip;
      if (seen !== FORGED) continue;
      findings.push(finding({
        severity: 'high',
        title: `A caller-supplied ${header} became the client IP`,
        detail: 'The API believes the address the caller handed it. Every per-IP limit — 10 scans/min, 30 challenges/min, the global buckets on /ip, /event and the dns-leak routes — is bypassable by rotating this one header, on an API with no accounts and no keys, sharing 2 vCPU with the team\'s WordPress and MySQL.',
        evidence: `POST ${ctx.apiBase}/ip with ${header}: ${FORGED} → 200 {"ip":"${seen}"}\n  the same request without that header reports ${realIp}`,
        remediation: 'Check that mod_proxy still appends rather than replaces, that the four vhost `RequestHeader unset` lines are present (API-ON-DROPLET.md, "Abuse resistance"), and that lib/rate-limit.ts still takes the LAST X-Forwarded-For hop. If a CDN was put in front, the fix is the opposite one: trust the CDN\'s header and stop stripping it.',
        file: 'lib/rate-limit.ts',
      }));
    }

    return { findings, checked };
  },
});
