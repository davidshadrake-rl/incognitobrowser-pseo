/**
 * The guards must run in the order that makes them guards.
 *
 * Origin, then rate limit, then proof-of-work, then buffer-and-parse the body,
 * then resolve, then fetch. Every one of those boundaries protects the work
 * after it, so a refactor that moves one down is not a style change:
 *
 *   - proof-of-work below `request.text()` means an unauthenticated caller can
 *     make the service buffer and parse an arbitrary body;
 *   - the origin gate below the rate limiter means a refused caller still
 *     spends a victim's bucket;
 *   - the SSRF guard below the outbound fetch means the request the guard
 *     exists to prevent has already left.
 *
 * Nothing in tests/ can see any of this. tests/api-security.test.ts:249-265
 * and tests/hardening.test.ts read route.ts as a STRING and assert the right
 * words appear in it; a regex over source text passes no matter what order the
 * statements are in. So this check drives the real handlers and looks at what
 * came back and — for the fetch — whether a socket was opened at all. The
 * outbound boundary is a recorder, so no scenario here can reach the network.
 *
 * The last row in the table is a CONTROL that must reach the fetch. Without
 * it, every "0 outbound requests" above could equally mean the harness never
 * got that far, and the check would be a reassuring green over nothing.
 */
import { check, finding } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

export default check({
  id: 'api-control-order',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Origin, proof-of-work, rate limit, body parse and the outbound fetch still run in that order — and no gate that refuses a request lets a later one charge for it.',
  async run() {
    const o = await observe();
    const findings = [];
    let checked = 0;

    for (const r of o.order) {
      checked += 1;
      const problems = [];
      if (r.expectStatus !== undefined && r.status !== r.expectStatus) problems.push(`status ${r.status}, expected ${r.expectStatus}`);
      if (r.expectReason !== undefined && r.reason !== r.expectReason) problems.push(`reason ${JSON.stringify(r.reason)}, expected ${JSON.stringify(r.expectReason)}`);
      if (r.expectRateLimitHeader === null && r.rateLimitHeader !== null) {
        problems.push(`X-RateLimit-Limit: ${r.rateLimitHeader} was emitted, so the limiter charged a bucket for a request an earlier gate refused`);
      }
      if (r.expectRateLimitHeader === 'present' && r.rateLimitHeader === null) {
        problems.push('no X-RateLimit-Limit header, so the rate limiter did not run before the proof-of-work check');
      }
      if (r.expectFetchCount !== undefined && r.fetchCount !== r.expectFetchCount) {
        problems.push(`${r.fetchCount} outbound request(s), expected ${r.expectFetchCount}`);
      }
      if (r.expectDnsCalls !== undefined && r.dnsCalls !== undefined && r.dnsCalls !== r.expectDnsCalls) {
        problems.push(`${r.dnsCalls} DNS lookup(s), expected ${r.expectDnsCalls}`);
      }
      if (r.resolvedHostnames && r.expectDnsCalls === 0 && r.resolvedHostnames.length) {
        problems.push(`resolved ${JSON.stringify(r.resolvedHostnames)} when nothing should have been resolved`);
      }
      if (!problems.length) continue;

      // The scheme-rewrite row is a distinct, already-understood defect rather
      // than an ordering regression, so it gets its own finding text and its
      // own severity instead of being reported as "control order broke".
      if (r.label.includes('file:// scheme')) {
        findings.push(finding({
          severity: 'low',
          title: 'The protocol allowlist is unreachable for any scheme that does not start with the letters "http"',
          detail:
            'app/scan-url/route.ts:200 does `new URL(url.startsWith("http") ? url : `https://${url}`)`. A `file:` URL does not start with "http", so it is rewritten into `https://file:///etc/passwd` — an https URL whose hostname is the word "file". The `["http:","https:"]` check four lines later then sees "https:" and passes. The scheme was not rejected; it was renamed into a hostname, and that single-label hostname is handed to the resolver. On a host with a DNS search suffix a single label is not nothing, and the check that was supposed to stop this never ran. The resolve-then-judge guard below still refuses a private answer, which is why this is low rather than an SSRF.',
          evidence: `POST /scan-url {"url":"file:///etc/passwd"} with a valid proof-of-work => ${r.status}; resolver was asked for ${JSON.stringify(r.resolvedHostnames)}; ${r.fetchCount} outbound request(s) made`,
          remediation: 'Parse the URL once with no rewrite, and only prepend https:// when the string contains no "://" at all. Then the protocol allowlist sees the real scheme.',
          file: 'app/scan-url/route.ts',
          line: 200,
        }));
        continue;
      }

      findings.push(finding({
        severity: 'high',
        title: `Security controls ran out of order: ${r.label}`,
        detail: `${r.why}. The handler was invoked in-process with the real route module, so this is what the route did, not what its source says.`,
        evidence: `${r.label} => ${problems.join('; ')}`,
        remediation: 'Restore the order: origin gate, proof-of-work, rate limit, single-use claim, body size, body parse, SSRF guard, in-flight cap, fetch.',
        file: 'app/scan-url/route.ts',
        line: null,
      }));
    }

    return { findings, checked };
  },
});
