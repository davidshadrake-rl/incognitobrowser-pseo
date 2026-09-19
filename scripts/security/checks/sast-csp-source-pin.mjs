/**
 * Pin the Content-Security-Policy that next.config.ts builds, directive by
 * directive, offline, on every commit.
 *
 * Why. HEAD is two commits away from ffa99bc, "fix(security): the live CSP still
 * allowed two soon-to-be-strangers' domains" — this repo shipped a CSP
 * regression this week, and the guard that was meant to catch it never opened
 * the file that sets the policy. next.config.ts:48 is
 * `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, and that 'unsafe-eval' is
 * load-bearing for exactly one reason: components/CalculatorPage.tsx:102 runs
 * generated formula strings through new Function(). A directive that is
 * load-bearing and undocumented in any test is a directive that drifts.
 *
 * What this does NOT do, so nobody reads it as more than it is. It pins the
 * SOURCE, and only next.config.ts, which governs the API server build.
 * The static sites' headers come from scripts/droplet-htaccess.conf, and what
 * is actually SERVED is a live question — both of those belong to
 * dast-header-parity, which already compares the two sources against the live
 * responses and rejects a host source in any fetch directive. The gap this fills
 * is that dast-header-parity needs the network, so on a laptop and in the
 * every-commit suite it skips, and nothing at all reads this policy. This does,
 * in 3 ms, with no network.
 *
 * It is an EXACT SET per directive, not a "contains". A directive that gains a
 * source fails as loudly as one that loses a source, because 'unsafe-eval'
 * quietly appearing in style-src or a `data:` in script-src is the regression
 * shape that a contains-check waves through. The expected sets live in
 * scripts/security/data/sast-csp-expected.json with the reasoning beside them.
 */
import { readFileSync } from 'node:fs';
import { check, finding, Skip, diffLists } from '../lib/harness.mjs';
import { read, lineAt } from './sast-lib.mjs';

const expectedData = () => JSON.parse(readFileSync(new URL('../data/sast-csp-expected.json', import.meta.url), 'utf-8'));

/**
 * Pull the CSP out of next.config.ts textually rather than by importing it.
 * The config uses __dirname, which does not exist in an ES module, so importing
 * it here would throw — and a check that throws teaches nobody anything.
 */
function parseCsp(src) {
  const at = src.indexOf('"Content-Security-Policy"');
  if (at === -1) return { error: 'no "Content-Security-Policy" key found' };
  const open = src.indexOf('[', at);
  const close = src.indexOf(']', open);
  if (open === -1 || close === -1) return { error: 'the value after the Content-Security-Policy key is not an array literal' };
  const body = src.slice(open + 1, close);
  const parts = [...body.matchAll(/"([^"]*)"|'([^']*)'/g)].map((m) => (m[1] !== undefined ? m[1] : m[2]));
  if (!parts.length) return { error: 'the CSP array literal contains no string literals' };
  const joinAt = src.slice(close, close + 40);
  if (!/\.join\(\s*["']; ["']\s*\)/.test(joinAt)) {
    return { error: `the CSP array is not joined with "; " — found ${JSON.stringify(joinAt.trim().slice(0, 30))}` };
  }
  return { at: open, directives: parts };
}

function parseSimpleHeaders(src) {
  const out = new Map();
  for (const m of src.matchAll(/\{\s*key:\s*["']([^"']+)["'],\s*value:\s*["']([^"']*)["']\s*\}/g)) {
    out.set(m[1], m[2]);
  }
  return out;
}

export default check({
  id: 'sast-csp-source-pin',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Compares the CSP and the fixed security headers declared in next.config.ts against an exact expected set, offline, so a directive cannot gain or lose a source unnoticed.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const src = read(root, 'next.config.ts');
    const want = expectedData();
    const findings = [];
    let checked = 0;

    const parsed = parseCsp(src);
    // A broken parse is a SKIP, not a pass. The whole point of this suite is
    // that a check which silently grades nothing is worse than no check.
    if (parsed.error) {
      throw new Skip(`cannot parse the CSP out of next.config.ts: ${parsed.error} — fix this parser rather than letting it report green`);
    }

    const got = new Map();
    for (const d of parsed.directives) {
      const [name, ...sources] = d.trim().split(/\s+/);
      got.set(name, sources);
    }

    for (const [name, sources] of Object.entries(want.directives)) {
      checked++;
      if (!got.has(name)) {
        findings.push(finding({
          severity: 'high',
          title: `CSP directive removed from next.config.ts: ${name}`,
          detail: 'Removing a directive does not tighten anything — most of these fall back to default-src, and frame-ancestors, form-action and base-uri fall back to nothing at all.',
          evidence: `next.config.ts:${lineAt(src, parsed.at)} declares [${[...got.keys()].join(', ')}]; ${name} is expected and absent.`,
          remediation: `Restore \`${name} ${sources.join(' ')}\`, or change scripts/security/data/sast-csp-expected.json and say why in its _comment.`,
          file: 'next.config.ts',
          line: lineAt(src, parsed.at),
        }));
        continue;
      }
      const d = diffLists(sources, got.get(name));
      if (!d.same) {
        findings.push(finding({
          severity: 'high',
          title: `CSP ${name} no longer matches the pinned set`,
          detail: d.extra.length
            ? 'A source was ADDED. Every source in this policy is a permitted destination for any future injection, and a host source is one anybody can register once the domain lapses — which is exactly what commit ffa99bc had to clean up.'
            : 'A source was REMOVED. That may be correct, but it changes what the app can load and nothing else records the decision.',
          evidence: `next.config.ts: ${name} ${got.get(name).join(' ')}  |  expected: ${name} ${sources.join(' ') || '(no sources)'}${d.extra.length ? `  |  added: ${d.extra.join(', ')}` : ''}${d.missing.length ? `  |  removed: ${d.missing.join(', ')}` : ''}`,
          remediation: 'Revert the directive, or update scripts/security/data/sast-csp-expected.json in the same commit with the reason.',
          file: 'next.config.ts',
          line: lineAt(src, parsed.at),
        }));
      }
    }

    for (const name of got.keys()) {
      if (!(name in want.directives)) {
        checked++;
        findings.push(finding({
          severity: 'medium',
          title: `Undeclared CSP directive in next.config.ts: ${name}`,
          detail: 'A directive nobody wrote down is a directive nobody reviewed. It may well be an improvement; it still has to be recorded so the next drift is visible against something.',
          evidence: `next.config.ts: ${name} ${got.get(name).join(' ')} — not present in scripts/security/data/sast-csp-expected.json`,
          remediation: 'Add it to the expected set with a reason.',
          file: 'next.config.ts',
          line: lineAt(src, parsed.at),
        }));
      }
    }

    // 'unsafe-eval' is permitted in exactly one directive and for exactly one
    // reason (CalculatorPage's new Function). Spreading it is a separate failure
    // from a directive's set changing, and reads better as its own finding.
    for (const [name, sources] of got) {
      if (!sources.includes("'unsafe-eval'")) continue;
      checked++;
      if (!want.unsafeEvalAllowedIn.includes(name)) {
        findings.push(finding({
          severity: 'high',
          title: `'unsafe-eval' has spread to CSP ${name}`,
          detail: "The policy carries 'unsafe-eval' for one call — components/CalculatorPage.tsx:102 — and only in script-src. Anywhere else it is pure loss.",
          evidence: `next.config.ts: ${name} ${sources.join(' ')}`,
          remediation: `Remove 'unsafe-eval' from ${name}.`,
          file: 'next.config.ts',
          line: lineAt(src, parsed.at),
        }));
      }
    }

    const headers = parseSimpleHeaders(src);
    for (const [name, value] of Object.entries(want.requiredHeaders)) {
      checked++;
      const actual = headers.get(name);
      if (actual !== value) {
        findings.push(finding({
          severity: actual === undefined ? 'high' : 'medium',
          title: actual === undefined ? `Security header dropped from next.config.ts: ${name}` : `Security header changed: ${name}`,
          detail: 'These are the headers the API server build sends on every response. dast-header-parity checks that what is SERVED matches this file; this checks that this file still says the right thing, which is the half that runs without a network.',
          evidence: `next.config.ts: ${name} = ${actual === undefined ? '(absent)' : JSON.stringify(actual)}; expected ${JSON.stringify(value)}`,
          remediation: 'Restore the header, or update scripts/security/data/sast-csp-expected.json with the reason.',
          file: 'next.config.ts',
        }));
      }
    }

    return { findings, checked };
  },
});
