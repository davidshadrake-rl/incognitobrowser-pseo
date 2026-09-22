/**
 * Audit group 2BC-client: the cookie analyzer's two client-only modes.
 *
 * The owner's claims for this tool, and what this file adds to each:
 *
 *   P1  "Only cookies on the current host appear; HttpOnly ones are hidden."
 *       The HttpOnly half is asserted in three places already (the e2e spec
 *       plants a real HttpOnly cookie, proves the browser is enforcing it, and
 *       proves it is absent from the rendered list). The FIRST half rested on
 *       one line — `expect(src).not.toMatch(/cookieStore|chrome\.cookies|
 *       browser\.cookies/)` — and a count of `document.cookie` that allows TWO
 *       because one of the two is the comment above the read.
 *
 *       Both of those are graded here by running the old shape and the new one
 *       over the SAME mutant: a second cookie source that the three spellings
 *       do not name, and a second read that the comment budget makes room for.
 *       The old shape passes both. That is the hole, demonstrated rather than
 *       asserted, and it is why every guard below runs over comment-stripped
 *       and string-stripped code instead of over the file as it reads.
 *
 *       That count is a guard reading its own explanatory comment — the test
 *       says so in its own words, "the line above it is a comment, which
 *       counts too". Nothing in this file is allowed to see a comment.
 *
 *   P3  "Does not attempt to read cookies from an embedded iframe of the
 *       target site." This had no assertion of any kind, anywhere: no test,
 *       no e2e spec and no SAST check in scripts/security/checks/ mentions
 *       iframe, contentDocument, contentWindow or postMessage for this tool.
 *       A same-origin frame adds nothing over document.cookie and a
 *       cross-origin one is unreadable, so today's residual is a refactor —
 *       which is exactly what a tripwire is for.
 *
 *   C2  the missing size cap. Reported, not closed: there is nothing to guard
 *       yet. What this file does add is an honestly sized probe. The last time
 *       a check in this repo sized its probe politely it wrote "the app-side
 *       caps are what actually bind today and they are correct" about a
 *       service one POST could OOM, so the cost is measured here at a size a
 *       clipboard really holds, and the render multiplier is read out of the
 *       component's own JSX rather than guessed.
 *
 *   C4  Expires=/Path= counted as cookies. The claim is false — the parser
 *       does treat them as cookies, and tests/pro-client-only.test.ts already
 *       pins that. What is NOT pinned is the mitigating half the owner's
 *       phrasing rests on: "in a way that breaks the page". The guard here is
 *       that the mis-parse stays cosmetic — the verdict a visitor is given
 *       must not move when attributes are present.
 *
 * WHAT THIS FILE CANNOT DO, said plainly so nobody counts it as done: "only
 * cookies on the current host appear" is settled by the browser's cookie
 * store (RFC 6265 §5.4), and the one honest way to assert it is to plant a
 * cookie belonging to another host and watch it not appear. That needs a real
 * cookie jar. vitest runs `environment: 'node'` here and jsdom is not a
 * dependency, so it belongs in e2e/pro-client-only.spec.ts beside the
 * HttpOnly plant that is already there. Reported, not faked.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
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

const CLIENT_SRC = readSrc(SCAN_CLIENT);
const CLIENT_TEXT = stripComments(CLIENT_SRC, { strings: false });

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
 * ?.cookie` is the same read with a different spelling, and a guard that reads
 * spellings is the thing this file exists to replace.
 */
function cookiePropertyReads(code: string): string[] {
  const out: string[] = [];
  const re = /([A-Za-z_$][\w$]*)\s*\??\s*\.\s*(cookies?|cookieStore|cookieJar)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) out.push(`${m[1]}.${m[2]}`);
  return out;
}

/**
 * The receivers this file is allowed to read a cookie property from.
 *
 *   document.cookie  the one browser source, and the whole basis of the
 *                    HttpOnly sentence beside the button.
 *   result.cookies / urlResult.cookies
 *                    the URL-scan payload's own array. That scan happens on
 *                    our server against a URL the visitor typed; it is not a
 *                    cookie store and it cannot reach this browser's.
 */
const ALLOWED_COOKIE_READS = ['document.cookie', 'result.cookies', 'urlResult.cookies'];

/**
 * Cookie sources that are not a property read: the CookieStore API, the
 * extension APIs, and the Android app's injected bridge.
 *
 * IncognitoBrowserApp is the interesting one and it is absent from the old
 * three-spelling list. It is an @JavascriptInterface the app's WebView puts on
 * our origins (lib/in-app.ts:186), which means it is the one object on this
 * page NOT bound by the same-origin policy. Its surface today is postMessage,
 * openUpgrade and saveImage — no cookie method. The day it grows one, "only
 * cookies on the current host appear" stops being a fact about the browser and
 * starts being a fact about an Android build nobody reviews here.
 *
 * document.requestStorageAccess is here for the same reason one step removed:
 * it is the call that asks for unpartitioned cookie access from inside an
 * embedded context, so it belongs beside the frame guards below.
 */
const FOREIGN_COOKIE_SOURCES: Array<{ re: RegExp; name: string }> = [
  { re: /\bcookieStore\b/, name: 'the CookieStore API (cookieStore)' },
  { re: /\bchrome\s*\??\s*\.\s*cookies\b/, name: 'chrome.cookies' },
  { re: /\bbrowser\s*\??\s*\.\s*cookies\b/, name: 'browser.cookies' },
  { re: /\bIncognitoBrowserApp\b/, name: "the Android app's injected bridge (IncognitoBrowserApp)" },
  { re: /\bdocument\s*\??\s*\.\s*requestStorageAccess\b/, name: 'document.requestStorageAccess()' },
];

/** Cookie access written as a computed key, which blanking strings would hide. */
const COMPUTED_COOKIE_ACCESS = /\[\s*['"`]\s*(?:cookies?|cookieStore)\s*['"`]\s*\]/i;

/**
 * Ways to read, or talk to, a document that is not this one. An embedded frame
 * of the scanned site is the shape P3 names; the rest are the same idea with
 * different plumbing, and `postMessage` is how a frame would answer.
 */
const CROSS_DOCUMENT_CHANNELS: Array<{ re: RegExp; name: string }> = [
  { re: /<\s*iframe\b/i, name: 'an <iframe> element' },
  { re: /\bcreateElement\s*\(\s*['"`]\s*(?:iframe|frame|object|embed)\b/i, name: 'createElement("iframe")' },
  { re: /\bsrcdoc\b/i, name: 'srcdoc' },
  { re: /\bcontentDocument\b/, name: 'contentDocument' },
  { re: /\bcontentWindow\b/, name: 'contentWindow' },
  { re: /\bframes\s*\[/, name: 'window.frames[]' },
  { re: /\bopener\b/, name: 'window.opener' },
  { re: /\bpostMessage\b/, name: 'postMessage' },
  { re: /\bdocument\s*\??\s*\.\s*domain\b/, name: 'document.domain' },
];

const crossDocumentChannels = (text: string) => CROSS_DOCUMENT_CHANNELS.filter((c) => c.re.test(text)).map((c) => c.name);
const foreignCookieSources = (code: string) => FOREIGN_COOKIE_SOURCES.filter((s) => s.re.test(code)).map((s) => s.name);

/** A copy of the component with one edit applied, and proof the edit landed. */
function mutate(edits: Array<[string, string]>): string {
  let out = SRC;
  for (const [from, to] of edits) {
    const next = out.replace(from, to);
    if (next === out) throw new Error(`mutation target not found: ${from.slice(0, 70)} — this demonstration is no longer demonstrating anything`);
    out = next;
  }
  return out;
}

/** The three assertions this file replaces, run as one predicate over raw source. */
function oldGuardPasses(src: string): boolean {
  return (src.match(/document\.cookie/g) || []).length <= 2
    && !/cookieStore|chrome\.cookies|browser\.cookies/.test(src)
    && src.includes('parseCookieList(document.cookie)');
}

const COMMENT_ANCHOR = '  // document.cookie lists only the cookies scripts may read: HttpOnly cookies never appear in it.\n';
const READ_ANCHOR = '    setCookies(parseCookieList(document.cookie));';

// ────────────── P1: document.cookie is the only cookie source ─────────────

describe('P1 — only cookies on the current host appear', () => {
  it('document.cookie is read exactly once in CODE, and a comment is not part of that count', () => {
    // The old assertion allowed two `document.cookie` and said so: "One in the
    // code; the line above it is a comment, which counts too." Half the budget
    // was spent on prose, which means a second real read fits inside it as
    // soon as anyone tidies the comment away.
    const inCode = (CODE.match(/document\.cookie/g) || []).length;
    const inFile = (SRC.match(/document\.cookie/g) || []).length;
    expect(inCode, 'document.cookie is read more than once — each read needs grading on its own').toBe(1);
    expect(inFile, 'the count over the raw file is the one that includes the comment').toBe(2);
    // …and the single read goes straight into the pure parser.
    expect(CODE).toContain('parseCookieList(document.cookie)');
  });

  it('the old guard passes a second cookie read that this one catches', () => {
    // Delete one comment line, add a read of the opener's cookies. The budget
    // of two is now free, the three spellings do not name `opener`, and the
    // `parseCookieList(document.cookie)` line is untouched.
    const mutant = mutate([
      [COMMENT_ANCHOR, ''],
      [READ_ANCHOR, `    const alsoTheirs = opener.document.cookie;\n${READ_ANCHOR}\n    void alsoTheirs;`],
    ]);
    expect(oldGuardPasses(mutant), 'the old guard caught this — the hole being demonstrated is not there').toBe(true);

    const mutantCode = stripComments(mutant);
    expect((mutantCode.match(/document\.cookie/g) || []).length).toBe(2);
    expect(crossDocumentChannels(stripComments(mutant, { strings: false }))).toContain('window.opener');
  });

  it("the old guard passes a cookie source it does not know the name of, and this one does not", () => {
    // Nothing here is spelled cookieStore, chrome.cookies or browser.cookies,
    // document.cookie is still read once into the parser, and the file still
    // contains the exact string the old assertion looked for. It passes.
    const mutant = mutate([
      [READ_ANCHOR, `    const fromApp = IncognitoBrowserApp.getAllCookies();\n${READ_ANCHOR}\n    setCookies((cs) => [...cs, ...parseCookieList(fromApp)]);`],
    ]);
    expect(oldGuardPasses(mutant), 'the old guard caught the bridge — the hole being demonstrated is not there').toBe(true);

    const found = foreignCookieSources(stripComments(mutant));
    expect(found).toContain("the Android app's injected bridge (IncognitoBrowserApp)");
  });

  it('every cookie property read in this file is one of three known receivers', () => {
    const reads = cookiePropertyReads(CODE);
    // Non-vacuity first: if the scan cannot even see the one read everybody
    // knows about, its silence about the others means nothing.
    expect(reads, 'the property scan did not find document.cookie — it is matching nothing').toContain('document.cookie');
    expect(reads.filter((r) => r === 'document.cookie')).toHaveLength(1);
    expect([...new Set(reads)].sort()).toEqual([...ALLOWED_COOKIE_READS].sort());
  });

  it('a second receiver, however it is spelled, is reported', () => {
    for (const [label, replacement] of [
      ['chrome.cookies', `    chrome.cookies.getAll({}, (all) => setCookies(parseCookieList(all)));\n${READ_ANCHOR}`],
      ['optional chaining', `    const c2 = window?.cookieStore;\n${READ_ANCHOR}\n    void c2;`],
      ['a same-origin frame', `    const f = document.createElement('iframe');\n    const theirs = f.contentWindow.document.cookie;\n${READ_ANCHOR}\n    void theirs;`],
    ] as const) {
      const mutant = mutate([[READ_ANCHOR, replacement]]);
      const mutantCode = stripComments(mutant);
      const caught = [
        ...cookiePropertyReads(mutantCode).filter((r) => !ALLOWED_COOKIE_READS.includes(r)),
        ...foreignCookieSources(mutantCode),
        ...crossDocumentChannels(stripComments(mutant, { strings: false })),
        ...((mutantCode.match(/document\.cookie/g) || []).length === 1 ? [] : ['a second document.cookie read']),
      ];
      expect(caught, `${label} was not reported by any guard in this file`).not.toEqual([]);
    }
  });

  it('no cookie is read through a computed key, where blanking strings would hide it', () => {
    // `document['cookie']` survives stripComments(src) as `document[" "]`, so
    // the property scan above cannot see it. This one reads the copy that
    // keeps literals.
    expect(COMPUTED_COOKIE_ACCESS.test(TEXT), 'a cookie property is read through a computed key').toBe(false);
    expect(COMPUTED_COOKIE_ACCESS.test(CLIENT_TEXT), `${SCAN_CLIENT} reads a cookie property through a computed key`).toBe(false);
    // and the detector is not simply broken
    expect(COMPUTED_COOKIE_ACCESS.test(`const v = document['cookie'];`)).toBe(true);
  });

  it('neither the tool nor the scanner client names a cookie source other than document.cookie', () => {
    expect(foreignCookieSources(CODE)).toEqual([]);
    expect(foreignCookieSources(stripComments(CLIENT_SRC))).toEqual([]);
    // The detector list is live: prove each entry matches the thing it names.
    for (const s of FOREIGN_COOKIE_SOURCES) {
      const sample = `cookieStore chrome.cookies browser.cookies IncognitoBrowserApp document.requestStorageAccess`;
      expect(s.re.test(sample), `${s.name} does not match its own sample — this entry is decoration`).toBe(true);
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
  it('neither the tool nor the scanner client can reach a second document', () => {
    // The scanned site is fetched by our server (lib/scan-client posts the URL
    // to /scan-url and renders what comes back). Nothing client-side ever
    // loads the target itself, so there is no frame to read — and a frame of a
    // cross-origin target could not be read anyway. This is the tripwire for
    // the refactor that changes that, which is the only way the claim can stop
    // being true.
    expect(crossDocumentChannels(TEXT), `${COOKIE_TOOL} can now reach another document`).toEqual([]);
    expect(crossDocumentChannels(CLIENT_TEXT), `${SCAN_CLIENT} can now reach another document`).toEqual([]);
  });

  it('…and that guard reports each channel when one is added', () => {
    // Every entry proved against a sample, so a typo in one regex cannot leave
    // a quiet hole in the list above.
    const samples: Array<[string, string]> = [
      ['an <iframe> element', '<iframe src={url} />'],
      ['createElement("iframe")', "const f = document.createElement('iframe');"],
      ['srcdoc', '<div srcdoc={html} />'],
      ['contentDocument', 'const d = f.contentDocument;'],
      ['contentWindow', 'const w = f.contentWindow;'],
      ['window.frames[]', 'const d = frames[0];'],
      ['window.opener', 'const o = opener;'],
      ['postMessage', 'w.postMessage("give me your cookies", "*");'],
      ['document.domain', 'document.domain = "example.com";'],
    ];
    for (const [name, sample] of samples) {
      expect(crossDocumentChannels(sample), `${name} is not detected by its own entry`).toContain(name);
    }

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

// ───────────── C2: what an uncapped paste actually costs ─────────────────

describe('C2 — the paste has no size cap at any layer', () => {
  /**
   * Reported in needsSourceChange, not closed: there is no cap to guard, so
   * no assertion here can fail because one broke. What these two tests do is
   * put the real number on the record at a size a clipboard really holds —
   * the previous probe stopped at 1 MB — and read the render multiplier out of
   * the component instead of estimating it.
   *
   * The cost is the visitor's own tab. Nothing about this reaches the droplet:
   * the paste never leaves the browser (pro_paste_not_posted_to_api, and the
   * runtime network trap in tests/pro-client-only.test.ts), and there is no
   * URL parameter, handoff or sessionStorage path that fills this textarea —
   * the visitor has to paste it themselves. Saying that plainly matters: this
   * is a usability failure in a privacy tool, not the DDoS the owner is
   * worried about, and dressing it up as one would cost the next report its
   * credibility.
   */
  const UNIT = 'ck=0123456789; ';
  const MB = 1024 * 1024;

  it('an 8 MB paste is parsed in full, because nothing anywhere says not to', () => {
    const pieces = Math.ceil((8 * MB) / UNIT.length);
    const big = UNIT.repeat(pieces);
    expect(big.length).toBeGreaterThan(8 * MB);

    const started = Date.now();
    const cookies = parseCookieList(big);
    const ms = Date.now() - started;

    // Every piece becomes an object. This is the assertion that goes red the
    // day a cap lands — which is the point: it is wired to the fix.
    expect(cookies, `8 MB parsed to ${cookies.length} cookies in ${ms}ms`).toHaveLength(pieces);
    expect(cookies.length).toBeGreaterThan(500_000);
    // The parse itself is linear and is not the expensive half; recorded so
    // the next reader does not have to re-measure it to find that out.
    expect(ms, `parsing 8 MB took ${ms}ms`).toBeLessThan(20_000);
  });

  it('and the component renders one card per cookie, with no slice in front of it', () => {
    // The render multiplier, read from the source rather than remembered.
    const start = SRC.indexOf('{cookies.map(');
    expect(start, 'the paste/this-page result no longer maps over cookies — re-read this test').toBeGreaterThan(-1);
    const end = SRC.indexOf('))}', start);
    const card = SRC.slice(start, end);
    expect(card, 'the extracted block is not the cookie card').toContain('c.description');
    expect(card).toContain('c.name');

    const elementsPerCard = [...card.matchAll(/<\s*[a-zA-Z]/g)].length;
    expect(elementsPerCard, 'the card markup shrank to nothing — the arithmetic below would flatter it').toBeGreaterThanOrEqual(5);

    // No cap between the parsed list and the DOM.
    const mapped = SRC.slice(SRC.lastIndexOf('\n', start), end);
    expect(mapped, 'there is now a .slice() before the map — flip this test and close C2').not.toMatch(/cookies\s*\.\s*slice\s*\(/);
    // And none on the way in, either.
    expect(TEXT, 'the textarea grew a maxLength — flip this test and close C2').not.toMatch(/<textarea[\s\S]{0,400}?maxLength/);

    const cookiesFrom8MB = Math.ceil((8 * MB) / UNIT.length);
    const elements = cookiesFrom8MB * elementsPerCard;
    expect(
      elements,
      `an 8 MB paste asks React for ${elements.toLocaleString()} elements (${cookiesFrom8MB.toLocaleString()} cards × ${elementsPerCard}) on the main thread, in one synchronous commit`,
    ).toBeGreaterThan(2_000_000);
  });
});

// ───────── C4: attributes are counted, but must stay cosmetic ────────────

describe('C4 — Expires= and Path= are counted as cookies', () => {
  const SET_COOKIE = 'sid=abc123; Domain=.example.com; Path=/; Expires=Thu, 01 Jan 2099 00:00:00 GMT; Max-Age=3600; Secure; HttpOnly; SameSite=None';

  it('the claim is false: a Set-Cookie line is reported as eight cookies', () => {
    // Pinned again here, one line from the guard below, because the guard is
    // only meaningful next to the behaviour it is mitigating.
    expect(parseCookieList(SET_COOKIE).map((c) => c.name))
      .toEqual(['sid', 'Domain', 'Path', 'Expires', 'Max-Age', 'Secure', 'HttpOnly', 'SameSite']);
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

  it('…and what the visitor is shown is wrong by exactly the attribute count', () => {
    // The full misleading surface, so the size of the cosmetic damage is on
    // the record next to the proof that it is cosmetic: the headline, the
    // "Cookies" tile and the console's `checks={cookies.length}` all read 8.
    const report = cookieListReport(parseCookieList(SET_COOKIE), 'paste');
    expect(report.result.headline).toContain('8 cookies');
    expect(report.result.stats?.find((s) => s.label === 'Cookies')?.value).toBe('8');
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
