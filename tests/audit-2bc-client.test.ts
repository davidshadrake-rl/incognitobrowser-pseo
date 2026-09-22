/**
 * Audit group 2BC-client: the cookie analyzer's two client-only modes.
 *
 * WHAT A SOURCE GUARD IS, said first because the last version of this file said
 * otherwise. Every guard below reads source text and looks for spellings. That
 * catches the ordinary regression — an <iframe> written inline, a
 * `parent.document` read, a helper one import away — and it catches nothing
 * else. `'ifr' + 'ame'`, `el[key]`, `Reflect.get(doc, 'cookie')`, a nested
 * destructure, a helper two imports deep, markup pushed through innerHTML and
 * read back through a computed key: each walks through every regex here, and
 * no list of regexes will close that, because the list is finite and the ways
 * JavaScript can name a property are not. The verifier of the last version
 * proved it — three edits that left the tool embedding the scanned site and
 * reading its cookies, every test green — while that version's header called
 * its receiver list "closed-world". It was not. This one does not claim to be.
 *
 * What covers the claims at RUNTIME is e2e/pro-client-only.spec.ts, which
 * drives the deployed page with a real cookie jar and a request watcher, and
 * does not care how a read is spelled:
 *   - a cookie planted for ANOTHER host must never appear in the This Page
 *     result — the only honest test of "only cookies on the current host";
 *   - an HttpOnly cookie planted on THIS host must never appear;
 *   - a URL scan must produce no request from the browser to the scanned
 *     host — a tool that embedded the target would have to load it, and the
 *     context-level watcher records every frame load.
 * This file is the cheap tripwire that runs on every `vitest run`. That file is
 * the proof, and it runs with the deployed suite.
 *
 * The owner's claims, and what this file adds to each:
 *
 *   P1  "Only cookies on the current host appear; HttpOnly ones are hidden."
 *       The old assertion was one line — `not.toMatch(/cookieStore|chrome\.
 *       cookies|browser\.cookies/)` — and a count of `document.cookie` that
 *       allowed TWO because one of the two was the comment above the read. A
 *       guard that reads its own explanatory comment is a guard that fails
 *       when the comment moves and passes when the code does. Nothing in this
 *       file is allowed to see a comment: every guard runs over the repo's
 *       own comment-stripped view of the source.
 *
 *       Two tests that used to sit here were deleted on 2026-09-22. Each built
 *       a mutant string in this file and asserted a predicate from this file
 *       over it — both sides authored by the test, and the shipped tool
 *       touched only through a string anchor. They passed while the tool read
 *       another document's cookies and failed when a comment was edited. The
 *       fact they demonstrated (the old three-spelling guard had holes) is
 *       true and is stated in this paragraph, which is where it belonged.
 *
 *   P3  "Does not attempt to read cookies from an embedded iframe of the
 *       target site." This had no assertion of any kind before the audit. The
 *       guard now scans the component AND every first-level local import it
 *       has (`@/…`, `./…`), because moving code into a helper is the most
 *       ordinary refactor there is and the last version read one of the
 *       component's eight local imports. `parent` and `top` were missing from
 *       the channel list; they are in it. Second-level imports are NOT
 *       followed: lib/in-app.ts, two hops away, legitimately calls postMessage
 *       on the Android bridge, and an exemption list is where a guard goes to
 *       rot. A helper two hops deep walks through — see the first paragraph.
 *
 *   C2  the missing size cap. Three caps landed (textarea maxLength, a
 *       character slice, a piece slice) and the guards import the constants,
 *       so a raised cap is still a cap and a removed one goes red.
 *
 *   C4  Expires=/Path= counted as cookies. The parser now drops RFC 6265
 *       attribute names after the first piece, and the mitigating half the
 *       owner's phrasing rests on — "not in a way that breaks the page" — is
 *       pinned: the verdict must not move when attributes are present.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MAX_PASTED_COOKIES, MAX_PASTE_CHARS,
  cookieListReport,
  parseCookieList,
 } from '../components/tools/CookieAnalyzerTool';

const ROOT = path.join(__dirname, '..');
const COOKIE_TOOL = 'components/tools/CookieAnalyzerTool.tsx';
const SCAN_CLIENT = 'lib/scan-client.ts';
const SAST_LIB = 'scripts/security/checks/sast-lib.mjs';

for (const rel of [COOKIE_TOOL, SCAN_CLIENT, SAST_LIB]) {
  if (!fs.existsSync(path.join(ROOT, rel))) throw new Error(`${rel} is missing — this test would grade nothing`);
}

const readSrc = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

/**
 * The repo's own stripper, not a new one: scripts/security/checks/sast-lib.mjs
 * is what the SAST checks read code through, and it understands JSX, template
 * literals and regex literals. Borrowing it means this file and the checks
 * cannot disagree about what counts as "in the code".
 */
const { stripComments } = (await import(path.join(ROOT, SAST_LIB) as string)) as {
  stripComments: (src: string, opts?: { strings?: boolean }) => string;
};

const SRC = readSrc(COOKIE_TOOL);
/** Comments AND string literals blanked: for reading call and property shapes. */
const CODE = stripComments(SRC);
/** Comments blanked, literals kept: for spellings that hide inside a string. */
const TEXT = stripComments(SRC, { strings: false });

// The stripper must really have stripped, or every "not found" below is a
// sentence about an empty string.
if (!/parseCookieList/.test(CODE)) throw new Error('stripComments blanked the code itself — every guard here would pass vacuously');
if (/HttpOnly cookies never appear in it/.test(CODE)) throw new Error('stripComments left comments in place — the guards below would be graded against prose');

// ─────────────────────────── the guards, as functions ────────────────────
//
// Each guard is a pure function of source text so that it can be run against
// the real tree AND against a deliberately broken copy in the same test. A
// guard nobody has watched fail is a guard nobody knows works.

/**
 * Every `x.cookie` / `x.cookies` / `x.cookieStore` property read in executable
 * code, as `receiver.property`. Optional chaining is included: `document
 * ?.cookie` is the same read with a different spelling.
 *
 * This sees the syntactic form `identifier.property` and nothing else. A
 * destructure is caught by DESTRUCTURED_COOKIE_READ, a computed key by
 * COMPUTED_COOKIE_ACCESS, and everything past those by nothing in this file.
 */
function cookiePropertyReads(code: string): string[] {
  const out: string[] = [];
  const re = /([A-Za-z_$][\w$]*)\s*\??\s*\.\s*(cookies?|cookieStore|cookieJar)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(`${m[1]}.${m[2]}`);
  return out;
}

/**
 * The receivers the component is allowed to read a cookie property from.
 *
 *   document.cookie  the one browser source, and the whole basis of the
 *                    HttpOnly sentence beside the button.
 *   result.cookies / urlResult.cookies
 *                    the URL-scan payload's own array. That scan happens on
 *                    our server against a URL the visitor typed; it is not a
 *                    cookie store and it cannot reach this browser's.
 *
 * Its imports get a stricter rule: no `.cookie` (singular) read on anything.
 * `.cookies` plural is the scan payload's array (lib/site-grade.ts reads
 * `r.cookies`); `.cookie` singular is a document's jar, and as of 2026-09-22
 * nothing else in lib/, components/ or app/ has a property by that name.
 */
const ALLOWED_COOKIE_READS = ['document.cookie', 'result.cookies', 'urlResult.cookies'];

/**
 * Cookie sources that are not a property read: the CookieStore API, the
 * extension APIs, and the Android app's injected bridge.
 *
 * IncognitoBrowserApp is the interesting one. It is an @JavascriptInterface
 * the app's WebView puts on our origins (lib/in-app.ts), which means it is the
 * one object on this page NOT bound by the same-origin policy. Its surface
 * today is postMessage, openUpgrade and saveImage — no cookie method. The day
 * it grows one, "only cookies on the current host appear" stops being a fact
 * about the browser and starts being a fact about an Android build nobody
 * reviews here.
 *
 * document.requestStorageAccess is the call that asks for unpartitioned cookie
 * access from inside an embedded context, so it belongs beside the frame
 * guards below.
 *
 * Every entry carries the sample it must match, so a typo in one regex cannot
 * leave a quiet hole in the list.
 */
const FOREIGN_COOKIE_SOURCES: Array<{ re: RegExp; name: string; sample: string }> = [
  { re: /\bcookieStore\b/, name: 'the CookieStore API (cookieStore)', sample: 'const all = await cookieStore.getAll();' },
  { re: /\bchrome\s*\??\s*\.\s*cookies\b/, name: 'chrome.cookies', sample: 'chrome.cookies.getAll({}, cb);' },
  { re: /\bbrowser\s*\??\s*\.\s*cookies\b/, name: 'browser.cookies', sample: 'browser?.cookies.getAll({});' },
  { re: /\bIncognitoBrowserApp\b/, name: "the Android app's injected bridge (IncognitoBrowserApp)", sample: 'IncognitoBrowserApp.getAllCookies()' },
  { re: /\bdocument\s*\??\s*\.\s*requestStorageAccess\b/, name: 'document.requestStorageAccess()', sample: 'await document.requestStorageAccess();' },
];

/** Cookie access written as a computed key, which blanking strings would hide. */
const COMPUTED_COOKIE_ACCESS = /\[\s*['"`]\s*(?:cookies?|cookieStore)\s*['"`]\s*\]/i;

/**
 * Cookie access written as a destructure: `const { cookie } = theirDoc` names
 * no receiver, so cookiePropertyReads() cannot see it. This was one of the
 * verifier's three walks through the last version. Only the one-level
 * `const/let/var { … cookie … } =` shape is caught; a nested pattern or a
 * parameter destructure is not.
 */
const DESTRUCTURED_COOKIE_READ = /\b(?:const|let|var)\s*\{[^}]*\bcookies?\b[^}]*\}\s*=/;

/**
 * Ways to reach, or talk to, a document that is not this one. An embedded
 * frame of the scanned site is the shape P3 names; the rest are the same idea
 * with different plumbing, and `postMessage` is how a frame would answer.
 *
 * Two entries exist because the verifier walked past their absence:
 *   - `parent` / `top` are the frame's OWN handles on the documents above it;
 *     `const { cookie } = parent.document` read another document with
 *     nothing on the old list spelled.
 *   - createElement() with anything but a plain quoted tag: `const tag =
 *     'ifr' + 'ame'; document.createElement(tag)` is a frame that the literal
 *     regex cannot see. The component's one createElement is `('a')`, for the
 *     CSV download, and stays allowed.
 * Every entry carries the sample it must match.
 */
const CROSS_DOCUMENT_CHANNELS: Array<{ re: RegExp; name: string; sample: string }> = [
  { re: /<\s*iframe\b/i, name: 'an <iframe> element', sample: '<iframe src={url} />' },
  { re: /\bcreateElement\s*\(\s*['"`]\s*(?:iframe|frame|object|embed)\b/i, name: 'createElement("iframe")', sample: "const f = document.createElement('iframe');" },
  { re: /\bcreateElement\s*\(\s*(?!['"][a-z][a-z0-9-]*['"]\s*[,)])/, name: 'createElement() with anything but a plain literal tag', sample: "const tag = 'ifr' + 'ame'; const el = document.createElement(tag);" },
  { re: /\bcreateElementNS\s*\(/, name: 'createElementNS()', sample: "document.createElementNS(ns, 'iframe')" },
  { re: /\bsrcdoc\b/i, name: 'srcdoc', sample: '<div srcdoc={html} />' },
  { re: /\bcontentDocument\b/, name: 'contentDocument', sample: 'const d = f.contentDocument;' },
  { re: /\bcontentWindow\b/, name: 'contentWindow', sample: 'const w = f.contentWindow;' },
  { re: /\bframes\s*\[/, name: 'window.frames[]', sample: 'const d = frames[0];' },
  { re: /\bopener\b/, name: 'window.opener', sample: 'const o = opener;' },
  {
    re: /(?<![\w$.])(?:parent|top)\s*\??\s*\.\s*(?:document|frames|location|window|self|opener|parent|top|postMessage)\b|\b(?:window|self|globalThis)\s*\??\s*\.\s*(?:parent|top)\b/,
    name: 'window.parent / window.top',
    sample: 'const { cookie: alsoTheirs } = parent.document;',
  },
  { re: /\bpostMessage\b/, name: 'postMessage', sample: 'w.postMessage("give me your cookies", "*");' },
  { re: /\bdocument\s*\??\s*\.\s*domain\b/, name: 'document.domain', sample: 'document.domain = "example.com";' },
];

const crossDocumentChannels = (text: string) => CROSS_DOCUMENT_CHANNELS.filter((c) => c.re.test(text)).map((c) => c.name);
const foreignCookieSources = (code: string) => FOREIGN_COOKIE_SOURCES.filter((s) => s.re.test(code)).map((s) => s.name);

/**
 * The local modules a file imports at first level — `@/…`, `./…`, `../…` —
 * as written. Packages are not this repo's code and are skipped; `import
 * type` ships nothing and is skipped. Each match is kept inside one statement
 * by `[^;'"]*?`, so a side-effect import with no `from` cannot borrow the next
 * statement's specifier.
 */
function localImportSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\b(?:import|export)\s+(type\s+)?[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g)) {
    if (m[1]) continue;
    out.push(m[2]);
  }
  for (const m of text.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) out.push(m[1]);
  return out.filter((s) => s.startsWith('@/') || s.startsWith('./') || s.startsWith('../'));
}

/** Those specifiers resolved to repo-relative files. */
function localImportsOf(rel: string): string[] {
  const out: string[] = [];
  for (const spec of localImportSpecifiers(stripComments(readSrc(rel), { strings: false }))) {
    const base = spec.startsWith('@/')
      ? spec.slice(2)
      : path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
    const found = candidates.find((c) => {
      const abs = path.join(ROOT, c);
      return fs.existsSync(abs) && fs.statSync(abs).isFile();
    });
    // A helper the scan cannot find is a helper the scan does not guard, and
    // that must be loud rather than a quietly shorter list.
    if (!found) throw new Error(`${rel} imports '${spec}' and this scan cannot resolve it`);
    out.push(found);
  }
  return [...new Set(out)];
}

/** The component's first-level local imports: every file this scan reads besides the component. */
const COMPONENT_IMPORTS = localImportsOf(COOKIE_TOOL);

/** A copy of the component with one edit applied, and proof the edit landed. */
function mutate(edits: Array<[string, string]>): string {
  let out = SRC;
  for (const [from, to] of edits) {
    const next = out.replace(from, to);
    if (next === out) throw new Error(`mutation target not found: ${from.slice(0, 70)} — this detector self-test no longer exercises the real file`);
    out = next;
  }
  return out;
}

/** The one line that reads the browser's cookies. Code, not a comment: if it moves, every self-test below must be re-read. */
const READ_ANCHOR = '    setCookies(parseCookieList(document.cookie));';

// ────────────── P1: document.cookie is the only cookie source ─────────────

describe('P1 — only cookies on the current host appear', () => {
  it('document.cookie is read exactly once in the component, counted over code with comments blanked', () => {
    // The old assertion allowed two `document.cookie` and said so: "One in the
    // code; the line above it is a comment, which counts too." Half the budget
    // was spent on prose, which means a second real read fits inside it as
    // soon as anyone tidies the comment away. This count cannot see prose.
    const inCode = (CODE.match(/document\.cookie/g) || []).length;
    expect(inCode, 'document.cookie is read more than once — each read needs grading on its own').toBe(1);
    // …and the single read goes straight into the pure parser.
    expect(CODE).toContain('parseCookieList(document.cookie)');
  });

  it('every cookie property read in the component is one of three known receivers', () => {
    const reads = cookiePropertyReads(CODE);
    // Non-vacuity first: if the scan cannot even see the one read everybody
    // knows about, its silence about the others means nothing.
    expect(reads, 'the property scan did not find document.cookie — it is matching nothing').toContain('document.cookie');
    expect(reads.filter((r) => r === 'document.cookie')).toHaveLength(1);
    expect([...new Set(reads)].sort()).toEqual([...ALLOWED_COOKIE_READS].sort());
  });

  it("no first-level import reads a document's cookie jar, names a second source, or hides a read in a key or a destructure", () => {
    // The verifier moved the read into lib/cookie-peek.ts, imported it, and
    // the last version of this file — which read the component and one
    // hard-coded helper — stayed green. Every local import is read now.
    expect(COMPONENT_IMPORTS, 'the import scan found nothing — it is resolving nothing').toEqual(
      expect.arrayContaining([SCAN_CLIENT, 'lib/scanner.ts', 'components/tools/ResultContext.tsx']),
    );
    for (const rel of COMPONENT_IMPORTS) {
      const code = stripComments(readSrc(rel));
      const text = stripComments(readSrc(rel), { strings: false });
      const singular = cookiePropertyReads(code).filter((r) => r.endsWith('.cookie'));
      expect(singular, `${rel}, imported by the cookie tool, reads a document's cookie jar`).toEqual([]);
      expect(foreignCookieSources(code), `${rel}, imported by the cookie tool, names a cookie source`).toEqual([]);
      expect(COMPUTED_COOKIE_ACCESS.test(text), `${rel} reads a cookie property through a computed key`).toBe(false);
      expect(DESTRUCTURED_COOKIE_READ.test(code), `${rel} destructures a cookie property`).toBe(false);
    }
  });

  it('the import scan skips packages and type-only imports, and follows both alias and relative paths', () => {
    // A detector self-test, on a sample: the guard above is only as wide as
    // this function's reach.
    const sample = [
      "import { useState } from 'react';",
      "import type { Grade } from '@/lib/site-grade';",
      "import { scanUrl } from '@/lib/scan-client';",
      "import { Icon, type Family } from './Icon';",
      "export { x } from '../lib/x';",
      "import './styles.css';",
    ].join('\n');
    expect(localImportSpecifiers(sample)).toEqual(['@/lib/scan-client', './Icon', '../lib/x', './styles.css']);
    expect(COMPONENT_IMPORTS, 'import type is followed — the skip is not working').not.toContain('lib/site-grade.ts');
    expect(COMPONENT_IMPORTS.length).toBeGreaterThanOrEqual(5);
  });

  it('the spellings the verifier used against the last version are each reported now', () => {
    // A detector self-test over the real file with the real edit applied. The
    // shapes are the three walks from the verify phase plus the ones the old
    // one-line guard was blind to. This is NOT a claim about other spellings:
    // replace the destructure below with Reflect.get(theirDoc, 'coo' + 'kie')
    // and nothing here fires, which the header says in full.
    for (const [label, replacement] of [
      ['chrome.cookies', `    chrome.cookies.getAll({}, (all) => setCookies(parseCookieList(all)));\n${READ_ANCHOR}`],
      ['optional chaining', `    const c2 = window?.cookieStore;\n${READ_ANCHOR}\n    void c2;`],
      ['the Android bridge', `    const fromApp = IncognitoBrowserApp.getAllCookies();\n${READ_ANCHOR}\n    setCookies((cs) => [...cs, ...parseCookieList(fromApp)]);`],
      ['a second read through opener', `    const alsoTheirs = opener.document.cookie;\n${READ_ANCHOR}\n    void alsoTheirs;`],
      ['a same-origin frame', `    const f = document.createElement('iframe');\n    const theirs = f.contentWindow.document.cookie;\n${READ_ANCHOR}\n    void theirs;`],
      ['parent.document, destructured', `    const { cookie: alsoTheirs } = parent.document;\n${READ_ANCHOR}\n    setCookies((cs) => [...cs, ...parseCookieList(alsoTheirs)]);`],
      ['a concatenated tag and a destructured read', `    const tag = 'ifr' + 'ame';\n    const el = document.createElement(tag);\n    el.setAttribute('src', urlInput);\n    document.body.appendChild(el);\n    const key = 'content' + 'Document';\n    const theirDoc = el[key] as Document;\n    const { cookie } = theirDoc;\n${READ_ANCHOR}\n    setCookies((cs) => [...cs, ...parseCookieList(cookie)]);`],
    ] as const) {
      const mutant = mutate([[READ_ANCHOR, replacement]]);
      const mutantCode = stripComments(mutant);
      const caught = [
        ...cookiePropertyReads(mutantCode).filter((r) => !ALLOWED_COOKIE_READS.includes(r)),
        ...foreignCookieSources(mutantCode),
        ...crossDocumentChannels(stripComments(mutant, { strings: false })),
        ...(DESTRUCTURED_COOKIE_READ.test(mutantCode) ? ['a destructured cookie read'] : []),
        ...((mutantCode.match(/document\.cookie/g) || []).length === 1 ? [] : ['a second document.cookie read']),
      ];
      expect(caught, `${label} was not reported by any guard in this file`).not.toEqual([]);
    }
  });

  it('no cookie is read through a computed key or a destructure, where the property scan cannot see it', () => {
    // `document['cookie']` survives stripComments(src) as `document[" "]`, so
    // the property scan above cannot see it. This one reads the copy that
    // keeps literals. `const { cookie } = x` names no receiver at all.
    expect(COMPUTED_COOKIE_ACCESS.test(TEXT), 'a cookie property is read through a computed key').toBe(false);
    expect(DESTRUCTURED_COOKIE_READ.test(CODE), 'a cookie property is read by destructuring').toBe(false);
    // and the detectors are not simply broken
    expect(COMPUTED_COOKIE_ACCESS.test(`const v = document['cookie'];`)).toBe(true);
    expect(DESTRUCTURED_COOKIE_READ.test('const { cookie } = theirDoc;')).toBe(true);
    expect(DESTRUCTURED_COOKIE_READ.test('const { cookie: alsoTheirs } = parent.document;')).toBe(true);
    expect(DESTRUCTURED_COOKIE_READ.test('const [cookies, setCookies] = useState([]);'), 'array destructuring of state is not a cookie read').toBe(false);
  });

  it('the component names no cookie source other than document.cookie', () => {
    expect(foreignCookieSources(CODE)).toEqual([]);
    // The detector list is live: each entry matches the thing it names.
    for (const s of FOREIGN_COOKIE_SOURCES) {
      expect(s.re.test(s.sample), `${s.name} does not match its own sample — this entry is decoration`).toBe(true);
    }
  });

  it('the list can hold nothing the browser did not hand over, and nothing from the run before', () => {
    // This is the half of "only cookies on the current host" that belongs to
    // OUR code: the browser decides what document.cookie contains, and the
    // parser must neither invent an entry nor keep one. A cached list is how a
    // cookie from a previous page could appear on this one.
    const first = parseCookieList('_ga=GA1.2.1; sessionid=abc123; _fbp=fb.1.9');
    expect(first.map((c) => c.name)).toEqual(['_ga', 'sessionid', '_fbp']);

    const second = parseCookieList('only=1');
    expect(second.map((c) => c.name)).toEqual(['only']);

    const third = parseCookieList('_ga=GA1.2.1; sessionid=abc123; _fbp=fb.1.9');
    expect(third).toEqual(first);
    expect(parseCookieList('')).toEqual([]);
    // Every name in the output appears in the input, character for character.
    const input = 'a=1; bb=2; ccc=3';
    for (const c of parseCookieList(input)) expect(input).toContain(c.name);
  });
});

// ──────────────── P3: no embedded document, of any origin ────────────────

describe('P3 — the tool never embeds the scanned site to read its cookies', () => {
  it('neither the component nor any first-level local import can reach a second document', () => {
    // The scanned site is fetched by our server (lib/scan-client posts the URL
    // to /scan-url and renders what comes back). Nothing client-side ever
    // loads the target itself, so there is no frame to read — and a frame of a
    // cross-origin target could not be read anyway. This is the tripwire for
    // the refactor that changes that, in the component or in a helper one
    // import away. Two imports away it is blind; the header says so.
    expect(crossDocumentChannels(TEXT), `${COOKIE_TOOL} can now reach another document`).toEqual([]);
    for (const rel of COMPONENT_IMPORTS) {
      const text = stripComments(readSrc(rel), { strings: false });
      expect(crossDocumentChannels(text), `${rel}, imported by the cookie tool, can reach another document`).toEqual([]);
    }
  });

  it('…and that guard reports each channel when one is added', () => {
    // Every entry proved against its own sample, so a typo in one regex cannot
    // leave a quiet hole in the list above.
    for (const c of CROSS_DOCUMENT_CHANNELS) {
      expect(crossDocumentChannels(c.sample), `${c.name} is not detected by its own entry`).toContain(c.name);
    }
    // The allowed createElement stays allowed, and the words `top` and
    // `parent` on their own are not a channel.
    expect(crossDocumentChannels("const a = document.createElement('a');")).toEqual([]);
    expect(crossDocumentChannels('style={{ top: 0 }}; const p = node.parent.name; const { top } = rect;')).toEqual([]);

    // And over the real file, with the real edit applied.
    const mutant = mutate([[READ_ANCHOR, `    const frame = document.createElement('iframe');\n    frame.src = urlInput;\n    setCookies(parseCookieList(frame.contentDocument.cookie));`]]);
    expect(crossDocumentChannels(stripComments(mutant, { strings: false })))
      .toEqual(expect.arrayContaining(['createElement("iframe")', 'contentDocument']));
  });

  it('the component renders no embedding element at all', () => {
    // JSX tag names survive stripComments (they are code, not strings), so
    // this reads the same copy the guard above does.
    const tags = [...TEXT.matchAll(/<\s*([a-z][a-z0-9-]*)\b/g)].map((m) => m[1].toLowerCase());
    expect(tags.length, 'no lowercase JSX tags found — this component stopped rendering HTML').toBeGreaterThan(10);
    for (const banned of ['iframe', 'frame', 'frameset', 'object', 'embed', 'portal']) {
      expect(tags, `the cookie tool renders a <${banned}>`).not.toContain(banned);
    }
  });
});

// ───────── C2: what an uncapped paste actually costs ─────────────────

describe('C2 — the paste is capped at every layer', () => {
  /**
   * Until 2026-09-22 this block put the uncapped cost on the record: an 8 MB
   * paste became ~560,000 cookie objects and asked React for millions of
   * elements in one synchronous commit. Three caps landed — the textarea's
   * maxLength, a character slice in parseCookieList, and a piece slice after
   * filtering — and these are the guards. They import the constants rather
   * than restating the numbers, so a cap that is raised is still a cap and a
   * cap that is removed goes red.
   *
   * Still true, and still worth saying: the cost was the visitor's own tab.
   * The paste never leaves the browser (pro_paste_not_posted_to_api), so this
   * was a usability failure in a privacy tool, not the DDoS the owner is
   * worried about.
   */
  const UNIT = 'ck=0123456789; ';
  const MB = 1024 * 1024;

  it('an 8 MB paste parses to at most MAX_PASTED_COOKIES cookies', () => {
    const pieces = Math.ceil((8 * MB) / UNIT.length);
    const big = UNIT.repeat(pieces);
    expect(big.length).toBeGreaterThan(8 * MB);
    const started = Date.now();
    const cookies = parseCookieList(big);
    const ms = Date.now() - started;
    expect(cookies.length).toBe(MAX_PASTED_COOKIES);
    expect(MAX_PASTED_COOKIES).toBeLessThanOrEqual(5000);
    expect(ms, `parsing 8 MB took ${ms}ms`).toBeLessThan(5_000);
  });

  it('the character slice binds before the split, so one giant piece is bounded too', () => {
    const onePiece = 'a=' + 'x'.repeat(8 * MB);
    const [only] = parseCookieList(onePiece);
    expect(only.value.length).toBeLessThanOrEqual(MAX_PASTE_CHARS);
    expect(MAX_PASTE_CHARS).toBeLessThanOrEqual(256 * 1024);
  });

  it('the textarea refuses more than MAX_PASTE_CHARS at the element', () => {
    expect(TEXT, 'the paste textarea has no maxLength bound to MAX_PASTE_CHARS').toMatch(/<textarea[\s\S]{0,600}?maxLength=\{MAX_PASTE_CHARS\}/);
  });

  it('the render is bounded by the parse', () => {
    // The card loop maps over `cookies` with no slice of its own, and that is
    // fine because every writer of that state goes through parseCookieList.
    // A second, uncapped source of cookies is what would make this wrong.
    const start = SRC.indexOf('{cookies.map(');
    expect(start).toBeGreaterThan(-1);
    const elementsPerCard = [...SRC.slice(start, SRC.indexOf('))}', start)).matchAll(/<\s*[a-zA-Z]/g)].length;
    expect(MAX_PASTED_COOKIES * elementsPerCard).toBeLessThan(100_000);
    const writers = [...SRC.matchAll(/setCookies\(([^)]*)\)/g)].map((m) => m[1]);
    expect(writers.length).toBeGreaterThan(0);
    for (const w of writers) expect(w, `setCookies(${w}) bypasses parseCookieList`).toMatch(/parseCookieList\(|^\[\]$/);
  });
});

// ───────── C4: attributes are counted, but must stay cosmetic ────────────

describe('C4 — Set-Cookie attributes are not cookies', () => {
  const SET_COOKIE = 'sid=abc123; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=None';

  it('a Set-Cookie line is reported as one cookie, not eight', () => {
    // Was pinned at eight until 2026-09-22. The box's own label invites a
    // Set-Cookie line from DevTools, and the parser now drops RFC 6265
    // attribute names after the first piece.
    expect(parseCookieList(SET_COOKIE).map((c) => c.name)).toEqual(['sid']);
  });

  it('only pieces AFTER the first are eligible to be attributes', () => {
    expect(parseCookieList('path=/x; secure=1').map((c) => c.name)).toEqual(['path']);
    expect(parseCookieList('a=1; b=2; Path=/').map((c) => c.name)).toEqual(['a', 'b']);
  });

  it('the mitigating half holds: the verdict does not move when attributes are present', () => {
    // This is the part of the owner's phrasing that is true — "not in a way
    // that breaks the page" — and it was the only part with no assertion. It
    // holds for one reason: attribute names fall through categorizeCookie into
    // `unknown`/`medium`, and the score charges for high risk, tracking and
    // analytics only.
    //
    // That is a coincidence of the heuristics, not a decision, which is
    // exactly why it needs a tripwire: add `secure`, `path` or `domain` to any
    // naming rule in categorizeCookie, or charge for `unknown`, and a pasted
    // Set-Cookie line starts scoring a site for its own attributes.
    const one = cookieListReport(parseCookieList('sid=abc123'), 'paste');
    const eight = cookieListReport(parseCookieList(SET_COOKIE), 'paste');

    expect(eight.score, 'an attribute now costs the score — the mis-parse has stopped being cosmetic').toBe(one.score);
    expect(eight.grade).toEqual(one.grade);
    expect(eight.severity).toBe(one.severity);
    const tally = (r: typeof one) => r.result.stats?.filter((s) => s.label !== 'Cookies').map((s) => `${s.label}=${s.value}`);
    expect(tally(eight), 'an attribute was counted as tracking, analytics or functional').toEqual(tally(one));
  });

  it('…and what the visitor is shown counts the cookie, not its attributes', () => {
    const report = cookieListReport(parseCookieList(SET_COOKIE), 'paste');
    expect(report.result.headline).toMatch(/\b1 cookie\b/);
    expect(report.result.headline).not.toContain('8 cookies');
    expect(report.result.stats?.find((s) => s.label === 'Cookies')?.value).toBe('1');
    expect(SRC, 'the console no longer counts cookies.length — re-read this test').toContain('checks={cookies.length}');
  });

  it('This Page mode cannot hit this at all: document.cookie has no attributes in it', () => {
    // RFC 6265 §5.4: the Cookie header, and document.cookie with it, carries
    // name=value pairs and nothing else. So the wrong count is a Paste-mode
    // fact, and a fix belongs in the parser rather than in the button.
    const asTheBrowserGivesIt = 'sid=abc123; _ga=GA1.2.1; theme=dark';
    expect(parseCookieList(asTheBrowserGivesIt).map((c) => c.name)).toEqual(['sid', '_ga', 'theme']);
  });
});
