/**
 * Two checks over the same instrumented run of app/scan-url/route.ts: whether
 * a socket is ever opened for a target the route refuses, and what the one
 * allowed fetch actually asks for.
 *
 * Both exist because of the same blind spot. tests/ssrf-resolve.test.ts pins
 * the resolve-then-judge step by asserting the ROUTE SOURCE contains the
 * string `dnsLookup(parsedUrl.hostname`, and tests/ssrf-protection.test.ts
 * unit-tests isBlockedHostname in isolation. Both keep passing if someone
 * reorders the route so it fetches first and judges after. scripts/security-smoke.mjs
 * sends the same hostile URLs over the wire and reads the status code, which
 * also keeps passing — a 400 returned after the metadata service was already
 * contacted still reads as a 400. Only an instrumented run can say "no socket
 * was opened", and that is the assertion here.
 *
 * See iast-probe.mjs for the harness: real route module, recorder for fetch,
 * stubbed DNS, no network.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './iast-probe.mjs';

const REPO_ROUTE = 'app/scan-url/route.ts';

export default [
  check({
    id: 'iast-no-outbound-before-ssrf-verdict',
    discipline: 'iast',
    cadence: 'every-commit',
    severity: 'critical',
    safeAgainstProd: true,
    needsOptIn: false,
    requires: [],
    describe: 'Drives the resolve-then-judge SSRF branch with a stubbed resolver and asserts no socket was opened for any blocked target.',
    async run() {
      const obs = await observe();
      const cases = obs.ssrf || [];
      if (!cases.length) throw new Skip('the probe produced no SSRF observations');

      // Instrumentation guards. If the DNS stub never ran, these hostnames
      // resolved for real from whatever machine this is, and every verdict
      // below would be about the developer's resolver rather than the route.
      // If the recorder never saw a fetch at all, "zero sockets" is vacuous —
      // it could equally mean the harness never reached the fetch.
      if (!obs.meta || !obs.meta.dnsStubLive) {
        throw new Skip('the DNS stub was never called — the corpus would have resolved for real, so no verdict here is trustworthy');
      }
      const control = cases.find((c) => c.expect === 'fetched');
      if (!control || control.fetchCount !== 1 || control.status !== 200) {
        throw new Skip(`the control case never reached the outbound fetch (status ${control ? control.status : 'n/a'}, ${control ? control.fetchCount : 0} fetches) — "no socket" would prove nothing`);
      }

      const findings = [];
      for (const c of cases) {
        const where = `${c.label}: POST /scan-url {"url":"${c.url}"} with dns.lookup → [${[].concat(c.answer).join(', ')}]`;

        // The property. Everything else in this check is a supporting detail.
        if (c.expect !== 'fetched' && c.fetchCount > 0) {
          findings.push(finding({
            severity: 'critical',
            title: `A socket was opened for a target the route then refused (${c.label})`,
            detail: 'The outbound fetch ran before — or despite — the SSRF verdict. The response status is still a refusal, so both the existing unit tests and the live smoke test report green while the request has already reached the address.',
            evidence: `${where} → HTTP ${c.status} "${c.error}" but the fetch recorder saw ${c.fetchCount}: ${c.fetchUrls.join(', ')}`,
            remediation: `In ${REPO_ROUTE}, the fetch at the end of the handler must stay strictly after the hostname check and the resolve-and-judge block.`,
            file: REPO_ROUTE,
          }));
        }

        if (c.expect === 'blocked' && c.status !== 400) {
          findings.push(finding({
            severity: 'critical',
            title: `A target that resolves into blocked space was not refused (${c.label})`,
            detail: c.why,
            evidence: `${where} → HTTP ${c.status} ${c.error ? `"${c.error}"` : '(no error field)'}; expected 400`,
            remediation: 'Check lib/scanner.ts isBlockedHostname against the address forms dns.lookup returns, including IPv4-mapped IPv6.',
            file: REPO_ROUTE,
          }));
        }

        if (c.expect === 'no-fetch' && c.status !== 502) {
          findings.push(finding({
            severity: 'medium',
            title: `An unresolvable target answered ${c.status} rather than 502 (${c.label})`,
            detail: 'A name with no addresses, or one that fails to resolve, cannot be scanned. It should end the request, not fall through to a fetch.',
            evidence: `${where} → HTTP ${c.status}, ${c.fetchCount} fetches`,
            file: REPO_ROUTE,
          }));
        }

        // A case that was supposed to exercise the resolver and did not means
        // the branch is gone, not that the target was safe. tests/ssrf-resolve.ts
        // would keep passing on its grep; this is the thing that notices.
        if (c.expect !== 'blocked' && !c.dnsCalls.length && c.label !== 'literal-metadata-ip') {
          findings.push(finding({
            severity: 'high',
            title: `The resolve-then-judge step did not run for ${c.label}`,
            detail: 'The route reached its verdict without resolving the hostname, so a name that is harmless as text and points into private space is judged on its text alone. That is the hole 169-254-169-254.nip.io walked through before 2026-09-18.',
            evidence: `${where} → HTTP ${c.status}, dns.lookup calls: none`,
            file: REPO_ROUTE,
          }));
        }
      }

      // The literal-IP control deserves its own note: it must be refused
      // WITHOUT a resolution, which is what proves the cheap string check still
      // runs first rather than having been folded into the DNS branch.
      const literal = cases.find((c) => c.label === 'literal-metadata-ip');
      if (literal && literal.dnsCalls.length) {
        findings.push(finding({
          severity: 'low',
          title: 'A literal blocked address is now resolved before being refused',
          detail: 'Not a hole, but a wasted lookup on every hostile request and a sign the ordering moved. The string check is meant to refuse 169.254.169.254 before any DNS work happens.',
          evidence: `literal-metadata-ip: dns.lookup called with ${literal.dnsCalls.join(', ')}`,
          file: REPO_ROUTE,
        }));
      }

      return { findings, checked: cases.length };
    },
  }),

  check({
    id: 'iast-fetch-target-and-redirect-policy',
    discipline: 'iast',
    cadence: 'every-commit',
    severity: 'high',
    safeAgainstProd: true,
    needsOptIn: false,
    requires: [],
    describe: 'Records the one allowed scan fetch: that it targets the host that was judged, and that redirects are still manual.',
    async run() {
      const obs = await observe();
      const fp = obs.fetchPolicy || {};
      if (!fp.allowed || !fp.redirect) throw new Skip('the probe produced no fetch-policy observations');
      if (fp.allowed.fetchCount !== 1) {
        throw new Skip(`the allowed scan made ${fp.allowed.fetchCount} fetches, so there is nothing single to inspect`);
      }

      const findings = [];
      const a = fp.allowed;

      // redirect:'manual' is already grepped by tests/resource-bounds.test.ts
      // and tests/ssrf-resolve.test.ts. This is the same property observed
      // rather than read — it costs nothing here and it is the one that would
      // matter if the string survived a refactor that changed the behaviour.
      if (a.redirectPolicy !== 'manual') {
        findings.push(finding({
          severity: 'high',
          title: `The scan fetch ran with redirect: ${a.redirectPolicy === null ? '(unset — defaults to follow)' : a.redirectPolicy}`,
          detail: 'Following redirects hands the Location header the SSRF decision: a public page that 302s to 169.254.169.254 reaches the metadata service, and the 300-399 refusal in the route stops firing, so nothing downstream notices.',
          evidence: `POST /scan-url {"url":"https://example.com/some/page?q=1"} → fetch(${a.fetchUrl}, { redirect: ${JSON.stringify(a.redirectPolicy)} })`,
          remediation: `Restore redirect: 'manual' in ${REPO_ROUTE}.`,
          file: REPO_ROUTE,
        }));
      }

      let fetchedHost = null;
      try { fetchedHost = new URL(a.fetchUrl).hostname; } catch { /* reported below */ }
      if (!fetchedHost) {
        findings.push(finding({
          severity: 'high',
          title: 'The scan fetch target is not a parseable URL',
          detail: 'Whatever is passed to fetch is what gets connected to; if it no longer parses as the URL that was judged, the guards above it are judging something else.',
          evidence: `recorded fetch target: ${JSON.stringify(a.fetchUrl)}`,
          file: REPO_ROUTE,
        }));
      } else if (a.judgedHostname && fetchedHost !== a.judgedHostname && !a.judgedAddresses.includes(fetchedHost)) {
        findings.push(finding({
          severity: 'critical',
          title: 'The scan fetches a host that was never judged',
          detail: 'The SSRF verdict was reached about one hostname and the request went to another. Every guard in front of it is then decoration.',
          evidence: `dns.lookup judged "${a.judgedHostname}" → [${a.judgedAddresses.join(', ')}], fetch went to "${fetchedHost}" (${a.fetchUrl})`,
          file: REPO_ROUTE,
        }));
      }

      // A deliberate pin, not a complaint. The fetch is issued against the
      // NAME, so between the lookup that judged it and the connection that
      // uses it the answer can change — classic DNS rebinding. It is open, it
      // is known, and closing it means connecting to the judged address with
      // an SNI/Host override, which is a real piece of work. What must not
      // happen is the state changing silently in either direction, so this
      // reports when the observation stops matching the documented one.
      if (fetchedHost && a.judgedAddresses.includes(fetchedHost)) {
        findings.push(finding({
          severity: 'info',
          title: 'The known DNS-rebinding gap looks closed — update the pin',
          detail: 'This check records that /scan-url fetches the hostname rather than the address dns.lookup just judged. It now fetches the address, which is an improvement. Confirm it deliberately and update this check and API-ON-DROPLET.md so the pin describes reality.',
          evidence: `dns.lookup judged "${a.judgedHostname}" → [${a.judgedAddresses.join(', ')}]; fetch target host is "${fetchedHost}"`,
          file: REPO_ROUTE,
        }));
      }

      if (a.status !== 200 || !a.resultKeys.includes('trackers')) {
        findings.push(finding({
          severity: 'medium',
          title: 'The allowed path no longer returns a scan result',
          detail: 'The end-to-end 200 path is what makes every "was refused" observation in this discipline meaningful. If a legitimate target no longer produces a result, the refusals may be refusing everything.',
          evidence: `POST /scan-url on an allowed public target → HTTP ${a.status}, body keys [${a.resultKeys.join(', ')}]`,
          file: REPO_ROUTE,
        }));
      }

      const r = fp.redirect;
      if (r.fetchCount > 1) {
        findings.push(finding({
          severity: 'critical',
          title: 'A redirect was followed during a scan',
          detail: 'The recorder saw a second outbound request after a 302 whose Location was the cloud metadata service. That is SSRF through the Location header.',
          evidence: `302 → Location http://169.254.169.254/latest/meta-data/ ; fetch recorder saw ${r.fetchCount}: ${r.fetchUrls.join(', ')}`,
          file: REPO_ROUTE,
        }));
      }
      if (r.status !== 400) {
        findings.push(finding({
          severity: 'medium',
          title: `A redirecting target answered ${r.status} rather than 400`,
          detail: 'With redirect:\'manual\' the body is empty, so anything other than an explicit refusal means the caller is handed a "scan result" for a page that was never read.',
          evidence: `302 target → HTTP ${r.status} "${r.error}" (redirectTo: ${r.redirectTo})`,
          file: REPO_ROUTE,
        }));
      }

      return { findings, checked: 2 };
    },
  }),
];
