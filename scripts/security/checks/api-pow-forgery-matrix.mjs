/**
 * A scan token must be mintable only by /challenge.
 *
 * The proof-of-work is the one thing on this API that makes scripted abuse of
 * /scan-url cost anything, so the question worth asking is not "does a valid
 * token work" but "what else works". lib/altcha.ts:124-159 answers that with
 * six typed guards and an HMAC over `challenge|expires|salt`.
 *
 * WHAT IS DELIBERATELY NOT HERE. tests/api-security.test.ts's Altcha block
 * already covers a tampered signature, an in-range wrong number, an
 * out-of-range number, expired, expires_too_far, a bad algorithm and malformed
 * input. Rebuilding those would be a second green file grading the same
 * property — the kind of duplication that makes a suite expensive to keep and
 * easy to stop reading. What is left is what nothing covers:
 *
 *   - extending `expires` on an otherwise perfect token. The HMAC covers it
 *     today, so this row passes; it exists because a refactor that drops
 *     `expires` from the signed message would hand out tokens with an
 *     attacker-chosen lifetime and no test would notice.
 *   - mixing two challenges, in both directions. A signature is not a bearer
 *     credential on its own; it must bind the salt it was issued with.
 *   - a signature truncated to 63 characters. The length guard at altcha.ts:151
 *     is the only thing stopping the compare loop from short-circuiting on a
 *     prefix.
 *   - a number sent as a numeric string, and as a float. Both slip past a
 *     `typeof` written slightly differently.
 *
 * And the genuinely additive half: three of those forgeries driven through the
 * REAL app/scan-url/route.ts, because a library that refuses correctly proves
 * nothing if the route forgets to ask it. The first row of the table is a
 * CONTROL — an untouched solution that must verify — so that a table of
 * "invalid, invalid, invalid" cannot come from a harness that never minted a
 * working token in the first place.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './api-inproc.mjs';

export default check({
  id: 'api-pow-forgery-matrix',
  discipline: 'api',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Proof-of-work tokens cannot be extended, re-pointed at another challenge, truncated or re-typed.',
  async run() {
    const o = await observe();
    const findings = [];
    let checked = 0;

    const control = o.pow.unit.find((r) => r.label.startsWith('CONTROL'));
    if (!control || control.valid !== true) {
      // Not a finding about the application — a finding about this check. If
      // the control cannot verify, every refusal below is meaningless and must
      // not be reported as a pass.
      throw new Skip(
        `the harness could not mint a token that verifies (control returned valid=${control && control.valid}, reason=${control && control.reason}); every forgery row below would be vacuous`,
      );
    }

    for (const r of o.pow.unit) {
      checked += 1;
      if (r.valid === r.expectValid) continue;
      findings.push(finding({
        severity: 'high',
        title: `A forged proof-of-work verified: ${r.label}`,
        detail: `${r.why}. verifySolution accepted a token it must refuse, which makes /scan-url mintable without ever calling /challenge.`,
        evidence: `verifySolution(${r.label}) => valid=${r.valid} reason=${JSON.stringify(r.reason)}; expected valid=${r.expectValid}`,
        remediation: 'Restore the guard in lib/altcha.ts verifySolution that this row names.',
        file: 'lib/altcha.ts',
        line: 124,
      }));
    }

    for (const r of o.pow.route) {
      checked += 1;
      const problems = [];
      if (r.status !== r.expectStatus) problems.push(`status ${r.status}, expected ${r.expectStatus}`);
      if (r.fetchCount !== r.expectFetchCount) problems.push(`${r.fetchCount} outbound request(s), expected ${r.expectFetchCount}`);
      if (!problems.length) continue;
      findings.push(finding({
        severity: 'high',
        title: `/scan-url served a request carrying a forged token: ${r.label}`,
        detail: 'The library may still refuse this token; the route did not act on the refusal. That is the difference between a control and a control that is called.',
        evidence: `POST /scan-url with a ${r.label} token => ${problems.join('; ')} (reason=${JSON.stringify(r.reason)})`,
        remediation: 'app/scan-url/route.ts must return 401 whenever verifySolution reports valid:false, before anything else happens.',
        file: 'app/scan-url/route.ts',
        line: 105,
      }));
    }

    return { findings, checked };
  },
});
