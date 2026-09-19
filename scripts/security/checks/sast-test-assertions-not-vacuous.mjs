/**
 * A security test that grades nothing must not report green.
 *
 * This is the founding failure of this whole suite, applied to the suite it is
 * built beside. tests/ssrf-protection.test.ts graded a hand-copied REPLICA of
 * the function it claimed to test and stayed green through two live SSRF
 * bypasses. The removed-platform guard never opened the .conf that sets the live
 * CSP, so two dead third-party origins sat in connect-src for weeks. Both were
 * green the entire time. The runner already refuses to print a tick for a check
 * that inspected 0 items; this is the same idea aimed at tests/.
 *
 * Two shapes, both confirmed present in tests/ today.
 *
 * 1. AN ASSERTION INSIDE A TRY WITH A SILENT CATCH.
 *    tests/xss-protection.test.ts:158-166 loops over 11 hardcoded component
 *    paths and asserts none of them uses dangerouslySetInnerHTML — inside
 *    `try { ... } catch { /* File might not exist, skip *\/ }`. Rename or move
 *    any of those 11 files and the test passes while checking nothing. The whole
 *    point of a guard like that is to survive a refactor, and a refactor is the
 *    one thing that disables it. Flagged only when the try body contains an
 *    `expect(` and the catch body contains no `expect(`, no `throw` and no
 *    `fail(` — a catch that re-asserts or rethrows is fine, and so is a try/catch
 *    with no assertion in it at all (setup, cleanup, a deliberate parse probe).
 *
 * 2. A HARDCODED PATH LITERAL THAT NO LONGER EXISTS.
 *    A list of filenames in a test is a promise that those files are the thing
 *    being graded. When one stops resolving, the loop quietly shrinks.
 *    Deliberately EXCLUDED: a test whose enclosing `it()` asserts that a file is
 *    ABSENT — tests/no-vercel.test.ts:55 checks that vercel.json,
 *    scripts/vercel-ignore.sh and scripts/deploy-prod-bitnami.sh are gone, and
 *    those three SHOULD NOT resolve. Without that exclusion this check would
 *    report two false positives on the day it landed, which is how a check gets
 *    switched off. Only literals that look like repo-relative source paths are
 *    considered; URLs, globs and bare filenames are not.
 *
 * Scope is tests/ only. It does not grade what the tests assert — only whether
 * the assertions can run at all.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { walk, read, stripComments, lineAt, lineText } from './sast-lib.mjs';

/** Looks like a repo-relative path to a file this repo ships. */
const PATH_RE = /^(?:app|lib|components|scripts|data|public|e2e|tests)\/[A-Za-z0-9_.\-/[\]]+\.(?:ts|tsx|mjs|js|json|conf|sh|css|html)$/;

/** Index of the character after the block opened by the `{` at `open`. */
function endOfBlock(s, open) {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  return s.length;
}

/** The `it(...)`/`test(...)` block containing `offset`, as text, or ''. */
function enclosingCase(stripped, offset) {
  const before = stripped.slice(0, offset);
  const at = Math.max(before.lastIndexOf('it('), before.lastIndexOf('test('));
  if (at === -1) return '';
  const open = stripped.indexOf('{', at);
  if (open === -1) return '';
  return stripped.slice(at, endOfBlock(stripped, open));
}

export default check({
  id: 'sast-test-assertions-not-vacuous',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Finds tests whose assertions can silently not run — an expect() inside a try with a swallowing catch, or a hardcoded file path that no longer resolves.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const findings = [];
    let checked = 0;

    for (const rel of walk(root, 'tests', ['.ts', '.tsx', '.mjs'])) {
      const src = read(root, rel);
      // Strip comments, keep strings: half of what is being looked for IS a
      // string literal, and the catch bodies of interest are comment-only.
      const stripped = stripComments(src, { strings: false });
      // A separate fully-stripped copy for the code-shape half, so a path
      // mentioned in a comment is not mistaken for a catch body's contents.
      const code = stripComments(src);

      // ── 1. expect() inside a try with a swallowing catch ─────────────────
      const tryRe = /\btry\s*\{/g;
      let m;
      while ((m = tryRe.exec(code))) {
        const tryOpen = code.indexOf('{', m.index);
        const tryEnd = endOfBlock(code, tryOpen);
        const tryBody = code.slice(tryOpen, tryEnd);
        const after = code.slice(tryEnd);
        const cm = /^\s*catch\s*(?:\([^)]*\))?\s*\{/.exec(after);
        if (!cm) continue;
        const catchOpen = tryEnd + cm[0].length - 1;
        const catchBody = code.slice(catchOpen + 1, endOfBlock(code, catchOpen) - 1);
        checked++;
        if (!/expect\s*\(/.test(tryBody)) continue;              // nothing graded in there anyway
        if (/expect\s*\(|throw\b|fail\s*\(/.test(catchBody)) continue; // catch re-asserts or rethrows
        findings.push(finding({
          severity: 'medium',
          title: `Assertion can be silently skipped: ${rel}`,
          detail: 'The expect() in this try block never runs if anything above it throws — a renamed file, a changed export, a parse error — and the test still passes. That is the exact shape that let tests/ssrf-protection.test.ts stay green through two live SSRF bypasses.',
          evidence: `${rel}:${lineAt(src, m.index)}  ${lineText(src, m.index).slice(0, 80)} … catch body is ${catchBody.trim() ? JSON.stringify(catchBody.trim().slice(0, 60)) : 'empty'} (original comment: ${JSON.stringify((src.slice(catchOpen, endOfBlock(code, catchOpen)).match(/\/\*([\s\S]*?)\*\/|\/\/(.*)/) || [, ''])[0] || '(none)').slice(0, 60)})`,
          remediation: 'Assert the precondition instead of swallowing it: read the file outside the try and `expect(existsSync(p), `${p} is gone — this test is no longer checking anything`).toBe(true)`, or let the read throw and fail the test.',
          file: rel,
          line: lineAt(src, m.index),
        }));
      }

      // ── 2. hardcoded path literals that no longer resolve ────────────────
      for (const lm of stripped.matchAll(/['"]([^'"\n]{4,160})['"]/g)) {
        const value = lm[1];
        if (!PATH_RE.test(value)) continue;
        checked++;
        if (existsSync(join(root, value))) continue;
        // A test that asserts the file is GONE is the opposite case and is fine.
        const block = enclosingCase(stripped, lm.index);
        if (/existsSync[\s\S]{0,240}?(?:toBe\(false\)|not\.toBe\(true\)|toBeFalsy\(\))/.test(block)) continue;
        findings.push(finding({
          severity: 'medium',
          title: `Test names a file that does not exist: ${value}`,
          detail: 'A hardcoded list of paths in a test is the list of things it grades. A path that no longer resolves means the list quietly shrank, and the test keeps passing with less coverage than its name claims.',
          evidence: `${rel}:${lineAt(stripped, lm.index)}  ${lineText(src, lm.index).slice(0, 140)}  — ${value} is not on disk.`,
          remediation: 'Point the test at the file\'s new path, or delete the entry — and make the loop assert that every path it names resolves, so the next rename fails loudly.',
          file: rel,
          line: lineAt(stripped, lm.index),
        }));
      }
    }

    return { findings, checked };
  },
});
