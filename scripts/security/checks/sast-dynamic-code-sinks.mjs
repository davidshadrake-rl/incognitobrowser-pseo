/**
 * Every dynamic-code and raw-HTML sink in the shipped tree must be named in an
 * allowlist, and every allowlist entry must still correspond to a real sink.
 *
 * What this is for. There is exactly ONE eval-class sink in the product today:
 * components/CalculatorPage.tsx:102 runs `new Function('inputs', ...names, formula)`
 * over formula strings that scripts/generate-content.ts wrote with the Anthropic
 * SDK, and that single call is why next.config.ts has to keep
 * `script-src 'unsafe-eval'` for all ~1,400 static pages. A second one is not
 * free: it entrenches the weakest directive in the CSP. The same goes for
 * `child_process` — harmless in scripts/, which a developer runs, and a different
 * proposition in lib/, which the ib-api route handlers import.
 *
 * What the existing suite already does, so this does not repeat it.
 * tests/xss-protection.test.ts reads components/tools/ with readdirSync and bans
 * eval and `.innerHTML =` across whatever is in there, so tool number twelve IS
 * covered for those two. What is NOT covered is app/ and the rest of components/,
 * and its dangerouslySetInnerHTML assertion runs over a hardcoded list of 11
 * filenames inside a try/catch that swallows a missing file. This check sweeps
 * the whole tree instead of listing it.
 *
 * What is deliberately NOT flagged, and why it would otherwise poison the check:
 *   - Comments. This repo documents its own sinks in prose — searching for
 *     `new Function(` in CalculatorPage.tsx returns the call on line 102 and the
 *     comment on line 88 that explains it, and three files mention
 *     dangerouslySetInnerHTML only in comments. Everything is matched against
 *     comment- and string-stripped source (see sast-lib.mjs).
 *   - scripts/ and tests/ and e2e/. Developer-run, never served. Reported at
 *     'low' when a shipped-only sink appears there, and `child_process` is
 *     expected there (scripts/promote-all.mjs, scripts/stamp-updated.ts) so it is
 *     not reported at all.
 *   - data/ and public/adtest/. 500 scanned third-party sites and deliberately
 *     ad-shaped bait files. Not source, never walked.
 *   - `.eval(` as a method call, and any identifier ending in eval, so
 *     `safeEval`, `retrieval` and `medieval` do not match.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { walk, read, stripComments, lineAt, lineText } from './sast-lib.mjs';

/** The shipped tree: everything here ends up in a browser or in the ib-api process. */
const SHIPPED = ['app', 'lib', 'components'];
/** Developer-run. Scanned at lower severity so a sink migrating here is still visible. */
const TOOLING = ['scripts'];

/**
 * This security suite's own source is a catalogue of sink names by definition —
 * the patterns above spell out every one of them. Comment and literal stripping
 * handles most of that, but the check would still be reading itself, which
 * proves nothing and reads as noise. Excluded, by path, on purpose.
 */
const EXCLUDE_PREFIX = 'scripts/security/';

const SINKS = [
  {
    sink: 'eval(',
    // `(^|[^.\w$])` so `.eval(`, `safeEval(` and `retrieval(` do not match.
    re: /(^|[^.\w$])eval\s*\(/g,
    what: 'eval()',
  },
  {
    sink: 'new Function(',
    re: /new\s+Function\s*\(/g,
    what: 'new Function()',
  },
  {
    sink: 'setTimeout-string',
    // setTimeout/setInterval whose first argument is a string literal. After
    // stripComments the literal's body is blanked but its quotes survive, so a
    // quote right after the paren is the signal.
    re: /\bset(?:Timeout|Interval)\s*\(\s*['"`]/g,
    what: 'setTimeout/setInterval with a string body (an eval in disguise)',
  },
  {
    sink: 'dangerouslySetInnerHTML',
    re: /dangerouslySetInnerHTML/g,
    what: 'dangerouslySetInnerHTML',
  },
  {
    sink: 'innerHTML-assign',
    re: /\.(?:inner|outer)HTML\s*=(?!=)/g,
    what: 'assignment to innerHTML/outerHTML',
  },
  {
    sink: 'insertAdjacentHTML',
    re: /\.insertAdjacentHTML\s*\(/g,
    what: 'insertAdjacentHTML()',
  },
  {
    sink: 'document.write',
    re: /\bdocument\s*\.\s*write(?:ln)?\s*\(/g,
    what: 'document.write()',
  },
  {
    sink: 'child_process',
    re: /from\s*['"](?:node:)?child_process['"]|require\s*\(\s*['"](?:node:)?child_process['"]/g,
    what: 'an import of child_process',
    shippedOnly: true,
  },
  {
    sink: 'node-vm',
    re: /from\s*['"](?:node:)?vm['"]|require\s*\(\s*['"](?:node:)?vm['"]/g,
    what: 'an import of node:vm',
    shippedOnly: true,
  },
  {
    sink: 'worker_threads',
    re: /from\s*['"](?:node:)?worker_threads['"]|require\s*\(\s*['"](?:node:)?worker_threads['"]/g,
    what: 'an import of node:worker_threads',
    shippedOnly: true,
  },
];

// The import/require regexes have to see the module specifier, which
// stripComments blanks. They run against the raw source instead; a commented-out
// import is rare enough, and loud enough when it fires, to be worth the trade.
const RAW_MATCH = new Set(['child_process', 'node-vm', 'worker_threads']);

function findSinks(src, stripped) {
  const hits = [];
  for (const s of SINKS) {
    const haystack = RAW_MATCH.has(s.sink) ? src : stripped;
    s.re.lastIndex = 0;
    let m;
    while ((m = s.re.exec(haystack))) {
      const at = m.index + (m[1] ? m[1].length : 0);
      hits.push({ sink: s.sink, what: s.what, shippedOnly: Boolean(s.shippedOnly), offset: at });
    }
  }
  return hits;
}

export default check({
  id: 'sast-dynamic-code-sinks',
  discipline: 'sast',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Sweeps app/, lib/ and components/ for eval-class and raw-HTML sinks and fails any that is not named, with a reason, in scripts/security/data/sast-sink-allowlist.json.',
  async run(ctx) {
    const root = ctx.repoRoot;
    const allowPath = join(root, 'scripts/security/data/sast-sink-allowlist.json');
    const allow = JSON.parse(readFileSync(allowPath, 'utf-8')).entries;

    const findings = [];
    let checked = 0;
    const seen = new Set(); // `${file}::${sink}` actually found on disk

    const scan = (dirs, shipped) => {
      for (const dir of dirs) {
        for (const rel of walk(root, dir, ['.ts', '.tsx', '.js', '.jsx', '.mjs'])) {
          if (rel.startsWith(EXCLUDE_PREFIX)) continue;
          checked++;
          const src = read(root, rel);
          const stripped = stripComments(src);
          for (const hit of findSinks(src, stripped)) {
            if (!shipped && hit.shippedOnly) continue; // child_process in scripts/ is the job
            seen.add(`${rel}::${hit.sink}`);
            const allowed = allow.some((a) => a.file === rel && a.sink === hit.sink);
            if (allowed) continue;
            findings.push(finding({
              severity: shipped ? (hit.sink === 'dangerouslySetInnerHTML' ? 'medium' : 'high') : 'low',
              title: `Unlisted ${hit.what} in ${shipped ? 'shipped' : 'developer-run'} code: ${rel}`,
              detail: shipped
                ? 'This runs in a visitor\'s browser or in the ib-api process. Every sink of this class has to be looked at by a person and written down, because the CSP that permits them is sitewide: the one existing new Function() is why script-src keeps \'unsafe-eval\' on all ~1,400 pages.'
                : 'scripts/ is developer-run, so this is not a live exposure — but a sink that appears here usually moves, and lib/ is imported by the ib-api route handlers.',
              evidence: `${rel}:${lineAt(src, hit.offset)}  ${lineText(src, hit.offset).slice(0, 160)}`,
              remediation: `Remove the sink, or add {"file": "${rel}", "sink": "${hit.sink}", "reason": "..."} to scripts/security/data/sast-sink-allowlist.json with a reason that says why it is safe.`,
              file: rel,
              line: lineAt(src, hit.offset),
            }));
          }
        }
      }
    };

    scan(SHIPPED, true);
    scan(TOOLING, false);

    // An allowlist entry whose sink is gone is the rot case: the file was
    // renamed or the sink removed, and the entry now silently excuses nothing —
    // or, worse, would excuse a NEW sink that later lands in that file.
    for (const a of allow) {
      checked++;
      if (!seen.has(`${a.file}::${a.sink}`)) {
        findings.push(finding({
          severity: 'low',
          title: `Stale allowlist entry: ${a.file} no longer contains ${a.sink}`,
          detail: 'The allowlist is a record of sinks a person reviewed. An entry that matches nothing means the file moved or the sink went away, and leaving it there pre-approves whatever lands in that path next.',
          evidence: `scripts/security/data/sast-sink-allowlist.json names {"file": "${a.file}", "sink": "${a.sink}"}; no such sink was found in the scanned tree (${SHIPPED.join(', ')}).`,
          remediation: 'Delete the entry, or update its `file` to wherever the sink moved.',
          file: 'scripts/security/data/sast-sink-allowlist.json',
        }));
      }
    }

    return { findings, checked };
  },
});
