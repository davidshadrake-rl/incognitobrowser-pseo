/**
 * Shared plumbing for the SAST checks. Exports no checks of its own — the
 * runner imports every .mjs in this directory and skips a module whose default
 * export carries no `id`, which is why the default here is an empty array.
 *
 * Two things live here because getting either one wrong is how a source-reading
 * check turns into the thing nobody trusts:
 *
 *  - stripComments(). This repo documents its own sinks in prose. Search for
 *    `new Function(` in components/CalculatorPage.tsx and you get two hits: the
 *    call on line 102 and the comment on line 88 that explains it. A grep-based
 *    check that cannot tell those apart reports a finding that is a sentence,
 *    and the next person switches it off. Same story for the three files whose
 *    comments name dangerouslySetInnerHTML without using it.
 *
 *  - loadTs(). The checks that time real code must import the REAL module, not
 *    a copy of it. tests/ssrf-protection.test.ts graded a hand-copied replica of
 *    the function it claimed to test and stayed green through two live SSRF
 *    bypasses; that is the mistake this whole suite was built after. Node 22.18+
 *    strips TypeScript types natively, and lib/scanner.ts, lib/screenshot-leak.ts,
 *    lib/link-unwrapper.ts and lib/email-pixel.ts have no imports at all, so a
 *    plain dynamic import of the .ts file loads the shipped source with no
 *    bundler, no transform step and nothing to drift out of sync.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Skip } from '../lib/harness.mjs';

export default [];

/** Every file under `dir` with one of `exts`, repo-relative, sorted, node_modules excluded. */
export function walk(root, dir, exts) {
  const out = [];
  const abs = join(root, dir);
  let entries;
  try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(abs, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '.next' || e.name === 'out') continue;
      out.push(...walk(root, relative(root, p), exts));
    } else if (exts.some((x) => e.name.endsWith(x))) {
      out.push(relative(root, p).split(sep).join('/'));
    }
  }
  return out.sort();
}

export function read(root, rel) {
  return readFileSync(join(root, rel), 'utf-8');
}

/**
 * Blank out comments and string/template literals while keeping every byte
 * offset and every newline, so a line number computed on the stripped text is
 * the line number in the real file.
 *
 * String literals go too by default, deliberately: `describe('no eval here')`
 * and the error copy in normalizeInput both contain sink names. Pass
 * `{ strings: false }` when the thing being looked for IS a string literal —
 * `request.headers.get('content-length')` is the case that forced the option,
 * since blanking the header name made all four bounded routes look unbounded.
 * Comments still go in that mode, which is the point: all four of those routes
 * also EXPLAIN the content-length check in a comment right above it.
 *
 * Regex literals are blanked as well, and that is not optional — the first
 * version of this function skipped them and the sink check immediately reported
 * three false positives against its own source, because a pattern like
 * /\bsetTimeout\s*\(\s*['"`]/ contains a quote and a backtick that desynchronised
 * the string scanner for the rest of the file. Telling a regex literal from
 * division needs the previous token, so that is what the `prev` heuristic below
 * does; it is the standard one, and the failure mode if it ever guesses wrong is
 * a blanked expression, never a runaway.
 */
export function stripComments(src, { strings = true } = {}) {
  const out = src.split('');
  const blankStrings = strings;
  const n = src.length;
  const blank = (k) => { if (out[k] !== '\n') out[k] = ' '; };

  // `stack` holds the template literals we are inside, so a sink written inside
  // a `${ ... }` expression is still visible while the literal text around it
  // is blanked.
  const stack = [];

  /**
   * True when a `/` at `at` opens a regex literal rather than dividing.
   * A regex can only appear where a VALUE is expected, so look back at the last
   * significant character: an operator, an opening bracket, a comma, a semicolon
   * or one of the keywords below means "value expected".
   */
  // `<`, `>`, `{` and `}` are deliberately absent: these files are JSX, where
  // `</div>` and `<Foo x={y} />` would otherwise look like the start of a regex.
  const REGEX_PRECEDERS = '(,=:[!&|?;+-*%~^';
  const REGEX_KEYWORDS = /\b(?:return|typeof|instanceof|case|in|of|new|delete|void|do|else|yield|await)$/;
  const startsRegex = (at) => {
    let k = at - 1;
    while (k >= 0 && (out[k] === ' ' || out[k] === '\n' || out[k] === '\t' || out[k] === '\r')) k--;
    if (k < 0) return true;
    if (REGEX_PRECEDERS.includes(out[k])) return true;
    return REGEX_KEYWORDS.test(out.slice(Math.max(0, k - 12), k + 1).join(''));
  };

  let i = 0;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (stack.length && stack[stack.length - 1].inExpr === false) {
      // Inside template literal text.
      if (c === '\\') { if (blankStrings) { blank(i); blank(i + 1); } i += 2; continue; }
      if (c === '`') { stack.pop(); i++; continue; }
      if (c === '$' && d === '{') { stack[stack.length - 1].inExpr = true; stack[stack.length - 1].depth = 0; i += 2; continue; }
      if (blankStrings) blank(i);
      i++; continue;
    }

    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') { blank(j); j++; }
      i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = i;
      while (j < n && !(src[j] === '*' && src[j + 1] === '/')) { blank(j); j++; }
      blank(j); blank(j + 1);
      i = j + 2; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { if (blankStrings) { blank(j); blank(j + 1); } j += 2; continue; }
        if (src[j] === c) break;
        if (blankStrings) blank(j);
        j++;
      }
      i = j + 1; continue;
    }
    if (c === '`') { stack.push({ inExpr: false, depth: 0 }); i++; continue; }
    if (c === '/' && startsRegex(i)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        if (src[j] === '\\') { blank(j); blank(j + 1); j += 2; continue; }
        if (src[j] === '\n') break; // unterminated: bail rather than eat the file
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        blank(j); j++;
      }
      i = j + 1; continue;
    }
    if (stack.length && stack[stack.length - 1].inExpr) {
      const top = stack[stack.length - 1];
      if (c === '{') top.depth++;
      else if (c === '}') {
        if (top.depth === 0) { top.inExpr = false; i++; continue; }
        top.depth--;
      }
    }
    i++;
  }
  return out.join('');
}

/** 1-based line number of a byte offset. */
export function lineAt(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === '\n') line++;
  return line;
}

/** The text of the line containing `offset`, trimmed — evidence someone can grep for. */
export function lineText(src, offset) {
  const start = src.lastIndexOf('\n', offset) + 1;
  let end = src.indexOf('\n', offset);
  if (end === -1) end = src.length;
  return src.slice(start, end).trim();
}

/**
 * Import a TypeScript module from the repo by its relative path.
 *
 * Throws Skip rather than exploding if this node cannot strip types, so the
 * check announces "I did not run" instead of erroring or, worse, quietly
 * reporting nothing.
 */
export async function loadTs(root, rel) {
  try {
    return await import(pathToFileURL(join(root, rel)).href);
  } catch (err) {
    const msg = String((err && err.message) || err);
    if (/Unknown file extension|ERR_UNKNOWN_FILE_EXTENSION|strip|TypeScript/i.test(msg)) {
      throw new Skip(`cannot import ${rel} — this node (${process.version}) will not strip TypeScript types: ${msg}`);
    }
    throw err;
  }
}
