/**
 * Audit follow-up: the Pro CSV export, graded on the artefact rather than on
 * the helpers that feed it.
 *
 * tests/pro-csv-export.test.ts already grades csvCell(), buildCookieCsv() and
 * cookieCsvFilename() well. What nothing graded was the JOIN between them and
 * the file a visitor actually receives, and three of its assertions turned out
 * to prove less than they appear to:
 *
 *  1. THE DOWNLOAD WAS NEVER OBSERVED. downloadCsv() is a closure inside
 *     CookieAnalyzerTool and no test ever ran it. The only assertion about the
 *     saved name — tests/pro-entitlement.test.ts:179-188 — feeds the string
 *     'example.com-cookie-scan.csv' in through its own lambda and asserts it
 *     comes back out, which grades the gate, not the filename. The only check
 *     on the shipped assignment — scripts/security/checks/pro-csv-export.mjs
 *     :202 — is `/cookieCsvFilename\s*\(/.test(dlBody)`, a bare grep that
 *     `const n = cookieCsvFilename(url); a.download = 'scan.csv';` satisfies.
 *     So this file EXECUTES the shipped body of downloadCsv verbatim against a
 *     stub DOM and reads back the bytes and the name the browser would save.
 *     That closes two of the finding's three clauses: (a) a.download is
 *     assigned FROM cookieCsvFilename, and (b) the blob's bytes are
 *     buildCookieCsv's output. Clause (c), a real in-app Pro mark unlocking
 *     the button and a browser saving a file, is NOT closed here and cannot
 *     be: this harness grants no Pro mark on purpose, so nothing in it can
 *     show the gate opening or staying shut, and a stub anchor's click() is
 *     not a download. It is closed by e2e/cookie-csv-export.spec.ts, which
 *     sets window.IncognitoBrowserApp (the bridge lib/in-app.ts trusts),
 *     scans, clicks Export CSV, awaits the browser's download event and
 *     reads the file back, with controls that make the same visit without
 *     the bridge and must get the overlay and no file.
 *
 *  2. THE HEADER ASSERTION WAS A TAUTOLOGY. pro-csv-export.test.ts:156 is
 *     `expect(header).toEqual([...COOKIE_CSV_COLUMNS])` — the output compared
 *     against the same constant that produced it. Renaming 'Third-Party',
 *     reordering Risk and Category or adding an eleventh column left every
 *     test in the repo green. The ten names are pinned here as literals.
 *
 *  3. THE "HOSTILE HOST" TEST EXERCISED THE FALLBACK, NOT THE SANITISER.
 *     pro-csv-export.test.ts:211-219 feeds 'https://..%2f..%2fetc/' and
 *     'https://a b.example/' and its comment says "the sanitiser is what
 *     guarantees that — so it is graded directly". Both strings make new URL()
 *     THROW, so cookieCsvFilename never reaches the sanitiser for either of
 *     them: it returns the `|| 'scan'` fallback at both. The sanitiser is
 *     graded below through hosts that actually survive parsing.
 *
 * Written 2026-09-22. Nothing here imports a module whose import regenerates
 * what it compares against, and every assertion was confirmed to fail against
 * a deliberate mutation of the guard it names.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  COOKIE_CSV_COLUMNS,
  buildCookieCsv,
  cookieCsvFilename,
  type URLScanResult,
} from '../components/tools/CookieAnalyzerTool';

const SRC_REL = 'components/tools/CookieAnalyzerTool.tsx';
const SRC = readFileSync(join(__dirname, '..', SRC_REL), 'utf-8');

/** A cookie value that must never appear in the file, under any code path. */
const SENTINEL = 'SESSIONTOKENSENTINEL-9f3a2c';

type CsvResult = Pick<URLScanResult, 'url' | 'cookies' | 'trackers' | 'thirdPartyDomains'>;

function cookie(over: Partial<URLScanResult['cookies'][number]> = {}): URLScanResult['cookies'][number] {
  return {
    cookieName: 'sessionid',
    name: 'sessionid',
    category: 'functional',
    risk: 'low',
    description: 'Session cookie',
    raw: `sessionid=${SENTINEL}; Path=/; Secure`,
    secure: true,
    httpOnly: true,
    sameSite: 'Lax',
    domain: 'example.com',
    path: '/',
    maxAge: null,
    expires: null,
    ...over,
  };
}

function result(over: Partial<CsvResult> = {}): CsvResult {
  return {
    url: 'https://example.com/',
    cookies: [cookie()],
    trackers: [{ name: 'Google Analytics', category: 'analytics', risk: 'medium', description: 'Measures visits' }],
    thirdPartyDomains: ['cdn.example.net'],
    ...over,
  };
}

/**
 * RFC 4180 split. Deliberately NOT imported from the component: if the parser
 * that grades the file came from the code that writes it, a matched pair of
 * bugs would cancel out and this whole file would prove nothing.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

/** The brace-matched body starting at the first `{` at or after `from`. */
function bodyFrom(src: string, from: number): string {
  const open = src.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/**
 * Remove comments, leaving string and template literals intact.
 *
 * This repo has twice shipped a guard that was satisfied by the comment
 * explaining the guard. Every assertion below that looks at source text looks
 * at the stripped text, so a reassuring sentence in a comment cannot stand in
 * for the code it describes.
 */
function stripComments(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const d = s[i + 1];
    if (c === '/' && d === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      out += s[i++];
      while (i < s.length) {
        if (s[i] === '\\') { out += s[i] + (s[i + 1] ?? ''); i += 2; continue; }
        if (s[i] === q) { out += s[i++]; break; }
        out += s[i++];
      }
      continue;
    }
    out += s[i++];
  }
  return out;
}

// ---------------------------------------------------------------------------
// The shipped downloadCsv, lifted out of the component and made callable.
// ---------------------------------------------------------------------------

const DL_AT = SRC.indexOf('const downloadCsv');
const DL_HEAD = DL_AT < 0 ? '' : SRC.slice(DL_AT, SRC.indexOf('{', DL_AT));
const DL_BODY = DL_AT < 0 ? '' : bodyFrom(SRC, DL_AT);
/** The parameter name the shipped source uses, so the lifted body still binds. */
const DL_PARAM = /^const downloadCsv = \(\s*([A-Za-z_$][\w$]*)\s*(?::[^)]*)?\)\s*=>\s*$/.exec(DL_HEAD)?.[1];

interface FakeAnchor { href: string; download: string; clicks: number; }
interface Download {
  anchor: FakeAnchor;
  blob: Blob;
  objectUrl: string;
  revoked: string[];
  appended: unknown[];
  removed: unknown[];
  pendingTimers: Array<{ fn: () => void; ms: number }>;
}

/**
 * Run the real downloadCsv body against a stub DOM and return what it did.
 *
 * The body is the file's own text — not a copy kept in step by hand — so a
 * change to the shipped function changes what these tests execute. Only the
 * signature is rewritten, and the parameter name is taken from the source so
 * the body keeps binding to it.
 *
 * NOTE, and this is the point of the exercise for the DevTools item: nothing
 * in this harness grants Pro. There is no data-ib-pro attribute, no bridge
 * object and no user agent. The function runs and produces a file anyway.
 */
function runDownloadCsv(r: CsvResult): Download {
  const revoked: string[] = [];
  const appended: unknown[] = [];
  const removed: unknown[] = [];
  const pendingTimers: Array<{ fn: () => void; ms: number }> = [];
  let blob: Blob | null = null;
  let objectUrl = '';
  let seq = 0;

  const anchor: FakeAnchor = { href: '', download: '', clicks: 0 };
  const deps = {
    buildCookieCsv,
    cookieCsvFilename,
    Blob,
    URL: {
      createObjectURL(b: Blob) { blob = b; objectUrl = `blob:stub/${++seq}`; return objectUrl; },
      revokeObjectURL(u: string) { revoked.push(u); },
    },
    document: {
      createElement(tag: string) {
        if (tag !== 'a') throw new Error(`downloadCsv created a <${tag}>, not an anchor`);
        return Object.assign(anchor, { click() { anchor.clicks++; } });
      },
      body: {
        appendChild(n: unknown) { appended.push(n); return n; },
        removeChild(n: unknown) { removed.push(n); return n; },
      },
    },
    setTimeout(fn: () => void, ms: number) { pendingTimers.push({ fn, ms }); return 0; },
  };

  const factory = new Function('deps', `
    "use strict";
    const { buildCookieCsv, cookieCsvFilename, Blob, URL, document, setTimeout } = deps;
    return function downloadCsv(${DL_PARAM}) ${DL_BODY};
  `) as (d: typeof deps) => (arg: CsvResult) => void;

  factory(deps)(r);
  if (!blob) throw new Error('downloadCsv never created an object URL for a blob');
  return { anchor, blob, objectUrl, revoked, appended, removed, pendingTimers };
}

describe('pro_csv_download_artifact: the file the browser is actually handed', () => {
  it('the harness is lifting the real function, not a stale copy of it', () => {
    // If this fails, every assertion below is grading something that is no
    // longer shipped — which is exactly the failure mode that makes a test
    // pass for the wrong reason. Fail loudly here instead.
    expect(DL_AT, `downloadCsv is gone from ${SRC_REL}`).toBeGreaterThan(-1);
    expect(DL_PARAM, `downloadCsv's signature changed shape: ${JSON.stringify(DL_HEAD)}`).toBeTruthy();
    expect(DL_BODY.startsWith('{') && DL_BODY.endsWith('}'), DL_BODY.slice(0, 80)).toBe(true);
    // The body must still be the one that goes through both helpers, or the
    // execution below proves nothing about them.
    const body = stripComments(DL_BODY);
    expect(body).toContain('buildCookieCsv(');
    expect(body).toContain('cookieCsvFilename(');
  });

  it('the saved name is DERIVED from result.url, not a constant that sits beside the call', () => {
    // The gap the grep left open: `const n = cookieCsvFilename(result.url);
    // a.download = 'scan.csv';` passes the security check and every existing
    // test. It cannot pass this one, because the name has to track the URL.
    const cases: Array<[string, string]> = [
      ['https://EXAMPLE.COM/path?q=1', 'example.com-cookie-scan.csv'],
      ['https://sub.domain.co.uk/a/b', 'sub.domain.co.uk-cookie-scan.csv'],
      ['https://[2001:db8::1]:8443/x', '2001-db8-1-cookie-scan.csv'],
    ];
    const seen = new Set<string>();
    for (const [url, expected] of cases) {
      const dl = runDownloadCsv(result({ url }));
      // Literal, so a change to the naming scheme is a decision someone makes
      // on purpose rather than a constant quietly following the code.
      expect(dl.anchor.download, url).toBe(expected);
      // And it is the shipped sanitiser's output, not a lookalike.
      expect(dl.anchor.download, url).toBe(cookieCsvFilename(url));
      seen.add(dl.anchor.download);
    }
    // Three different sites, three different names. One constant fails here.
    expect(seen.size).toBe(cases.length);
  });

  it('the bytes in the blob are buildCookieCsv output, and the assembled file is clean', async () => {
    // Everything the repo knows about formula injection and cookie values is
    // proven against buildCookieCsv's return value. This asserts the same
    // properties of the thing that reaches the disk: a scanned site that picks
    // hostile names cannot get a formula or a session token into the file an
    // auditor opens.
    const r = result({
      url: 'https://evil.example/',
      cookies: [
        cookie({ cookieName: "=cmd|'/c calc'!A0", description: '@SUM(1)' }),
        cookie({ cookieName: '_fbp', category: 'tracking', risk: 'high', raw: `_fbp=${SENTINEL}`, description: 'Facebook pixel' }),
      ],
      trackers: [{ name: '-2+5', category: 'tracking', risk: 'high', description: '+2+5' }],
      thirdPartyDomains: ['=HYPERLINK("http://evil.example","click")'],
    });
    const dl = runDownloadCsv(r);
    const text = await dl.blob.text();

    // Byte for byte the shared serialiser, so no second code path exists.
    expect(text).toBe(buildCookieCsv(r));
    expect(dl.blob.type).toBe('text/csv');

    const rows = parseCsv(text);
    expect(rows[0]).toEqual([...COOKIE_CSV_COLUMNS]);
    for (const row of rows.slice(1)) {
      expect(row, JSON.stringify(row)).toHaveLength(COOKIE_CSV_COLUMNS.length);
      for (const cell of row) {
        expect(/^[=+\-@\t\r]/.test(cell), `evaluated on open: ${JSON.stringify(cell)}`).toBe(false);
      }
    }
    // No value column by name, and no value by content.
    for (const col of rows[0]) expect(col.toLowerCase()).not.toMatch(/value|raw|token|content/);
    expect(text).not.toContain(SENTINEL);
    // The payload is still readable — this is neutralisation, not redaction.
    expect(text).toContain("cmd|'/c calc'!A0");
    // One logical row per physical line: half the tools that read these files
    // split on \n, and a bare CR would confuse the other half.
    expect(text.split('\n')).toHaveLength(rows.length);
    expect(text).not.toContain('\r');
  });

  it('the anchor is wired to that blob and cleaned up afterwards', () => {
    const dl = runDownloadCsv(result());
    expect(dl.anchor.href).toBe(dl.objectUrl);
    expect(dl.anchor.clicks).toBe(1);
    expect(dl.appended).toHaveLength(1);
    expect(dl.removed).toHaveLength(1);
    expect(dl.appended[0]).toBe(dl.removed[0]);
    // Revoked, but only after a delay: revoking synchronously gives Safari
    // "Failed – No file". Asserted so the fix is not tidied away.
    expect(dl.revoked).toEqual([]);
    expect(dl.pendingTimers).toHaveLength(1);
    expect(dl.pendingTimers[0].ms).toBeGreaterThan(0);
    dl.pendingTimers[0].fn();
    expect(dl.revoked).toEqual([dl.objectUrl]);
  });

  it('the export itself checks nothing: the gate is one call site deep, and that is the whole of it', () => {
    // The honest statement of the DevTools bypass, as a test rather than a
    // sentence. Everything above ran downloadCsv to completion with no Pro
    // mark of any kind present — so anyone who can reach the function has the
    // file. It is acceptable only because the function is pure client-side
    // reformatting of a scan result the visitor already holds: no request, no
    // server-held data, no cost to the box. If any of that changes, the
    // decision has to move to the server.
    const body = stripComments(DL_BODY);
    expect(body).not.toMatch(/\bfetch\s*\(|sendBeacon\s*\(|SCAN_API_BASE|['"`]\/api\//);
    expect(body).not.toMatch(/inAppPro|ib-pro|data-inapp|guard/);
    // And the one place the gate does live must keep living there.
    const src = stripComments(SRC);
    expect(src).toMatch(/onClick=\{guardExport\(\(\) => downloadCsv\(urlResult\)\)\}/);
  });
});

describe('pro_csv_columns: the ten names, pinned as literals', () => {
  it('the header is exactly these ten, in this order', () => {
    // The existing assertion compares the header to COOKIE_CSV_COLUMNS — the
    // constant that produced it — so it holds for any ten names in any order.
    // These are written out so that renaming 'Third-Party' to 'ThirdParty',
    // swapping Risk and Category, or appending 'Path' is a visible decision.
    // Consumers parse this file by column; silent reshuffles break them.
    expect([...COOKIE_CSV_COLUMNS]).toEqual([
      'Type', 'Name', 'Category', 'Risk', 'Third-Party', 'Secure', 'HttpOnly', 'SameSite', 'Domain', 'Description',
    ]);
    expect(parseCsv(buildCookieCsv(result()))[0]).toEqual([
      'Type', 'Name', 'Category', 'Risk', 'Third-Party', 'Secure', 'HttpOnly', 'SameSite', 'Domain', 'Description',
    ]);
  });

  it('each column carries what its name says, looked up BY NAME', () => {
    // Column counts already pass if the builder writes ten values in the wrong
    // order. This reads each field by its header position, so a reorder of the
    // header without a matching reorder of the row builder fails here.
    const col = (row: string[], name: string) => row[COOKIE_CSV_COLUMNS.indexOf(name as never)];
    const rows = parseCsv(buildCookieCsv(result({
      url: 'https://example.com/',
      cookies: [cookie({
        cookieName: 'analytics_id', category: 'analytics', risk: 'medium',
        secure: false, httpOnly: true, sameSite: 'None',
        domain: 'tracker.example.net', description: 'Cross-site id',
      })],
      trackers: [],
      thirdPartyDomains: [],
    })));
    const row = rows[1];
    expect(col(row, 'Type')).toBe('cookie');
    expect(col(row, 'Name')).toBe('analytics_id');
    expect(col(row, 'Category')).toBe('analytics');
    expect(col(row, 'Risk')).toBe('medium');
    // Domain is tracker.example.net against a site on example.com.
    expect(col(row, 'Third-Party')).toBe('yes');
    expect(col(row, 'Secure')).toBe('no');
    expect(col(row, 'HttpOnly')).toBe('yes');
    expect(col(row, 'SameSite')).toBe('None');
    expect(col(row, 'Domain')).toBe('tracker.example.net');
    expect(col(row, 'Description')).toBe('Cross-site id');
  });
});

describe('pro_csv_filename_sanitiser: graded through hosts that survive parsing', () => {
  const SAFE = /^[a-z0-9.-]+-cookie-scan\.csv$/;

  it('the inputs the old hostile-host test used never reach the sanitiser', () => {
    // Evidence for why the cases below exist. Both of these make new URL()
    // throw, so cookieCsvFilename takes its catch branch and returns the
    // `|| 'scan'` fallback — the sanitiser is not on that path at all, despite
    // the comment at pro-csv-export.test.ts:212-213 saying it is graded there.
    for (const url of ['https://..%2f..%2fetc/', 'https://a b.example/']) {
      expect(() => new URL(url), url).toThrow();
      expect(cookieCsvFilename(url), url).toBe('scan-cookie-scan.csv');
    }
  });

  it('a host that DOES parse but is not filename-safe is folded to [a-z0-9.-]', () => {
    // Each of these survives new URL() and arrives at the sanitiser carrying
    // something a filename should not: an underscore, a dollar sign, leading
    // and trailing dots, an unencoded IPv6 bracket pair, mixed case.
    const cases: Array<[string, string]> = [
      ['https://a_b.example/', 'a-b.example-cookie-scan.csv'],
      ['https://$foo.example/', 'foo.example-cookie-scan.csv'],
      ['https://...example.com.../', 'example.com-cookie-scan.csv'],
      ['https://EXAMPLE.COM./', 'example.com-cookie-scan.csv'],
      ['https://[::ffff:127.0.0.1]/', 'ffff-7f00-1-cookie-scan.csv'],
      ['https://über.example/', 'xn-ber-goa.example-cookie-scan.csv'],
    ];
    for (const [url, expected] of cases) {
      const host = new URL(url).hostname;
      // Proof the sanitiser is doing the work: the raw host is not already the stem.
      expect(`${host}-cookie-scan.csv`, `${url} needs no sanitising, so it grades nothing`).not.toBe(expected);
      expect(cookieCsvFilename(url), url).toBe(expected);
      expect(cookieCsvFilename(url), url).toMatch(SAFE);
      expect(cookieCsvFilename(url), url).not.toMatch(/[/\\:[\]<>"|?*\s]/);
    }
  });

  it('CRLF in the URL cannot reach the filename — and the reason is not the sanitiser', () => {
    // The claim under audit said a host "carrying CRLF" yields a safe name.
    // True, but by a mechanism nobody had written down: the WHATWG URL parser
    // strips ASCII tab, CR and LF from the input BEFORE parsing, so a raw
    // CRLF is gone by the time hostname is read. The percent-encoded form is
    // rejected outright. Both are pinned so a future change of parser — or a
    // move to reading the host from the raw string — shows up here.
    expect(new URL('https://evil.com\r\nX/').hostname).toBe('evil.comx');
    expect(cookieCsvFilename('https://evil.com\r\nX/')).toBe('evil.comx-cookie-scan.csv');
    expect(() => new URL('https://evil.com%0d%0aX/')).toThrow();
    for (const url of [
      'https://evil.com\r\nX/',
      'https://evil.com%0d%0aX/',
      'https://evil.com\r\nContent-Length: 0/',
      'https://\tevil.com/',
      'https://evil.com\n/',
    ]) {
      const name = cookieCsvFilename(url);
      expect(name, url).toMatch(SAFE);
      expect(name, url).not.toMatch(/[\r\n\t]/);
    }
  });

  it('a very long host is truncated and never left ending in a separator', () => {
    // The `.slice(0, 80)` can cut in the middle of a label and leave a dot or
    // a dash as the last character; the trailing strip after the slice is what
    // removes it. Nothing exercised that branch, and the SAFE pattern does not
    // catch it either — '<79 chars>.-cookie-scan.csv' matches [a-z0-9.-]+ just
    // fine. A stem ending in a separator gives a doubled '--' or a '.-' before
    // the suffix, and Win32 silently drops trailing dots from filenames.
    const host = `${'a'.repeat(79)}.bb.example`;
    const name = cookieCsvFilename(`https://${host}/`);
    expect(name).toBe(`${'a'.repeat(79)}-cookie-scan.csv`);
    for (const h of [
      `${'a'.repeat(79)}.bb.example`,
      `${'a'.repeat(80)}.example.com`,
      `${'b'.repeat(78)}.example.com`,
      `${'c'.repeat(40)}.${'d'.repeat(39)}.example`,
      `${'e_'.repeat(45)}.example`,
    ]) {
      const n = cookieCsvFilename(`https://${h}/`);
      expect(n, h).toMatch(SAFE);
      expect(n.length, h).toBeLessThanOrEqual(80 + '-cookie-scan.csv'.length);
      // The stem must not end in '.' or '-', which is what a bare slice leaves.
      expect(n, h).not.toMatch(/[.-]-cookie-scan\.csv$/);
    }
  });
});

describe('pro_csv_row_integrity: no value can break out of its row or its column', () => {
  /** Every physical line is one logical row, and every row has ten cells. */
  function expectRectangular(csv: string, expectedRows: number) {
    const rows = parseCsv(csv);
    expect(csv.split('\n'), 'a cell spilled onto a second physical line').toHaveLength(expectedRows);
    expect(rows).toHaveLength(expectedRows);
    for (const row of rows) expect(row, JSON.stringify(row)).toHaveLength(COOKIE_CSV_COLUMNS.length);
    return rows;
  }

  it('a third-party domain carrying a comma, a quote or a newline stays in one row', () => {
    // The existing row-shape assertion uses the benign 'cdn.example.net' from
    // the default fixture, and the formula test only looks at leading
    // characters — so a third-party entry that injects a delimiter mid-string
    // would shift or split its row with every test still green. The scanned
    // site supplies these strings.
    const domains = ['a,b"c', 'x\r\ny', 'd\ne', '"',  'q,,,,r'];
    const rows = expectRectangular(buildCookieCsv(result({
      cookies: [], trackers: [], thirdPartyDomains: domains,
    })), 1 + domains.length);
    const name = (row: string[]) => row[COOKIE_CSV_COLUMNS.indexOf('Name' as never)];
    const domain = (row: string[]) => row[COOKIE_CSV_COLUMNS.indexOf('Domain' as never)];
    // Commas and quotes survive verbatim; only CR and LF are flattened.
    expect(rows.slice(1).map(name)).toEqual(['a,b"c', 'x y', 'd e', '"', 'q,,,,r']);
    // The same value lands in both columns that carry it, uncorrupted.
    for (const row of rows.slice(1)) expect(domain(row)).toBe(name(row));
  });

  it('a tracker name or description carrying a delimiter stays in one row', () => {
    // Same gap, other loop: the CR/LF row test sets trackers to [] and
    // exercises a cookie row only.
    const rows = expectRectangular(buildCookieCsv(result({
      cookies: [],
      trackers: [
        { name: 'Ads, Inc "AI"', category: 'tracking', risk: 'high', description: 'line one\r\nline two' },
        { name: 'x\ny', category: 'analytics', risk: 'low', description: 'a,b,c' },
      ],
      thirdPartyDomains: [],
    })), 3);
    const at = (row: string[], c: string) => row[COOKIE_CSV_COLUMNS.indexOf(c as never)];
    expect(at(rows[1], 'Name')).toBe('Ads, Inc "AI"');
    expect(at(rows[1], 'Description')).toBe('line one line two');
    expect(at(rows[1], 'Category')).toBe('tracking');
    expect(at(rows[2], 'Name')).toBe('x y');
    expect(at(rows[2], 'Description')).toBe('a,b,c');
  });

  it('all three row kinds together stay rectangular under hostile input', () => {
    // The shape a real scan of a hostile site produces: every loop populated,
    // every string chosen by the scanned site.
    const rows = expectRectangular(buildCookieCsv(result({
      cookies: [
        cookie({ cookieName: 'a,b', description: 'c"d\ne' }),
        cookie({ cookieName: '"', domain: 'x,y', description: '' }),
      ],
      trackers: [{ name: 'p\r\nq', category: 'tracking', risk: 'high', description: 'r,s' }],
      thirdPartyDomains: ['t"u', 'v,w'],
    })), 6);
    expect(rows.slice(1).map((r) => r[0])).toEqual([
      'cookie', 'cookie', 'tracker', 'third-party-script', 'third-party-script',
    ]);
    // Nothing smuggled a session token in through the confusion.
    expect(buildCookieCsv(result())).not.toContain(SENTINEL);
  });
});
