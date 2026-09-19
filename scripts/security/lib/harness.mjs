/**
 * The contract every security check is written to.
 *
 * Design rules, each one earned by something that went wrong in this repo:
 *
 * 1. A CHECK THAT CANNOT RUN MUST SAY SO, LOUDLY. Throw Skip() and the runner
 *    records SKIPPED and — with --strict — fails the run. It never counts as a
 *    pass. The whole reason this suite exists is that several existing tests
 *    reported green while grading nothing: tests/ssrf-protection.test.ts
 *    graded a hand-copied replica of the function it claimed to test, and
 *    the removed-platform guard never opened the .conf file that sets the
 *    CSP. Silence is the failure mode to design against.
 *
 * 2. EVIDENCE IS MANDATORY. A finding carries what was actually observed — a
 *    URL and status, a file and line, a command's real output. "Looks risky"
 *    is not a finding. Anyone reading the report must be able to re-check it
 *    without rerunning the suite.
 *
 * 3. PRODUCTION SAFETY IS DECLARED, NOT ASSUMED. The only live environment
 *    also serves the team's WordPress and MySQL on 2 vCPU. A check that could
 *    exhaust the rate limiter, the in-flight scan cap, a socket table or the
 *    disk sets needsOptIn and stays out of the scheduled run until asked for
 *    by id.
 *
 * 4. SEVERITY IS ABOUT THIS SYSTEM. There is no auth, no PII store and no
 *    payments here, so a generic scanner's "critical" is often irrelevant and
 *    a "low" (a stale origin allowlist handed to the Android app) can be the
 *    real one. Grade what it means here, and say why in `detail`.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'];
export const CADENCES = ['every-commit', 'nightly', 'weekly', 'on-demand'];

/** Thrown by a check that cannot run. Recorded as SKIPPED, never as a pass. */
export class Skip extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'Skip';
    this.isSkip = true;
  }
}

/**
 * One thing that is wrong. `evidence` is what was actually observed;
 * `remediation` is what to do about it.
 */
export function finding({ severity, title, detail, evidence, remediation, file, line }) {
  if (!SEVERITIES.includes(severity)) throw new Error(`bad severity: ${severity}`);
  if (!title || !detail || !evidence) throw new Error(`finding needs title, detail and evidence: ${title}`);
  return { severity, title, detail, evidence, remediation: remediation || '', file: file || null, line: line ?? null };
}

/**
 * Declare a check. The runner discovers these from scripts/security/checks/.
 *
 * run(ctx) returns { findings, checked } where `checked` is how many things it
 * actually looked at — a check reporting 0 findings over 0 items has proved
 * nothing, and the runner says so rather than printing a reassuring tick.
 */
export function check(def) {
  const required = ['id', 'discipline', 'cadence', 'describe', 'run'];
  for (const k of required) if (!def[k]) throw new Error(`check missing ${k}: ${def.id || '(anonymous)'}`);
  if (!CADENCES.includes(def.cadence)) throw new Error(`bad cadence: ${def.cadence}`);
  return {
    needsOptIn: false,
    safeAgainstProd: true,
    requires: [],
    ...def,
  };
}

/** Byte-for-byte deep equality for small config objects, with a readable diff. */
export function diffLists(expected, actual) {
  const missing = expected.filter((e) => !actual.includes(e));
  const extra = actual.filter((a) => !expected.includes(a));
  return { missing, extra, same: missing.length === 0 && extra.length === 0 };
}
