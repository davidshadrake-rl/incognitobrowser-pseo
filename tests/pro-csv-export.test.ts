/**
 * The CSV export is the only paid action on the scanner, and the one place
 * where data from a site the visitor does not trust leaves this browser as a
 * file someone else opens.
 *
 * Two separate dangers, one file:
 *
 *  1. FORMULA INJECTION. A cell beginning `=`, `+`, `-`, `@`, a tab or a CR is
 *     evaluated by Excel, Sheets and LibreOffice when the file is opened. The
 *     scanned site picks its own cookie and tracker names, so it picks the
 *     contents of those cells — and the person most likely to open this export
 *     is an auditor running a GDPR check against a site they already suspect.
 *     That is a remote code path from an untrusted site into an auditor's
 *     machine, via a download the product sells as a Pro feature.
 *  2. COOKIE VALUES. The value of a cookie on the scanned site can be a live
 *     session token. It has no place in a privacy inventory and must never
 *     reach the file. The export writes cookieName; these tests pin that with
 *     a sentinel so a refactor that starts writing `raw` or `value` fails here
 *     rather than in someone's inbox.
 *
 * Written 2026-09-21 alongside the fix in components/tools/CookieAnalyzerTool.tsx
 * (csvCell / buildCookieCsv / cookieCsvFilename).
 */
import { describe, expect, it } from 'vitest';
import {
  COOKIE_CSV_COLUMNS,
  buildCookieCsv,
  cookieCsvFilename,
  csvCell,
  type URLScanResult,
} from '../components/tools/CookieAnalyzerTool';

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

/** Split a CSV into logical rows the way RFC 4180 does: quotes protect commas. */
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

describe('pro_csv_formula_injection', () => {
  // The classic DDE payload, the arithmetic starters, and the two control
  // characters spreadsheets strip before deciding a cell is a formula.
  const PAYLOADS = [
    "=cmd|'/c calc'!A0",
    '+2+5',
    '-2+5',
    '@SUM(1)',
    '\t=1+1',
    '\r=1+1',
  ];

  it('every dangerous leading character is neutralised, in the cell and in a built row', () => {
    for (const payload of PAYLOADS) {
      const cell = csvCell(payload);
      // Quoted, and the first character inside the quotes is the apostrophe
      // that makes a spreadsheet read the cell as text.
      expect(cell.startsWith('"\''), `csvCell(${JSON.stringify(payload)}) = ${cell}`).toBe(true);
      // Nothing starts a formula any more.
      expect(/^"[=+\-@\t\r\n]/.test(cell), cell).toBe(false);
    }
  });

  it('a scanned site cannot smuggle a formula through a cookie name, a tracker name or a third-party domain', () => {
    const csv = buildCookieCsv(result({
      cookies: [cookie({ cookieName: "=cmd|'/c calc'!A0", description: '@SUM(1)' })],
      trackers: [{ name: '-2+5', category: 'tracking', risk: 'high', description: '+2+5' }],
      thirdPartyDomains: ['=HYPERLINK("http://evil.example","click")'],
    }));
    const rows = parseCsv(csv);
    for (const row of rows.slice(1)) {
      for (const cell of row) {
        expect(/^[=+\-@\t\r]/.test(cell), `cell would be evaluated on open: ${JSON.stringify(cell)}`).toBe(false);
      }
    }
    // And the payload is still legible to a human reading the audit.
    expect(csv).toContain("cmd|'/c calc'!A0");
  });

  it('regression: ordinary text is untouched and quotes are still doubled', () => {
    expect(csvCell('foo"bar')).toBe('"foo""bar"');
    expect(csvCell('_ga')).toBe('"_ga"');
    expect(csvCell('yes')).toBe('"yes"');
    expect(csvCell('')).toBe('""');
    // A date-looking value does not START with a dash, so it is not quoted-prefixed.
    expect(csvCell('2026-09-21')).toBe('"2026-09-21"');
  });

  it('a cell holding CR, LF or a comma still produces exactly one row', () => {
    const csv = buildCookieCsv(result({
      cookies: [cookie({ cookieName: 'a\r\nb', description: 'one, two\nthree' })],
      trackers: [],
      thirdPartyDomains: [],
    }));
    // header + one cookie row, counted physically AND logically.
    expect(csv.split('\n')).toHaveLength(2);
    const rows = parseCsv(csv);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveLength(COOKIE_CSV_COLUMNS.length);
    expect(rows[1]).toHaveLength(COOKIE_CSV_COLUMNS.length);
    expect(rows[1][1]).toBe('a b');
    expect(rows[1][9]).toBe('one, two three');
  });
});

describe('pro_csv_no_cookie_values', () => {
  it('the header declares no value column', () => {
    const header = parseCsv(buildCookieCsv(result()))[0];
    expect(header).toEqual([...COOKIE_CSV_COLUMNS]);
    for (const col of header) expect(col.toLowerCase()).not.toMatch(/value|raw|token|content/);
  });

  it('a cookie value never reaches the file, even when it appears in raw', () => {
    const csv = buildCookieCsv(result({
      cookies: [
        cookie(),
        cookie({ cookieName: '_fbp', category: 'tracking', risk: 'high', raw: `_fbp=${SENTINEL}`, description: 'Facebook pixel' }),
      ],
    }));
    expect(csv).not.toContain(SENTINEL);
    // The name is there — this is an inventory, not a dump.
    expect(csv).toContain('"sessionid"');
    expect(csv).toContain('"_fbp"');
  });

  it('every row has exactly the declared columns, so nothing rides along in an extra field', () => {
    const rows = parseCsv(buildCookieCsv(result()));
    expect(rows).toHaveLength(4); // header + cookie + tracker + third-party script
    for (const row of rows) expect(row).toHaveLength(COOKIE_CSV_COLUMNS.length);
  });
});

describe('pro_csv_safe_filename', () => {
  const SAFE = /^[a-z0-9.\-]+-cookie-scan\.csv$/;

  it('every host a URL can actually produce yields a safe name', () => {
    const urls = [
      'https://example.com/',
      'https://EXAMPLE.COM/path?q=1',
      'https://bücher.example/',            // punycoded by the URL parser
      'https://пример.рф/',
      'https://[2001:db8::1]:8443/x',       // hostname arrives bracketed
      'http://127.0.0.1:3000/',
      'https://user:pw@例え.テスト/',
      'https://sub.domain.co.uk/a/b',
    ];
    for (const url of urls) {
      const name = cookieCsvFilename(url);
      expect(name, url).toMatch(SAFE);
      expect(name, url).not.toMatch(/[/\\:[\]<>"|?*\s]/);
    }
    expect(cookieCsvFilename('https://[2001:db8::1]:8443/x')).toBe('2001-db8-1-cookie-scan.csv');
    expect(cookieCsvFilename('https://EXAMPLE.COM/path?q=1')).toBe('example.com-cookie-scan.csv');
  });

  it('a URL the parser rejects, or one with no host, still gets a name — never an empty or relative one', () => {
    for (const url of ['not a url', '', 'javascript:alert(1)', 'data:text/html,<b>x', 'about:blank']) {
      const name = cookieCsvFilename(url);
      expect(name, url).toMatch(SAFE);
      expect(name, url).toBe('scan-cookie-scan.csv');
    }
  });

  it('a hostile host cannot walk out of the downloads folder or hide the extension', () => {
    // These do not survive URL parsing as hostnames, but the sanitiser is what
    // guarantees that — so it is graded directly.
    for (const url of ['https://..%2f..%2fetc/', 'https://a b.example/']) {
      const name = cookieCsvFilename(url);
      expect(name, url).toMatch(SAFE);
      expect(name, url).not.toContain('..');
    }
  });
});
