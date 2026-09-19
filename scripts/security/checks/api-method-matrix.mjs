/**
 * No route answers a verb it was never meant to export.
 *
 * The one that matters is /stats. Its whole protection is a bearer header, and
 * a GET handler would invite that token into places a POST body never goes:
 * browser history, a Referer, an Apache access log line, a link someone pastes
 * into Slack. /challenge matters for a different reason — Next 16's static
 * export refuses a GET route handler that is not force-static, so adding one
 * breaks `npm run build:static`, and scripts/deploy-api.sh:43 only checks that
 * route.js exists, not which verbs it has.
 *
 * Today the only verb coverage anywhere is in the live smoke, for two routes
 * (scripts/security-smoke.mjs:126,211). This grades all seven, offline.
 *
 * WHAT THIS DELIBERATELY DOES NOT ASSERT, because the first draft got it
 * wrong: it does not demand an exact export set. app/ip/route.ts legitimately
 * exports buildIpResponse, which app/dns-leak/start/route.ts imports; demanding
 * `{POST, OPTIONS}` would red-line a real helper and teach everyone to ignore
 * this check. The property is that no HTTP VERB other than POST and OPTIONS is
 * exported.
 *
 * The live half — GET/PUT/PATCH/DELETE/HEAD against /api/* returning 405 — is
 * not here on purpose. This check runs on every commit inside the unit suite,
 * where a network call has no business being. The verb probe over the wire is
 * the DAST discipline's (scripts/security/checks/dast-api-method-matrix.mjs).
 */
import { check, finding } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

export default check({
  id: 'api-method-matrix',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'No API route module exports an HTTP verb beyond POST and OPTIONS.',
  async run() {
    const o = await observe();
    const findings = [];
    let checked = 0;

    for (const r of o.methods) {
      checked += 1;

      if (r.strayVerbs.length) {
        findings.push(finding({
          severity: r.label === 'stats' ? 'high' : 'medium',
          title: `/${r.label} exports ${r.strayVerbs.join(', ')}`,
          detail:
            r.label === 'stats'
              ? 'A GET-shaped handler on /stats puts the bearer token into URLs, browser history, Referer headers and the Apache access log. The route is protected by nothing else.'
              : 'Next 16 with output:"export" refuses a non-force-static GET route handler, so this also breaks the static build — and deploy-api.sh only checks that route.js exists, not which verbs it carries.',
          evidence: `app/${r.label}/route.ts exports [${r.exported.join(', ')}]`,
          remediation: 'Remove the handler. Everything here is POST by design, for the reasons in each route\'s header comment.',
          file: `app/${r.label}/route.ts`,
          line: null,
        }));
      }

      if (!r.hasPost) {
        findings.push(finding({
          severity: 'medium',
          title: `/${r.label} no longer exports POST`,
          detail: 'Every route in this API is POST. A module that stopped exporting it is either renamed or broken, and the live probe would see a 405 where callers expect an answer.',
          evidence: `app/${r.label}/route.ts exports [${r.exported.join(', ')}]`,
          remediation: 'Restore the POST export, or update the live probe and the clients together.',
          file: `app/${r.label}/route.ts`,
          line: null,
        }));
      }

      // /stats deliberately has no OPTIONS and no CORS headers anywhere. That
      // is what keeps the counters unreadable from a page the owner happens to
      // be visiting, and it is worth noticing the day someone adds one "for
      // consistency with the other six routes".
      if (r.label === 'stats' && r.hasOptions) {
        findings.push(finding({
          severity: 'medium',
          title: '/stats has grown an OPTIONS handler',
          detail: 'The six public routes answer preflights because browsers call them. /stats is called by the owner with curl and emits no CORS headers at all; a preflight handler is the first half of making the counters cross-origin readable.',
          evidence: `app/stats/route.ts exports [${r.exported.join(', ')}]`,
          remediation: 'Remove it. If a browser tool ever needs /stats, that is a decision to make deliberately, with the ACAO it implies.',
          file: 'app/stats/route.ts',
          line: null,
        }));
      }

      if (r.label !== 'stats' && !r.hasOptions) {
        findings.push(finding({
          severity: 'low',
          title: `/${r.label} no longer answers preflights`,
          detail: 'The static site calls this route cross-origin, so a browser sends OPTIONS first. Without a handler the tool fails in the browser while curl keeps working, which is the shape of bug that reaches production.',
          evidence: `app/${r.label}/route.ts exports [${r.exported.join(', ')}]`,
          remediation: 'Restore the OPTIONS export.',
          file: `app/${r.label}/route.ts`,
          line: null,
        }));
      }
    }

    return { findings, checked };
  },
});
