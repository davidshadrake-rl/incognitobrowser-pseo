/**
 * /stats authorisation — the only authorisation in the system.
 *
 * Six routes are open by design. This one is not, and it has zero coverage
 * today: no unit test, no smoke case. Two concrete regressions it catches:
 *
 *   1. Someone adds corsHeadersFor() to /stats "for consistency with the other
 *      six routes". The route deliberately emits no Access-Control-Allow-Origin
 *      (app/stats/route.ts:21 sets only Cache-Control), which is the reason a
 *      page the owner happens to be visiting cannot read the counters even if
 *      it can guess the URL. One line of consistency undoes that.
 *   2. The constant-time compare at stats/route.ts:30 is replaced with `!==`,
 *      or the length guard in front of it is dropped. The first reintroduces a
 *      byte-at-a-time oracle; the second turns an unequal-length token into a
 *      THROW from timingSafeEqual — a 500 rather than a 401, which is both an
 *      availability bug and a distinguisher.
 *
 * It also pins the 404-when-unconfigured semantics (the route does not exist
 * for anyone until STATS_TOKEN is set) and the `day` parameter, which is the
 * only user input that reaches a Redis SCAN MATCH pattern. The regex at
 * stats/route.ts:50 is the whole distance between a caller's string and the
 * keyspace; `*` must not become a wildcard over every key the day prefix
 * would otherwise bound.
 *
 * One row records where whitespace is stripped rather than asserting a
 * refusal. RFC 9110 field values have surrounding whitespace removed, and
 * undici does it before the route sees the header, so `Bearer <token> ` is not
 * a near-miss acceptance by this code. The row is kept, expecting 200, because
 * the first draft of this check expected 401 there and would have reported the
 * HTTP layer's own normalisation as an authorisation defect. The real
 * near-miss row is the one with the doubled space, which is NOT normalised.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

export default check({
  id: 'api-stats-authz',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: '/stats refuses every near-miss bearer, never emits CORS headers, and bounds its day parameter and body.',
  async run() {
    const o = await observe();
    const findings = [];
    let checked = 0;

    const control = o.stats.find((r) => r.label === 'correct token');
    // If the owner's own token cannot read the counters, every 401 below could
    // be the route being broken rather than the route refusing.
    if (!control || control.status !== 200) {
      throw new Skip(
        `the correct-token control returned ${control ? control.status : 'nothing'} instead of 200; every refusal row would be indistinguishable from a broken route`,
      );
    }

    for (const r of o.stats) {
      checked += 1;

      if (r.threw) {
        findings.push(finding({
          severity: 'medium',
          title: `/stats threw instead of answering: ${r.label}`,
          detail: 'timingSafeEqual throws on buffers of unequal length. The length guard in front of it is what turns that into a 401; without it an attacker gets a 500 for any wrong-length token, which is both an availability bug and a way to tell wrong-length from wrong-value.',
          evidence: `POST /stats (${r.label}) threw ${r.threw}`,
          remediation: 'Keep `given.length !== expected.length ||` in front of the timingSafeEqual call at app/stats/route.ts:30.',
          file: 'app/stats/route.ts',
          line: 30,
        }));
        continue;
      }

      if (r.status !== r.expect) {
        const exposed = r.hasCounts && r.expect !== 200;
        findings.push(finding({
          severity: exposed ? 'high' : 'medium',
          title: exposed
            ? `/stats returned the counters to a caller it should have refused: ${r.label}`
            : `/stats answered ${r.status} where ${r.expect} is the contract: ${r.label}`,
          detail: `${r.why}. ${exposed ? 'The response carried a "counts" key, so this is a disclosure and not only a status-code drift.' : 'On its own a status drift is not a disclosure, but this route has exactly one control and every part of it is load-bearing.'}`,
          evidence: `POST /stats (${r.label}) => ${r.status}, body keys [${r.bodyKeys.join(', ')}], expected ${r.expect}`,
          remediation: 'Restore the behaviour described in the row: see app/stats/route.ts lines 20-50.',
          file: 'app/stats/route.ts',
          line: null,
        }));
      }

      // No response from this route may ever carry an ACAO, whatever its status.
      if (r.acao) {
        findings.push(finding({
          severity: 'high',
          title: '/stats now emits Access-Control-Allow-Origin',
          detail: 'With an ACAO the counters become readable by any page the owner visits while their browser would send the request — the one bypass class that does not need a scripted client. This route has no browser caller and needs no CORS headers at all.',
          evidence: `POST /stats (${r.label}) => ${r.status} with Access-Control-Allow-Origin: ${r.acao}`,
          remediation: 'Do not pass corsHeadersFor() into app/stats/route.ts. Its only headers are Cache-Control: no-store, private.',
          file: 'app/stats/route.ts',
          line: 21,
        }));
      }
    }

    return { findings, checked };
  },
});
