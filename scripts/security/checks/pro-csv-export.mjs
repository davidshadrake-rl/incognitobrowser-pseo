/**
 * The Pro CSV export must stay boring: text cells, and no cookie values.
 *
 * Why a source check on top of tests/pro-csv-export.test.ts — the unit tests
 * grade the exported helpers, which is the right place to prove behaviour. But
 * the two properties that matter here are properties of the FILE THAT SHIPS:
 *
 *   A. Every cell goes through csvCell(), and csvCell() still neutralises a
 *      leading =, +, -, @, tab or CR. The names in this file are chosen by the
 *      scanned site; the person opening the file is an auditor. A refactor that
 *      reintroduces a local `escape = s => '"' + s + '"'` would leave the unit
 *      tests green (they test csvCell) while the download goes back to handing
 *      a formula to Excel.
 *   B. The builder writes c.cookieName and touches no value field. A cookie's
 *      value on the scanned site can be a live session token; it is worth
 *      nothing in a privacy inventory and everything to whoever gets the file.
 *
 * Both are cheap greps over one file, so they run on every commit, where the
 * suite is deploy-blocking (tests/security-suite.test.ts).
 *
 * This check does NOT grade the upgrade gate in front of the export — that is
 * pentest-gate-inventory's job, and the gate is a copy boundary by design.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

const REL = 'components/tools/CookieAnalyzerTool.tsx';

/** Brace-match a function body starting at the first `{` at or after `from`. */
function bodyFrom(src, from) {
  const open = src.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

function lineOf(src, index) {
  return index >= 0 ? src.slice(0, index).split('\n').length : null;
}

/**
 * The openings a spreadsheet treats as the start of a formula. Each one is fed
 * to the guard's own regexes, so this check grades behaviour rather than a
 * particular way of writing it.
 */
const DANGEROUS_STARTS = [
  ['=', "=cmd|'/c calc'!A0"],
  ['+', '+2+5'],
  ['-', '-2+5'],
  ['@', '@SUM(1)'],
  ['a leading tab', '\t=1+1'],
  ['a leading CR', '\r=1+1'],
];

/** A value field on a cookie record. `raw` carries "name=value" verbatim. */
const VALUE_FIELDS = [
  { re: /\bc\.value\b/, name: 'c.value' },
  { re: /\bc\.raw\b/, name: 'c.raw' },
  { re: /\bcookie\.value\b/, name: 'cookie.value' },
  { re: /\bcookie\.raw\b/, name: 'cookie.raw' },
];

export default check({
  id: 'pro-csv-export-no-formulas-no-values',
  discipline: 'pentest',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The Pro cookie CSV still neutralises spreadsheet formulas in every cell and still exports cookie names, never cookie values.',
  async run(ctx) {
    const path = join(ctx.repoRoot, REL);
    if (!existsSync(path)) throw new Skip(`${REL} is missing — the only paid export cannot be graded`);
    const src = readFileSync(path, 'utf-8');

    const findings = [];
    let checked = 0;

    // ---- A. the neutralisation is still in csvCell ------------------------
    const cellIdx = src.search(/export function csvCell\s*\(/);
    checked++;
    if (cellIdx < 0) {
      findings.push(finding({
        severity: 'high', file: REL, line: null,
        title: 'csvCell() is gone — CSV cells are escaped by something ungraded',
        detail: 'The export used to build cells with a local `escape` that only doubled quotes. csvCell() is the one place that also neutralises spreadsheet formulas, and tests/pro-csv-export.test.ts imports it by name. If it no longer exists, neither the unit tests nor this check is grading what the download actually writes.',
        evidence: `${REL}: no \`export function csvCell(\``,
        remediation: 'Restore the exported csvCell() and build every cell with it.',
      }));
    } else {
      const body = bodyFrom(src, cellIdx);
      const line = lineOf(src, cellIdx);
      /**
       * Don't grep for a spelling — run the guard's own regexes against the
       * payloads. Every anchored regex literal in csvCell() and the ~600 bytes
       * before it (where the shared constant lives) is compiled and asked
       * whether it recognises each dangerous opening character. A rewrite that
       * keeps the shape but drops `@` fails here, which a grep would not.
       */
      const window = src.slice(Math.max(0, cellIdx - 600), cellIdx + body.length);
      const literals = [];
      for (const m of window.matchAll(/\/(\^[^/\n]*)\//g)) {
        try { literals.push(new RegExp(m[1])); } catch { /* not a usable literal */ }
      }
      const missed = DANGEROUS_STARTS.filter(([, payload]) => !literals.some((re) => re.test(payload)));
      const prefixes = /`'\$\{/.test(body) || /"'"\s*\+/.test(body) || /'\\''/.test(body);
      if (missed.length || !prefixes) {
        findings.push(finding({
          severity: 'high', file: REL, line,
          title: 'The CSV export no longer neutralises spreadsheet formulas',
          detail: 'A cell beginning =, +, -, @, tab or CR is evaluated by Excel, Sheets and LibreOffice when the file opens. Cookie and tracker names come from the scanned site, so the site controls those cells, and the reader is an auditor examining a site they already distrust. Prefixing such a cell with an apostrophe makes the spreadsheet treat it as text.',
          evidence: missed.length
            ? `${REL}:${line}: no regex in csvCell() recognises ${missed.map(([n]) => n).join(', ')} (tested against ${literals.length} anchored literal(s))`
            : `${REL}:${line}: csvCell() recognises the dangerous prefixes but never prefixes the cell with an apostrophe`,
          remediation: "Keep the CSV_FORMULA_START test and the leading apostrophe in csvCell(); see tests/pro-csv-export.test.ts (pro_csv_formula_injection).",
        }));
      }
      const doublesQuotes = /replace\(\s*\/"\/g\s*,\s*'""'\s*\)/.test(body);
      checked++;
      if (!doublesQuotes) {
        findings.push(finding({
          severity: 'medium', file: REL, line,
          title: 'csvCell() no longer doubles embedded quotes',
          detail: 'Quote doubling is what stops a value ending a field early and shifting every later column — including Third-Party and Risk, which is how an audit reads the wrong verdict off the right data.',
          evidence: `${REL}:${line}: csvCell() body has no replace(/"/g, '""')`,
          remediation: 'Restore the quote doubling alongside the formula neutralisation.',
        }));
      }
    }

    // ---- B. the builder writes names, not values --------------------------
    const buildIdx = src.search(/export function buildCookieCsv\s*\(/);
    checked++;
    if (buildIdx < 0) {
      findings.push(finding({
        severity: 'high', file: REL, line: null,
        title: 'buildCookieCsv() is gone — the CSV is assembled somewhere ungraded',
        detail: 'The export body was moved out of the component so the rows could be built and asserted without a browser. If it is inlined again, the assertions that no cookie value reaches the file are grading a function nothing calls.',
        evidence: `${REL}: no \`export function buildCookieCsv(\``,
        remediation: 'Keep the row building in the exported buildCookieCsv() that downloadCsv() calls.',
      }));
    } else {
      const body = bodyFrom(src, buildIdx);
      const line = lineOf(src, buildIdx);
      checked++;
      if (!/\bc\.cookieName\b/.test(body)) {
        findings.push(finding({
          severity: 'high', file: REL, line,
          title: 'The CSV no longer writes c.cookieName',
          detail: 'The Name column is meant to be the cookie NAME from lib/scanner\'s list. Anything else in that column either loses the inventory\'s meaning or starts carrying the cookie\'s contents.',
          evidence: `${REL}:${line}: buildCookieCsv() body does not reference c.cookieName`,
          remediation: 'Write c.cookieName in the Name column.',
        }));
      }
      const leak = VALUE_FIELDS.find((f) => f.re.test(body));
      if (leak) {
        findings.push(finding({
          severity: 'critical', file: REL, line,
          title: `The CSV export now writes a cookie value (${leak.name})`,
          detail: 'A cookie set by the scanned site can be a live session token, a signed identifier or a cart. It tells a privacy audit nothing that the name and attributes do not, and the export is a file people mail to clients. Exporting values turns a cookie inventory into a credential dump for whoever holds the CSV.',
          evidence: `${REL}:${line}: buildCookieCsv() references ${leak.name}`,
          remediation: 'Export cookieName, category, risk and the attributes only. Values stay in the browser.',
        }));
      }
      checked++;
      const header = /COOKIE_CSV_COLUMNS\s*=\s*\[([^\]]*)\]/.exec(src);
      if (header && /['"](?:[^'"]*\b(?:value|raw|token)\b[^'"]*)['"]/i.test(header[1])) {
        findings.push(finding({
          severity: 'critical', file: REL, line: lineOf(src, header.index),
          title: 'The CSV header declares a value column',
          detail: 'A column named for the cookie\'s contents means the contents are being written, whatever the row builder looks like today.',
          evidence: `${REL}: COOKIE_CSV_COLUMNS = [${header[1].replace(/\s+/g, ' ').trim().slice(0, 200)}]`,
          remediation: 'Drop the column. The inventory is name + attributes.',
        }));
      }
    }

    // ---- C. the download actually goes through both -----------------------
    const dlIdx = src.search(/const downloadCsv\s*=/);
    checked++;
    if (dlIdx < 0) {
      throw new Skip('downloadCsv() not found in CookieAnalyzerTool.tsx — the gated export may have been renamed; this check graded nothing about the shipped download');
    }
    const dlBody = bodyFrom(src, dlIdx);
    const dlLine = lineOf(src, dlIdx);
    if (!/buildCookieCsv\s*\(/.test(dlBody)) {
      findings.push(finding({
        severity: 'high', file: REL, line: dlLine,
        title: 'downloadCsv() builds its own rows again',
        detail: 'The download no longer goes through buildCookieCsv(), so the formula neutralisation and the no-values rule that the unit tests prove are not on the path the visitor actually triggers. This is the exact shape of the original bug: a local escape helper that only doubled quotes.',
        evidence: `${REL}:${dlLine}: downloadCsv() does not call buildCookieCsv()`,
        remediation: 'Have downloadCsv() serialise with buildCookieCsv() and nothing else.',
      }));
    }
    checked++;
    if (!/cookieCsvFilename\s*\(/.test(dlBody)) {
      findings.push(finding({
        severity: 'medium', file: REL, line: dlLine,
        title: 'The download filename is no longer sanitised',
        detail: 'new URL().hostname is not filename-safe as it comes: an IPv6 host arrives bracketed, and result.url is a string the visitor typed. cookieCsvFilename() folds it to [a-z0-9.-] before it becomes a file on someone\'s disk.',
        evidence: `${REL}:${dlLine}: downloadCsv() does not call cookieCsvFilename()`,
        remediation: 'Set a.download from cookieCsvFilename(result.url).',
      }));
    }

    return { findings, checked };
  },
});
