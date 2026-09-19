/**
 * The origin gate is live on the three routes nothing has ever probed.
 *
 * NOT in the original design, added on a reviewer's argument that I agree
 * with. scripts/security-smoke.mjs proves the gate over HTTP on /challenge,
 * /scan-url and /ip — sections B, C and D. It never touches /event,
 * /dns-leak/start or /dns-leak/result. All three call isOriginAllowed() in
 * source, and tests/cors-security pins that in a unit test, but the source
 * saying so is exactly the assurance that failed this repo before:
 * tests/ssrf-protection.test.ts graded a hand-copied replica of the function
 * it claimed to test and stayed green through two live SSRF bypasses. What is
 * deployed is a different question from what is in git, and these three routes
 * have never had the deployed answer checked.
 *
 * Two ways to fail the gate, and both are asserted because they are different
 * code paths: an Origin that is not ours, and no Origin at all. A missing
 * Origin must be refused too — `if (!origin) return false` — or every curl on
 * the internet is inside the allowlist.
 *
 * Six POSTs against budgets of 120/min (/event), 20/min (/dns-leak/start) and
 * 100/min (/dns-leak/result): two each, once a night. No proof-of-work is
 * spent and no scan slot is taken, because the gate runs before either.
 */
import { check, finding } from '../lib/harness.mjs';
import { pace, httpOnce } from './dast-shared.mjs';

const EVIL = 'https://evil.example';

const ROUTES = [
  { path: '/event', body: '{"event":"tool_run","tool":"whats-my-ip"}' },
  { path: '/dns-leak/start', body: '{}' },
  { path: '/dns-leak/result', body: '{"id":"aaaaaaaaaaaaaaaa"}' },
];

export default check({
  id: 'dast-origin-gate-coverage',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Live proof that /event and both /dns-leak routes refuse a foreign Origin and a missing Origin — the three routes security-smoke.mjs never probes.',

  async run(ctx) {
    const findings = [];
    let checked = 0;
    let reachable = 0;

    for (const route of ROUTES) {
      const cases = [
        { label: `Origin: ${EVIL}`, headers: { 'content-type': 'application/json', origin: EVIL } },
        { label: 'no Origin at all', headers: { 'content-type': 'application/json' } },
      ];
      for (const c of cases) {
        await pace();
        const url = `${ctx.apiBase}${route.path}`;
        const res = await httpOnce(ctx, url, { method: 'POST', headers: c.headers, body: route.body });
        if (!res.ok) {
          findings.push(finding({
            severity: 'low',
            title: `POST ${route.path} [${c.label}] could not be completed`,
            detail: 'An unreachable probe is not a pass.',
            evidence: `POST ${url} → ${res.error}`,
            remediation: 'Re-run when the API is reachable.',
          }));
          continue;
        }
        reachable++;
        checked++;

        if (res.status !== 403) {
          findings.push(finding({
            severity: 'high',
            title: `POST ${route.path} with ${c.label} was not refused (${res.status})`,
            detail: 'The origin gate is the first layer on every route: it is what keeps a page on someone else\'s site from driving this API in a visitor\'s browser. It is verified live on /challenge, /scan-url and /ip and, until this check, nowhere else. A 429 here would be the rate limiter answering first and is worth re-running; anything 2xx means the gate is not deployed on this route.',
            evidence: `POST ${url} with ${c.label} → ${res.status}, ${res.text.replace(/\s+/g, ' ').slice(0, 160)}`,
            remediation: `Check that app${route.path}/route.ts still calls isOriginAllowed(origin, host) before doing any work, and that the deployed build is the current one (scripts/deploy-api.sh).`,
            file: `app${route.path}/route.ts`,
          }));
          continue;
        }

        checked++;
        const acao = res.headers.get('access-control-allow-origin');
        if (acao) {
          findings.push(finding({
            severity: 'medium',
            title: `POST ${route.path} with ${c.label} was refused but still sent Access-Control-Allow-Origin: ${acao}`,
            detail: 'corsHeadersFor() omits ACAO for an Origin it does not allow, so the browser blocks the response body as well as the request. Sending it on a 403 hands the calling page the error body — small, but it is the difference between "refused" and "refused and told why".',
            evidence: `POST ${url} with ${c.label} → 403, Access-Control-Allow-Origin: ${acao}`,
            remediation: 'Check corsHeadersFor() in lib/origin.ts is what builds the refusal headers.',
            file: 'lib/origin.ts',
          }));
        }
      }
    }

    if (!reachable) throw new ctx.Skip(`no probe reached ${ctx.apiBase} — nothing was graded`);

    return { findings, checked };
  },
});
