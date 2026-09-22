/**
 * The every-commit half of the security suite, run inside the unit tests.
 *
 * Why here and not only in the runner: `npm run build`, scripts/deploy.sh and
 * scripts/deploy-api.sh all run `vitest run` first. Putting these checks in
 * that suite makes them deploy-blocking for free, with no CI to set up — and
 * there is no CI here, so anything not wired to this suite is a thing someone
 * has to remember to run.
 *
 * ONLY the every-commit cadence runs here. It is offline and takes a few
 * seconds. The nightly and weekly cadences need the network and an ssh session
 * to the droplet; those have no business gating a local build, and they are
 * scheduled separately (scripts/security/install-schedule.sh).
 *
 * Three things this deliberately does NOT do:
 *
 *  - It does not swallow a check that cannot run. A SKIPPED check is reported
 *    by name. A check that ERRORS fails this test outright, because an error is
 *    a bug in the check, and a broken check silently reporting nothing is the
 *    failure mode the whole suite was built to end.
 *  - It does not pass a check that inspected zero items. "0 findings over 0
 *    things looked at" is not evidence of anything.
 *  - It does not fail on medium and below. Those are real and are in the
 *    report, but blocking every commit on them is how a team learns to reach
 *    for --no-verify. High and critical block; the rest are read in the
 *    scheduled run.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CHECKS_DIR = join(__dirname, '..', 'scripts', 'security', 'checks');

type Finding = { severity: string; title: string; evidence: string; file?: string | null };
type Outcome = { id: string; state: 'ran' | 'skipped' | 'error'; findings: Finding[]; checked: number | null; reason?: string };

async function loadEveryCommitChecks() {
  const files = readdirSync(CHECKS_DIR).filter((f) => f.endsWith('.mjs')).sort();
  const out: Array<Record<string, unknown>> = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(CHECKS_DIR, f)).href);
    const defs = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (const d of defs) {
      if (d && d.id && d.cadence === 'every-commit' && !d.needsOptIn) out.push({ ...d, file: f });
    }
  }
  return out;
}

const { buildContext } = await import('../scripts/security/lib/context.mjs' as string);

const checks = await loadEveryCommitChecks();
const ctx = buildContext({});
const outcomes: Outcome[] = [];

for (const c of checks) {
  const id = String(c.id);
  try {
    const r = await (c.run as (x: unknown) => Promise<{ findings?: Finding[]; checked?: number }>)(ctx);
    outcomes.push({ id, state: 'ran', findings: r?.findings ?? [], checked: typeof r?.checked === 'number' ? r.checked : null });
  } catch (err) {
    const e = err as Error & { isSkip?: boolean };
    outcomes.push({ id, state: e?.isSkip ? 'skipped' : 'error', findings: [], checked: 0, reason: e?.message ?? String(err) });
  }
}

const show = (f: Finding & { check?: string }) =>
  `  [${f.severity}] ${f.check ? f.check + ': ' : ''}${f.title}\n      ${f.file ? f.file + ' — ' : ''}${String(f.evidence).replace(/\n/g, ' ').slice(0, 300)}`;

// Medium findings are computed on this path and were DISCARDED here without
// being printed: the blocking test below filters to high/critical, and nothing
// else on `npm test` looked at them. `npm run security` prints them, but the
// one command everybody runs — deploy.sh's `npm test` — did not. Found by the
// 2026-09-22 audit pass (E2). They still do not block; they are now visible.
{
  const medium = outcomes
    .flatMap((o) => o.findings.map((f) => ({ ...f, check: o.id })))
    .filter((f) => f.severity === 'medium');
  if (medium.length) {
    console.warn(`\n${medium.length} medium security finding(s) — reported, not blocking:\n${medium.map(show).join('\n')}\n`);
  }
}

describe('security suite (every-commit cadence)', () => {
  it('there are checks to run at all', () => {
    // If a refactor moves or empties scripts/security/checks/, this suite would
    // otherwise report a serene green over nothing.
    expect(checks.length, 'no every-commit checks found — the suite has become decorative').toBeGreaterThan(10);
  });

  it('no check crashed', () => {
    const errored = outcomes.filter((o) => o.state === 'error');
    expect(errored.map((o) => `${o.id}: ${o.reason}`), 'a check threw — that is a bug in the check, and a broken check reports nothing').toEqual([]);
  });

  it('no high or critical findings', () => {
    const blocking = outcomes
      .flatMap((o) => o.findings.map((f) => ({ ...f, check: o.id })))
      .filter((f) => f.severity === 'high' || f.severity === 'critical');
    expect(blocking.map(show).join('\n') || '', `${blocking.length} blocking finding(s):\n${blocking.map(show).join('\n')}\n\nRun \`npm run security\` for the full report, including medium and low.`).toBe('');
  });

  it('every check that ran actually inspected something', () => {
    const vacuous = outcomes.filter((o) => o.state === 'ran' && o.checked === 0);
    expect(vacuous.map((o) => o.id), 'these checks reported success over 0 inspected items, which proves nothing').toEqual([]);
  });

  it('reports which checks could not run', () => {
    // Not a failure — some checks legitimately need a build in out/ or a
    // droplet login. But they are NAMED, so "it passed" never quietly means
    // "it did not run". The scheduled run uses --strict, where this does fail.
    const skipped = outcomes.filter((o) => o.state === 'skipped');
    if (skipped.length) {
      console.log(`\n  security suite: ${skipped.length} check(s) skipped locally:\n${skipped.map((o) => `    - ${o.id}: ${o.reason}`).join('\n')}\n`);
    }
    expect(skipped.length, 'every single check skipped — this suite is grading nothing').toBeLessThan(checks.length);
  });
});
