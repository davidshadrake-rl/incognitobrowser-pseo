/**
 * The three tools whose input must never leave the browser.
 *
 * The cookie scanner's Paste box asks for "a cookie string (from DevTools >
 * Application > Cookies)" — live session cookies, usually for a site that is
 * not ours. Its This Page button reads document.cookie. The metadata viewer
 * reads photographs. On a company deploy, whether any of that reaches a socket
 * is the whole difference between a privacy tool and a collection point, so it
 * is asserted here three ways:
 *
 *   1. AT RUNTIME. Every transport a browser has (fetch, XHR, sendBeacon,
 *      WebSocket, EventSource, Request, Image) is replaced with a recorder,
 *      the real parsing and reporting functions are run over a sentinel value,
 *      and the recorder must be empty. The traps themselves are asserted to
 *      have installed, because a trap that quietly failed to install is a
 *      green test that proves nothing.
 *   2. IN THE SOURCE, through scripts/security/checks/pro-client-only.mjs,
 *      which is run here against the real tree.
 *   3. BY MUTATION. Each check is also run against a COPY of the tree with the
 *      property deliberately broken, and must report it. A guard nobody has
 *      ever seen fail is a guard nobody knows works — that is how
 *      tests/ssrf-protection.test.ts stayed green through two live bypasses.
 *
 * Not repeated here, because it is already asserted elsewhere:
 *   - /event cannot carry free text — lib/event-schema.ts is an allowlist and
 *     tests/event-schema.test.ts grades it. This file asserts only that no
 *     cookie or image value becomes an argument to track() in the first place.
 *   - Neither component uses dangerouslySetInnerHTML —
 *     tests/xss-protection.test.ts covers both by name.
 *   - The metadata viewer has *a* file-size check —
 *     tests/input-validation.test.ts:77. What is new here is its VALUE, read
 *     out of the source and checked against the number the message promises.
 *   - No gated handler reaches the server — scripts/security/checks/pentest-gate-inventory.mjs.
 *     That grades the three gated actions; this grades the free paths beside
 *     them, which is where the pasted cookies and the photographs are.
 *
 * TWO TESTS HERE ARE `it.fails`. They hold the assertion the owner asked for,
 * unweakened, over behaviour today's parser does not have. When either is
 * fixed, `it.fails` starts failing — that is deliberate: flip it to `it` and
 * delete the note.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  categorizeCookie,
  cookieListReport,
  parseCookieList,
} from '../components/tools/CookieAnalyzerTool';

const ROOT = path.join(__dirname, '..');
const COOKIE_TOOL = 'components/tools/CookieAnalyzerTool.tsx';
const META_TOOL = 'components/tools/MetadataViewerTool.tsx';
const EXIF_LIB = 'lib/exif.ts';
const CHECKS = 'scripts/security/checks/pro-client-only.mjs';

const readSrc = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

// Every path this file grades must resolve, or the assertions below are
// covering a file that has moved and nobody has noticed.
for (const rel of [COOKIE_TOOL, META_TOOL, EXIF_LIB, CHECKS]) {
  if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`${rel} is missing — this test would grade nothing`);
}

type Finding = { severity: string; title: string; evidence: string };
type Check = { id: string; run: (ctx: unknown) => Promise<{ findings: Finding[]; checked: number }> };

const checks: Check[] = (await import(path.join(ROOT, CHECKS) as string)).default;
const byId = (id: string): Check => {
  const c = checks.find((x) => x.id === id);
  if (!c) throw new Error(`check ${id} is not exported — the owner's CI list names it`);
  return c;
};

/** Run one check against a tree (the real one by default). */
const runCheck = (id: string, repoRoot = ROOT) => byId(id).run({ repoRoot, Skip: Error });

/**
 * A copy of the files these checks read, with one mutation applied, so a check
 * can be proved to FAIL when the property it guards is broken.
 */
function mutantTree(edits: Array<[string, string, string]>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-pro-client-only-'));
  for (const rel of [COOKIE_TOOL, META_TOOL, EXIF_LIB]) {
    const dest = path.join(dir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, readSrc(rel));
  }
  for (const [rel, from, to] of edits) {
    const dest = path.join(dir, rel);
    const before = fs.readFileSync(dest, 'utf-8');
    const after = before.replace(from, to);
    if (after === before) throw new Error(`mutation target not found in ${rel}: ${from.slice(0, 60)} — the mutation test is no longer mutating anything`);
    fs.writeFileSync(dest, after);
  }
  return dir;
}

// ─────────────────────────── the network trap ────────────────────────────

type Sent = { via: string; payload: string };

const show = (v: unknown) => {
  if (typeof v === 'string') return v;
  try { return JSON.stringify(v) ?? String(v); } catch { return String(v); }
};

/**
 * Replace every transport with a recorder for the duration of `run`.
 *
 * Returns which traps actually installed as well as what they caught: a trap
 * that could not be defined must fail the test rather than leave a hole in it.
 */
function withNetworkTrap<T>(run: () => T): { value: T; sent: Sent[]; installed: string[] } {
  const g = globalThis as unknown as Record<string, unknown>;
  const sent: Sent[] = [];
  const installed: string[] = [];
  const saved: Array<[string, boolean, unknown]> = [];
  const recorder = (via: string) => function (...args: unknown[]) { sent.push({ via, payload: args.map(show).join(' ') }); return undefined; };

  const install = (name: string, value: unknown) => {
    const descriptor = Object.getOwnPropertyDescriptor(g, name);
    if (descriptor && descriptor.configurable === false) return;
    saved.push([name, name in g, g[name]]);
    Object.defineProperty(g, name, { value, configurable: true, writable: true });
    installed.push(name);
  };

  for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'Request', 'Image']) {
    install(name, recorder(name));
  }
  install('navigator', { ...(g.navigator as object ?? {}), sendBeacon: recorder('navigator.sendBeacon'), userAgent: 'vitest' });

  try {
    const value = run();
    return { value, sent, installed };
  } finally {
    for (const [name, had, value] of saved) {
      if (had) Object.defineProperty(g, name, { value, configurable: true, writable: true });
      else delete g[name];
    }
  }
}

// ──────────────────── pro_paste_not_posted_to_api ────────────────────────

describe('pro_paste_not_posted_to_api', () => {
  // A real-looking Cookie: header for somebody else's site, with a value no
  // other string in this repo contains.
  const SENTINEL_NAME = 'ib_sentinel_sid';
  const SENTINEL_VALUE = 'PASTED-SESSION-3f9a2c7e-DO-NOT-SEND';
  const PASTE = `${SENTINEL_NAME}=${SENTINEL_VALUE}; _ga=GA1.2.987; _fbp=fb.1.123`;

  it('parsing and reporting a pasted cookie string opens no connection of any kind', () => {
    const { value, sent, installed } = withNetworkTrap(() => {
      const cookies = parseCookieList(PASTE);
      return { cookies, report: cookieListReport(cookies, 'paste') };
    });

    // The traps are the instrument: if they did not install, the empty result
    // below would mean nothing at all.
    expect(installed, 'no transport could be trapped — this assertion would be vacuous').toContain('fetch');
    expect(installed).toEqual(expect.arrayContaining(['fetch', 'XMLHttpRequest', 'WebSocket', 'navigator']));

    expect(sent, `the paste path opened ${sent.length} connection(s): ${sent.map((s) => `${s.via}(${s.payload.slice(0, 120)})`).join(', ')}`).toEqual([]);
    // …and it did do the work, so the silence is not silence about nothing.
    expect(value.cookies.map((c) => c.name)).toEqual([SENTINEL_NAME, '_ga', '_fbp']);
    expect(value.report.result.headline).toContain('The pasted cookies score');
  });

  it('the reported result carries counts, never the pasted names or values', () => {
    // Everything the page hands to the result bus (and so, eventually, to
    // track('result_shown', …)) is in this object. A cookie name or value in
    // here is one refactor away from being a counter key.
    const report = cookieListReport(parseCookieList(PASTE), 'paste');
    const serialised = JSON.stringify(report);
    expect(serialised).not.toContain(SENTINEL_VALUE);
    expect(serialised).not.toContain(SENTINEL_NAME);
    expect(serialised).not.toContain('GA1.2.987');
    expect(report.result.stats?.map((s) => s.label)).toEqual(['Tracking', 'Analytics', 'Functional', 'Cookies']);
  });

  it('the check passes over the real tree, having actually inspected the paste path', async () => {
    const r = await runCheck('pro_paste_not_posted_to_api');
    expect(r.findings.map((f) => `${f.severity}: ${f.title} — ${f.evidence}`)).toEqual([]);
    expect(r.checked).toBeGreaterThan(3);
  });

  it('the check FAILS when the pasted string is handed to fetch', async () => {
    const dir = mutantTree([[COOKIE_TOOL, 'setCookies(parseCookieList(customInput));', "fetch('/api/collect', { method: 'POST', body: customInput });"]]);
    const r = await runCheck('pro_paste_not_posted_to_api', dir);
    expect(r.findings.map((f) => f.severity)).toContain('high');
    expect(r.findings.map((f) => f.title).join(' ')).toMatch(/network call|flows into a network call/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ────────────────── pro_this_page_not_posted_to_api ──────────────────────

describe('pro_this_page_not_posted_to_api', () => {
  const src = readSrc(COOKIE_TOOL);

  it('document.cookie is read once, into the pure parser, and nowhere else', () => {
    const reads = [...src.matchAll(/document\.cookie/g)];
    // One in the code; the line above it is a comment, which counts too.
    expect(reads.length, 'more than one document.cookie read — each one needs grading').toBeLessThanOrEqual(2);
    expect(src).toContain('parseCookieList(document.cookie)');
    expect(src).not.toMatch(/cookieStore|chrome\.cookies|browser\.cookies/);
  });

  it("reading this page's cookies opens no connection either", () => {
    const { sent, installed } = withNetworkTrap(() => {
      // document.cookie's own value is the browser's; what is asserted here is
      // that the function it is handed to is pure. Feed it a document.cookie-
      // shaped string — name=value pairs, no attributes, which is all that API
      // ever returns.
      const cookies = parseCookieList('_ga=GA1.2.1; sessionid=abc123; _fbp=fb.1.9');
      return cookieListReport(cookies, 'browser');
    });
    expect(installed).toContain('fetch');
    expect(sent).toEqual([]);
  });

  /**
   * The page says: "HttpOnly cookies are hidden from scripts, so they don't
   * appear here." That is true for one reason — document.cookie omits them
   * (RFC 6265 §8.6) — so the claim is locked to the mechanism rather than to
   * the sentence: the copy must be there AND document.cookie must still be the
   * only source. A tool that silently under-reports is worse than none.
   */
  it('the HttpOnly claim is still backed by the only thing that makes it true', () => {
    const copy = src.replace(/&apos;|&#39;/g, "'");
    expect(copy).toMatch(/HttpOnly[\s\S]{0,140}?(?:hidden|don't appear|never appear|not visible)/i);
    expect(src).toContain('parseCookieList(document.cookie)');
  });

  it('list mode cannot even claim HttpOnly: the type it builds has no such field', () => {
    // A URL scan learns Secure/HttpOnly/SameSite from the Set-Cookie header the
    // server saw. This Page and Paste never see a header, so CookieInfo carries
    // no field for them — there is nothing to fill it with but a guess.
    expect(Object.keys(categorizeCookie('sessionid', 'abc'))).toEqual(['name', 'value', 'category', 'risk', 'description']);
    const iface = /export interface CookieInfo \{([\s\S]*?)\n\}/.exec(src);
    expect(iface, 'CookieInfo is gone — this assertion no longer covers anything').not.toBeNull();
    expect(iface![1]).not.toMatch(/\b(?:httpOnly|secure|sameSite)\s*\??\s*:/);
  });

  it('the check passes over the real tree, and fails when a beacon is added', async () => {
    const clean = await runCheck('pro_this_page_not_posted_to_api');
    expect(clean.findings.map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(clean.checked).toBeGreaterThan(3);

    const dir = mutantTree([[COOKIE_TOOL, 'setCookies(parseCookieList(document.cookie));', "navigator.sendBeacon('/api/collect', document.cookie);"]]);
    const broken = await runCheck('pro_this_page_not_posted_to_api', dir);
    expect(broken.findings.map((f) => f.severity)).toContain('high');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

// ────────── pro_metadata_multi_file_gated_single_still_works ─────────────

describe('pro_metadata_multi_file_gated_single_still_works', () => {
  const src = readSrc(META_TOOL);
  const handleFile = src.slice(src.indexOf('const handleFile'), src.indexOf('const stripMetadata'));

  it('more than one file trips the overlay, and the first file is still read and shown', () => {
    const gate = handleFile.search(/if\s*\(\s*picked\.length\s*>\s*1\s*\)/);
    const parse = handleFile.indexOf('readImageMetadata(');
    expect(gate, 'no multi-file branch — metadata-multi-file is one of the three declared gates').toBeGreaterThan(-1);
    expect(parse, 'handleFile no longer reads the file').toBeGreaterThan(-1);
    // The gate fires first, and does not take the read with it.
    expect(gate).toBeLessThan(parse);
    const branch = handleFile.slice(gate, handleFile.indexOf(';', gate) + 1);
    expect(branch).toMatch(/noteBatchAttempt\s*\(\s*\)/);
    expect(branch, 'the multi-file branch returns — the first photo would stop being free').not.toMatch(/\breturn\b/);
    // The free first file is picked[0], read unconditionally below the gate.
    expect(handleFile).toMatch(/const\s+file\s*=\s*picked\?\.\[0\]/);
    // …and it is the DECLARED gate id, the one /event will accept.
    expect(src).toContain("gate: 'metadata-multi-file'");
  });

  it('the size cap is real, is the number the message promises, and is checked before the file is read', () => {
    // Read the cap out of the source rather than asserting a remembered value:
    // the test must follow the constant, not the other way round.
    const m = /file\.size\s*>\s*([0-9_*+\s()]+)\)/.exec(handleFile);
    expect(m, 'no file.size guard in handleFile').not.toBeNull();
    const bytes = Function(`"use strict";return (${m![1].replace(/_/g, '')});`)() as number;
    expect(Number.isFinite(bytes)).toBe(true);
    expect(bytes).toBeGreaterThan(0);

    const promised = /Maximum size is\s*(\d+)\s*MB/i.exec(handleFile);
    expect(promised, 'the size message no longer states a limit').not.toBeNull();
    expect(bytes, `the code caps at ${bytes} bytes while the message promises ${promised![1]}MB`).toBe(Number(promised![1]) * 1024 * 1024);

    // Before arrayBuffer(), or the cap has already paid the cost it exists to avoid.
    expect(handleFile.indexOf('file.size >')).toBeLessThan(handleFile.indexOf('arrayBuffer'));
  });

  it('no image byte can reach the network: the tool and lib/exif.ts have no transport at all', () => {
    const exif = readSrc(EXIF_LIB);
    for (const [name, text] of [[META_TOOL, src], [EXIF_LIB, exif]] as const) {
      expect(text, `${name} gained a transport`).not.toMatch(/\bfetch\s*\(|\bnew\s+XMLHttpRequest|sendBeacon\s*\(|new\s+WebSocket\s*\(|new\s+EventSource\s*\(/);
      expect(text, `${name} names an API path`).not.toMatch(/['"`]\/(?:api|event|scan-url|challenge)\b/);
    }
    // The single remote URL in the tool is the map link, and it only opens on a
    // click: the photo's coordinates leave the browser when — and only when —
    // the visitor presses a button that says "View GPS on map".
    const urls = [...src.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((u) => u[0]);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('openstreetmap.org');
    expect(src).toMatch(/window\.open\(`https:\/\/www\.openstreetmap\.org[\s\S]{0,200}?'noopener,noreferrer'\)/);
    expect(src).toMatch(/onClick=\{openGpsOnMap\}/);
  });

  it('the check passes over the real tree, and fails when the gate swallows the free first file', async () => {
    const clean = await runCheck('pro_metadata_multi_file_gated_single_still_works');
    // One known finding today, reported and graded low: see the note below.
    expect(clean.findings.filter((f) => f.severity === 'high' || f.severity === 'critical')).toEqual([]);
    expect(clean.checked).toBeGreaterThan(5);

    const dir = mutantTree([[META_TOOL, 'if (picked.length > 1) noteBatchAttempt();', 'if (picked.length > 1) { noteBatchAttempt(); return; }']]);
    const broken = await runCheck('pro_metadata_multi_file_gated_single_still_works', dir);
    expect(broken.findings.map((f) => f.title).join(' ')).toMatch(/blocks the first one/i);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Reported, not fixed here: the size branch alerts and returns without
   * clearing state, so a file refused for its size leaves the PREVIOUS photo's
   * verdict on screen under the new file's name. The catch branch twenty lines
   * below does the clearing, and its comment explains exactly why. Graded low
   * by pro_metadata_multi_file_gated_single_still_works.
   */
  it('reports the size branch leaving a stale verdict on screen, and reports nothing else', async () => {
    const r = await runCheck('pro_metadata_multi_file_gated_single_still_works');
    expect(r.findings.map((f) => `${f.severity}: ${f.title}`)).toEqual([
      "low: A file refused for its size leaves the previous photo's verdict on screen",
    ]);
  });
});

// ─────────────────── pro_paste_parser_robustness ─────────────────────────

describe('pro_paste_parser_robustness', () => {
  it('a pasted script tag is data, not markup, and parses without throwing', () => {
    const XSS = '";<script>alert(1)</script>';
    const cookies = parseCookieList(XSS);
    // The two pieces are treated as cookie NAMES. React escapes them when the
    // list renders (tests/xss-protection.test.ts pins the absence of
    // dangerouslySetInnerHTML in this component); nothing here builds HTML.
    expect(cookies.map((c) => c.name)).toEqual(['"', '<script>alert(1)</script>']);
    expect(cookies.every((c) => typeof c.category === 'string')).toBe(true);
    const report = cookieListReport(cookies, 'paste');
    expect(report.result.headline).not.toContain('<script>');
    expect(report.score).toBeGreaterThanOrEqual(0);
  });

  it('newlines, CRLF and blank pieces are handled, in either paste style', () => {
    expect(parseCookieList('a=1\n\nb=2\r\nc=3').map((c) => c.name)).toEqual(['a', 'b', 'c']);
    expect(parseCookieList('a=1;;  ;\n;b=2\n\n').map((c) => c.name)).toEqual(['a', 'b']);
    // A value containing '=' survives intact.
    expect(parseCookieList('t=a=b=c')[0].value).toBe('a=b=c');
  });

  it('a 1 MB paste parses without throwing, and this is what it costs', () => {
    const big = 'ck=0123456789; '.repeat(Math.ceil((1024 * 1024) / 15));
    expect(big.length).toBeGreaterThan(1024 * 1024);
    const started = Date.now();
    const cookies = parseCookieList(big);
    const ms = Date.now() - started;
    // Capped since 2026-09-22: MAX_PASTED_COOKIES pieces, MAX_PASTE_CHARS bytes.
    expect(cookies.length).toBe(2000);
    expect(ms, `parsing 1 MB took ${ms}ms for ${cookies.length} cookies`).toBeLessThan(2000);
  });

  // Landed 2026-09-22: RFC 6265 attribute names after the first piece are dropped.
  it('cookie attributes are not counted as extra cookies', () => {
    const setCookie = 'sid=abc123; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=None';
    expect(parseCookieList(setCookie).map((c) => c.name)).toEqual(['sid']);
  });

  it('…and the headline counts one cookie, not eight', () => {
    const setCookie = 'sid=abc123; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=None';
    const cookies = parseCookieList(setCookie);
    expect(cookies.map((c) => c.name)).toEqual(['sid']);
    expect(cookieListReport(cookies, 'paste').result.headline).toMatch(/\b1 cookie\b/);
  });

  // Landed 2026-09-22: MAX_PASTE_CHARS on the element and in the parser, MAX_PASTED_COOKIES pieces.
  it('an oversized paste is capped rather than parsed in full', () => {
    const big = 'ck=0123456789; '.repeat(Math.ceil((1024 * 1024) / 15));
    expect(parseCookieList(big).length).toBeLessThanOrEqual(2000);
  });

  it('the check finds all three guards present, and still inspects all three', async () => {
    // Until 2026-09-22 this asserted the three MISSING guards by name. They
    // landed together; the check must now be clean AND must still have looked.
    const r = await runCheck('pro_paste_parser_robustness');
    expect(r.findings.map((f) => `${f.severity}: ${f.title}`)).toEqual([]);
    expect(r.checked).toBe(3);
  });
});
