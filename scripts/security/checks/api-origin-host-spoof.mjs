/**
 * The Origin gate must not be satisfiable by a header the caller writes.
 *
 * lib/origin.ts:62 treats a request as same-origin when `new URL(origin).host`
 * equals the Host header. Apache in front of this API runs `ProxyPreserveHost On`
 * (API-ON-DROPLET.md), so the Host the client sent arrives at Node verbatim —
 * which means the attacker supplies BOTH sides of that comparison. Sending
 * `Origin: https://evil.example` with `Host: evil.example` walks through the
 * gate on all six origin-gated routes without ever learning what ALLOWED_ORIGINS
 * contains.
 *
 * Why it is only LOW here, argued rather than inflated: Origin was never the
 * control that stops scripted abuse on this API — the proof-of-work, the rate
 * limit and the SSRF guards are, and they all still run. A real browser cannot
 * set Host, so no page a victim visits gains anything from this. What is lost
 * is the first filter against curl-shaped abuse, and the honesty of a gate the
 * route comments describe as a gate.
 *
 * Why an existing test does not catch it: tests/api-security.test.ts asserts
 * that the STRING `isOriginAllowed` appears in each route's source. It does.
 * The gate is present, called, and passes.
 *
 * The last row is not about the hole, it is about the FIX. Dropping the
 * same-origin shortcut breaks the API calling itself unless the API's own
 * origin is in ALLOWED_ORIGINS at the same moment — lib/origin.ts's own comment
 * records that production already shipped exactly that outage, with the cookie
 * scanner and /ip returning 403. If that row ever goes red, the fix landed
 * without its environment change and the tool is down.
 */
import { check, finding } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

export default check({
  id: 'api-origin-host-spoof',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'low',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A client-supplied Host cannot satisfy the Origin allowlist on any of the six gated routes.',
  async run() {
    const o = await observe();
    const findings = [];
    let checked = 0;

    const unitFails = [];
    for (const r of o.origin.unit) {
      checked += 1;
      if (r.got !== r.expect) unitFails.push(r);
    }

    // The blast-radius row is a different failure with a different fix, so it
    // is separated from the spoof rows rather than averaged into them.
    const blastRadius = unitFails.find((r) => r.label === 'api-own-host-same-origin');
    const spoofFails = unitFails.filter((r) => r.label !== 'api-own-host-same-origin');

    const routeFails = [];
    for (const r of o.origin.routes) {
      checked += 1;
      if (r.status !== 403) routeFails.push(r);
    }

    if (spoofFails.length || routeFails.length) {
      const unitEvidence = spoofFails.map((r) => `isOriginAllowed(${JSON.stringify(r.origin)}, ${JSON.stringify(r.host)}) => ${r.got} (expected ${r.expect})`);
      const routeEvidence = routeFails.map((r) => `POST /${r.label} with Origin: https://evil.example + Host: evil.example => ${r.status}${r.acao ? `, Access-Control-Allow-Origin: ${r.acao}` : ''}`);
      findings.push(finding({
        severity: 'low',
        title: 'The Origin gate accepts any origin whose host matches the client-supplied Host header',
        detail:
          'Apache runs ProxyPreserveHost On, so the Host header reaching Node is written by the caller. lib/origin.ts treats Origin.host === Host as same-origin and allows it, so a caller sets both to the same fabricated value and is inside. The allowlist is never consulted. The routes still refuse a foreign Origin sent with the REAL Host, which is why the source-grep tests and the live smoke both report green: they only ever send the real Host. Proof-of-work, rate limiting and the SSRF guards are unaffected — this is the outermost filter, not the load-bearing one, hence low. Note the responses also mirror the fabricated origin into Access-Control-Allow-Origin, which is harmless only because a browser cannot set Host.',
        evidence: [...unitEvidence, ...routeEvidence].join(' | '),
        remediation:
          'Drop the same-origin shortcut in isOriginAllowed and rely on the allowlist alone. That change MUST land with ALLOWED_ORIGINS containing the API\'s own origin (https://206-189-186-34.nip.io — already recorded at API-ON-DROPLET.md:115), or the site stops being able to call itself. Gate the deploy on scripts/security-smoke.mjs section B, which is the canary for exactly that.',
        file: 'lib/origin.ts',
        line: 62,
      }));
    }

    if (blastRadius) {
      findings.push(finding({
        severity: 'high',
        title: 'The API can no longer call its own host — the origin fix landed without its allowlist entry',
        detail:
          'isOriginAllowed now refuses a request whose Origin is the API\'s own origin. That is what dropping the same-origin shortcut does when ALLOWED_ORIGINS does not contain the API\'s own host, and lib/origin.ts\'s own comment records that production shipped this once already: the cookie scanner and /ip returned 403 for every visitor.',
        evidence: `isOriginAllowed(${JSON.stringify(blastRadius.origin)}, ${JSON.stringify(blastRadius.host)}) => ${blastRadius.got}, expected true`,
        remediation: 'Add the deployed origin to ALLOWED_ORIGINS on the ib-api unit before this code reaches the droplet.',
        file: 'lib/origin.ts',
        line: 62,
      }));
    }

    return { findings, checked };
  },
});
