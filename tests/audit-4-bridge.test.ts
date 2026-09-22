/**
 * Audit follow-up, group 4 (the WebView bridge): the assertions the existing
 * bridge suite does not make.
 *
 * tests/pro-bridge.test.ts and scripts/security/checks/pro-bridge-contract.mjs
 * already cover what the page SENDS. What neither of them reaches is the shape
 * of the thing that receives it. Three holes were found in the follow-up pass,
 * and each one is a place where a real, damaging edit keeps the whole suite
 * green:
 *
 *  1. NOTHING ASSERTED THE INJECTION MECHANISM. Every existing assertion reads
 *     the `setOf( … )` string and the `when` branches out of IN-APP-BRIDGE.md
 *     §2. Rewrite that snippet's `WebViewCompat.addWebMessageListener(` to
 *     `webView.addJavascriptInterface(ObjFor(` — swapping the origin-scoped
 *     androidx API for the one that injects the object into EVERY page and
 *     frame the WebView loads — and both extractors still match, so the tests
 *     and the checks stay green over a contract that no longer scopes the
 *     bridge to our origins at all. "saveImage is accepted only from our
 *     origin" rests entirely on that one API name, and nothing was pinning it.
 *
 *  2. THE DISPATCH ASSERTION READ ITS OWN COMMENTS. tests/pro-bridge.test.ts
 *     pulls the `when (msg.optString("action"))` branches out of the raw
 *     Markdown. Comment out a branch in the Kotlin — `// "saveImage" ->
 *     saveImage(msg)` — and the regex still finds it and still reports two
 *     branches. This repo has shipped a guard that matched its own explanatory
 *     comment twice; this is the same failure shape in the one document the
 *     Android team copies code out of. Everything below strips Kotlin comments
 *     before it asserts. The stripper has NO self-test on purpose: the first
 *     version had one, and its only input was a string literal in this file,
 *     so no edit to any source file could make it fail — a test that cannot
 *     fail is deleted, not kept (verifier, 2026-09-21). What keeps the
 *     stripper honest instead is source: the B6 closure test requires every
 *     tier origin from lib/tiers.ts to survive stripping and come out of the
 *     contract's setOf, so a stripper that ate the `https://` inside a string
 *     literal fails there, against real input.
 *
 *  3. THE RE-REGISTERABLE-HOST RULE WAS BYPASSED BY A JSON EDIT. When this
 *     file was written, mast-bridge-origin-allowlist.mjs tested
 *     `allowed.has(origin)` BEFORE it tested RE_REGISTERABLE, and `allowed`
 *     included everything in scripts/security/data/mast-bridge-hosts.json —
 *     so adding `https://<anything>.pages.dev` to that JSON and to the
 *     document was ONE repo edit that handed `window.IncognitoBrowserApp`, and
 *     with it saveImage()'s native MediaStore write, to a subdomain that goes
 *     back into a public pool when it is released, with both checks green.
 *     That ordering was fixed in 4deb62d the same day; the check's own list is
 *     still seven suffixes, and inapp-bridge-origin-allowlist.mjs still knows
 *     only the word "vercel" (DEAD_PLATFORM = /\bvercel\b/i).  (no-vercel-guard: this file detects the host, it does not depend on it)
 *     The B6 block below keeps the wider suffix list, and its header says
 *     exactly how far that list reaches — it is not far.
 *
 * WHAT THIS FILE CANNOT DO, said plainly rather than graded green. There is no
 * APK and no Android source in this repo. Every assertion here is about the
 * CONTRACT — the document the app team implements from — and about the WEB
 * side. "The shipped app scopes the bridge to these origins", "the shipped app
 * ignores an unknown action" and "the shipped app rejects ../../Download/evil.html"
 * are claims about a different codebase on a different release cycle, and
 * nothing in this repository can establish any of them. What the contract says
 * is the only lever this repo has on them, which is why a silent edit to the
 * contract is worth failing a build over.
 *
 * Filename and MIME validation (gaps B2 and B3) are NOT closed here: there is
 * no validation on the web side to test. What is asserted instead is the
 * containment that keeps them unreachable today — and it is asserted from the
 * call sites themselves, not from the allowlist JSON, so a second caller that
 * passes a visitor-supplied name fails this file whether or not somebody
 * remembered to update scripts/security/data/mast-in-app-consumers.json.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { saveImageInApp } from '@/lib/in-app';
import { scorecardFilename } from '@/lib/scorecard';

const REPO = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf-8');

const DOC = 'IN-APP-BRIDGE.md';
const IN_APP = 'lib/in-app.ts';
const SCORECARD = 'lib/scorecard.ts';
const UPGRADE_BUTTONS = 'components/UpgradeButtons.tsx';
const HOSTS_JSON = 'scripts/security/data/mast-bridge-hosts.json';

// ---------------------------------------------------------------------------
// Comment strippers. Both of them matter, and the Kotlin one is the subtle
// case: the origins in the allowlist are `"https://…"` string literals, so the
// naive /\/\/.*$/ that works on TypeScript would delete the allowlist itself
// and leave every assertion below passing over an empty string. This walks the
// source instead, tracking string literals. It is exercised only against the
// real document — see header note 2 for why there is no literal self-test.
// ---------------------------------------------------------------------------
function stripKotlinComments(src: string): string {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (inString) {
      if (c === '\\') { out += c + (next ?? ''); i += 2; continue; }
      if (c === '"') inString = false;
      out += c;
      i++;
      continue;
    }
    if (c === '"') { inString = true; out += c; i++; continue; }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** TypeScript/JS source with comments removed, so prose about a call is not a call. */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/** Every ```fenced``` block in a Markdown document, with its language tag. */
function fences(md: string): Array<{ lang: string; body: string }> {
  const out: Array<{ lang: string; body: string }> = [];
  const lines = md.split('\n');
  let lang: string | null = null;
  let buf: string[] = [];
  for (const line of lines) {
    const open = /^\s*```(\w*)\s*$/.exec(line);
    if (open && lang === null) { lang = open[1] || 'plain'; buf = []; continue; }
    if (/^\s*```/.test(line) && lang !== null) { out.push({ lang, body: buf.join('\n') }); lang = null; continue; }
    if (lang !== null) buf.push(line);
  }
  return out;
}

/** §2's Kotlin snippet — the code the Android team copies — with its comments taken out. */
function listenerSnippet(): string {
  const kotlin = fences(read(DOC)).filter((f) => f.lang === 'kotlin');
  expect(kotlin.length, `${DOC} has no \`\`\`kotlin fence — the listener the app team copies is not in the contract any more`).toBeGreaterThan(0);
  return stripKotlinComments(kotlin.map((f) => f.body).join('\n'));
}

// ---------------------------------------------------------------------------
// B1. The bridge is injected by the origin-scoped API, and by nothing else.
// ---------------------------------------------------------------------------
describe('B1 — the injection mechanism, not just the origin strings', () => {
  it('the contract registers the bridge with WebViewCompat.addWebMessageListener, with the origin set as its argument', () => {
    // THIS IS THE ASSERTION THAT WAS MISSING. addWebMessageListener takes an
    // allowed-origin set and injects the object into those origins only.
    // addJavascriptInterface takes no origins at all: it puts the object on
    // every page and every frame the WebView loads, which is the difference
    // between "saveImage is reachable from our pages" and "saveImage is
    // reachable from any page the user opens in the browser". The origins have
    // to be an ARGUMENT to that call, not merely present somewhere in the
    // document, or the list is decoration.
    const snippet = listenerSnippet();
    expect(
      snippet,
      'IN-APP-BRIDGE.md §2 no longer registers the bridge through WebViewCompat.addWebMessageListener(webView, "<name>", setOf(…)) — an un-scoped injection API here grants the bridge to every page the WebView loads',
    ).toMatch(/WebViewCompat\.addWebMessageListener\(\s*\w+\s*,\s*"[^"]+"\s*,\s*setOf\(/);
    // And the set that lands in that argument is not empty.
    const setOf = /setOf\(([\s\S]*?)\)/.exec(snippet);
    expect(setOf, 'the setOf( … ) allowlist is gone from the listener registration').not.toBeNull();
    expect([...setOf![1].matchAll(/"([^"]+)"/g)].length).toBeGreaterThan(0);
  });

  it('no code fence in the contract reaches for addJavascriptInterface', () => {
    // §2's prose says not to use it, and says that if the app team must, every
    // method has to check the origin itself. Prose is the instruction; a fence
    // is what gets copied. Comments are stripped first so a fence cannot be
    // made to pass by commenting the call out, and the prose warning is
    // asserted separately so deleting the warning is also a failure.
    const doc = read(DOC);
    for (const f of fences(doc)) {
      expect(
        stripKotlinComments(f.body),
        `a ${f.lang} fence in ${DOC} calls addJavascriptInterface — that API has no origin allowlist`,
      ).not.toMatch(/addJavascriptInterface\s*\(/);
    }
    expect(doc, `${DOC} no longer warns the app team off addJavascriptInterface`).toMatch(/Don't use `addJavascriptInterface` for this/);
  });

  it('the object name the page probes for is the name the contract registers', () => {
    // lib/in-app.ts decides it is inside the app by finding this global. If the
    // two names drift, the page silently falls back to the deep link and the
    // allowlist in the contract is guarding a name nothing looks for.
    const src = stripTsComments(read(IN_APP));
    const declared = [...src.matchAll(/\{\s*(\w+)\?\s*:\s*(?:AppBridge|unknown)\s*\}/g)].map((m) => m[1]);
    expect(declared.length, `${IN_APP} no longer probes window.<name> for the app bridge`).toBeGreaterThan(0);
    expect(new Set(declared).size, `${IN_APP} probes more than one global name for the bridge: ${declared.join(', ')}`).toBe(1);
    const registered = /addWebMessageListener\(\s*\w+\s*,\s*"([^"]+)"/.exec(listenerSnippet());
    expect(registered, 'the listener registration no longer names the JavaScript object it injects').not.toBeNull();
    expect(registered![1], `${DOC} registers "${registered![1]}" but ${IN_APP} looks for "${declared[0]}"`).toBe(declared[0]);
  });

  it('the listener drops subframes before it parses anything', () => {
    // An allowed origin in a subframe is still an allowed origin to
    // addWebMessageListener. Without this guard, an iframe on one of our pages
    // — an embed, an ad, anything that gets a frame onto the host — posts into
    // the same native handler. This repo cannot enforce it in the APK; it can
    // refuse to let it vanish from the contract the APK is built from.
    const snippet = listenerSnippet();
    expect(snippet, 'the isMainFrame parameter is gone from the listener lambda').toMatch(/\{[^\n]*\bisMainFrame\b[^\n]*->/);
    expect(snippet, 'the !isMainFrame early return is gone — a subframe on an allowed origin now reaches the native handler').toMatch(/if\s*\(\s*!isMainFrame\s*\)\s*return@addWebMessageListener/);
    const guardAt = snippet.search(/if\s*\(\s*!isMainFrame\s*\)/);
    const parseAt = snippet.indexOf('JSONObject(');
    const dispatchAt = snippet.search(/when\s*\(/);
    expect(parseAt, 'the listener no longer parses the message — the snippet this reasons about has changed shape').toBeGreaterThan(-1);
    expect(dispatchAt, 'the listener no longer dispatches on an action').toBeGreaterThan(-1);
    expect(guardAt, 'the subframe guard must come before the message is parsed').toBeLessThan(parseAt);
    expect(guardAt, 'the subframe guard must come before the action dispatch').toBeLessThan(dispatchAt);
  });
});

// ---------------------------------------------------------------------------
// B4. The dispatch, read as code rather than as text.
// ---------------------------------------------------------------------------
describe('B4 — the action dispatch, with the comments taken out', () => {
  /** The `when (msg.optString("action")) { … }` body, comments already gone. */
  function dispatchBody(): string {
    const when = /when\s*\(\s*msg\.optString\("action"\)\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(listenerSnippet());
    expect(when, `the when(msg.optString("action")) dispatch is gone from ${DOC} §2`).not.toBeNull();
    return when![1];
  }

  it('the branches are the two documented actions once commented-out code stops counting', () => {
    // tests/pro-bridge.test.ts asserts the same list against the RAW Markdown,
    // so `// "saveImage" -> saveImage(msg)` still reads as a live branch there.
    // A commented-out branch is a handoff the app silently drops — the exact
    // failure that made "Save image" do nothing for every app user and started
    // this whole document.
    const body = dispatchBody();
    const branches = [...body.matchAll(/"([^"]+)"\s*->/g)].map((m) => m[1]);
    expect(branches, 'the dispatch no longer handles exactly upgrade and saveImage as live Kotlin').toEqual(['upgrade', 'saveImage']);
    // Each branch does something: `"saveImage" ->` with nothing after it is a
    // branch that parses and ignores.
    for (const line of body.split('\n').filter((l) => /->/.test(l))) {
      expect(line.split('->')[1].trim().length, `a dispatch branch has an empty body: ${line.trim()}`).toBeGreaterThan(0);
    }
    expect(body, 'the dispatch gained a catch-all — with only named branches an unknown action is ignored by construction').not.toMatch(/(^|\n)\s*else\s*->/);
  });

  it('the branches and the actions the page can send are the same two, derived from both sides', () => {
    // Neither list is written down here. The page's side comes out of
    // lib/in-app.ts (comments stripped, so a documented-but-dead action does
    // not count), the app's side out of the contract. They have to agree: an
    // action the page sends with no branch is a dropped handoff, and a branch
    // for an action the page cannot send is a native capability reachable from
    // any script on an allowlisted origin with nothing in this repo that uses it.
    const sent = [...stripTsComments(read(IN_APP)).matchAll(/action:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(sent.length, `${IN_APP} sends no bridge action at all any more`).toBeGreaterThan(0);
    const branches = [...dispatchBody().matchAll(/"([^"]+)"\s*->/g)].map((m) => m[1]);
    expect([...new Set(sent)].sort()).toEqual([...new Set(branches)].sort());
  });

  it('the dispatch lives inside the origin-scoped listener, not in a snippet of its own', () => {
    // A `when` block in a second fence would satisfy the branch assertions
    // while the real listener — the one with the origin allowlist — handled
    // something else entirely.
    const snippet = listenerSnippet();
    const listenerAt = snippet.indexOf('WebViewCompat.addWebMessageListener(');
    const dispatchAt = snippet.search(/when\s*\(\s*msg\.optString\("action"\)\s*\)/);
    expect(listenerAt, 'the origin-scoped registration is gone').toBeGreaterThan(-1);
    expect(dispatchAt, 'the action dispatch is gone').toBeGreaterThan(-1);
    expect(dispatchAt, 'the action dispatch is no longer inside the addWebMessageListener registration').toBeGreaterThan(listenerAt);
    // …and there is exactly one registration to be inside of.
    expect([...snippet.matchAll(/addWebMessageListener\(/g)].length, 'the contract now registers more than one web message listener').toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B2 / B3. Containment, asserted at the call sites.
// ---------------------------------------------------------------------------
describe('B2, B3 — the filename and the MIME type: containment at the call site', () => {
  const SOURCE_DIRS = ['app', 'components', 'lib'];
  const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.next' || name === 'out') continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }

  /** Every file under app/, components/ and lib/ that calls saveImageInApp, minus its definition. */
  function callSites(): Array<{ rel: string; code: string; call: string }> {
    const out: Array<{ rel: string; code: string; call: string }> = [];
    for (const d of SOURCE_DIRS) {
      for (const abs of walk(join(REPO, d))) {
        if (!SOURCE_EXT.test(abs)) continue;
        const rel = relative(REPO, abs).split(sep).join('/');
        if (rel === IN_APP) continue;
        const code = stripTsComments(readFileSync(abs, 'utf-8'));
        for (const m of code.matchAll(/\bsaveImageInApp\s*\(/g)) {
          out.push({ rel, code, call: code.slice(m.index, m.index + 200) });
        }
      }
    }
    return out;
  }

  it('every call site wraps its filename in scorecardFilename() and its bytes in renderScorecard()', () => {
    // saveImageInApp applies NO validation: lib/in-app.ts:264 puts `filename`
    // straight into the message and :261 takes whatever MIME the Blob carries.
    // On the far side the app decodes the base64 and writes the file into
    // MediaStore. The only reason ../../Download/evil.html and update.apk are
    // not reachable today is that the single caller builds both values itself.
    //
    // mast-save-image-caller-allowlist grades the caller LIST, which a second
    // caller passes by adding itself to a JSON file. This grades what every
    // caller PASSES, which a second caller cannot talk its way past: hand this
    // function an uploaded photo's name (the metadata tool), a fetched image,
    // or anything a visitor typed, and this fails.
    const sites = callSites();
    expect(sites.length, 'nothing calls saveImageInApp any more — the containment this asserts has no subject').toBeGreaterThan(0);
    for (const s of sites) {
      const m = /\bsaveImageInApp\s*\(\s*([A-Za-z_$][\w$]*)\s*,\s*scorecardFilename\s*\(/.exec(s.call);
      expect(
        m,
        `${s.rel} calls saveImageInApp with a filename that did not come from scorecardFilename(): ${s.call.split('\n')[0].trim()}`,
      ).not.toBeNull();
      const blobVar = m![1];
      expect(
        s.code,
        `${s.rel} passes ${blobVar} to saveImageInApp, but ${blobVar} is not the Blob renderScorecard() produced — the MIME type reaching the native write is then whatever that Blob carries`,
      ).toMatch(new RegExp(`\\b${blobVar}\\s*=\\s*await\\s+renderScorecard\\s*\\(`));
    }
  });

  it('renderScorecard pins image/png at the canvas, which is where the MIME type is decided', () => {
    // lib/in-app.ts:261 is `const mime = blob.type || 'image/png'` — no
    // allowlist. The type therefore comes from whatever produced the Blob.
    // canvas.toBlob's second argument is that decision, and without it the
    // browser's default is implementation-defined rather than ours.
    const src = stripTsComments(read(SCORECARD));
    expect(src, `${SCORECARD} no longer asks canvas.toBlob for image/png explicitly`).toMatch(/canvas\.toBlob\([\s\S]{0,200}?,\s*'image\/png'\s*\)/);
  });

  it('a hostile tool title still crosses the bridge as a bounded .png name', async () => {
    // Behavioural, through the real exported function against a recording
    // bridge: this is the shape the one live caller actually produces, so if
    // scorecardFilename regresses the traversal reaches the native write.
    const bridge = messages();
    const hostile = '../../Download/evil.html  <script> .apk';
    expect(await saveImageInApp(png(), scorecardFilename(hostile))).toBe(true);
    const filename = String(bridge[0].filename);
    expect(filename).not.toContain('..');
    expect(filename).not.toMatch(/[\\/]/);
    expect(filename.endsWith('.png')).toBe(true);
    expect(filename).toMatch(/^privacy-scorecard-[a-z0-9-]*\.png$/);
  });

  it('the payload that reaches native is exactly the five documented fields', async () => {
    // IN-APP-BRIDGE.md §3 documents v, action, filename, mime and base64. A
    // sixth field is a new value crossing into native code, and the place to
    // notice it is here rather than in an app release note.
    const bridge = messages();
    expect(await saveImageInApp(png(), 'privacy-scorecard-x.png')).toBe(true);
    expect(Object.keys(bridge[0]).sort()).toEqual(['action', 'base64', 'filename', 'mime', 'v']);
    expect(bridge[0].v).toBe(1);
    expect(bridge[0].action).toBe('saveImage');
  });

  // -- the recording bridge ------------------------------------------------
  let recorded: Array<Record<string, unknown>>;
  const messages = () => recorded;
  const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  beforeEach(() => {
    recorded = [];
    const attrs = new Map<string, string>([['data-inapp', 'param']]);
    const root = {
      setAttribute: (k: string, v: string) => { attrs.set(k, v); },
      removeAttribute: (k: string) => { attrs.delete(k); },
      getAttribute: (k: string) => (attrs.has(k) ? attrs.get(k)! : null),
      hasAttribute: (k: string) => attrs.has(k),
    };
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('window', {
      location: { pathname: '/tools/ad-tracking/ad-blocker-test/' },
      IncognitoBrowserApp: { postMessage: (s: string) => { recorded.push(JSON.parse(s)); } },
    });
    vi.stubGlobal('location', { pathname: '/tools/ad-tracking/ad-blocker-test/' });
    // Node has Blob but no FileReader, and saveImageInApp base64s through one.
    vi.stubGlobal('FileReader', class {
      result: string | null = null;
      error: unknown = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      readAsDataURL(b: Blob) {
        b.arrayBuffer().then((buf) => {
          this.result = `data:${b.type};base64,${Buffer.from(buf).toString('base64')}`;
          this.onload?.();
        });
      }
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
});

// ---------------------------------------------------------------------------
// B6 (and the B5 scope caveat). What gates the bridge allowlist, and what does
// not — stated at the width it actually has.
// ---------------------------------------------------------------------------
describe('B6 — what gates the bridge allowlist, and what does not', () => {
  /**
   * THE ONE CLOSED-WORLD GATE is the last test in this block, and its twin in
   * tests/pro-bridge.test.ts: every origin the contract's setOf hands the app
   * is a tier origin (lib/tiers.ts) or a declared extra in
   * scripts/security/data/mast-bridge-hosts.json, and nothing else. That gate
   * is exactly one JSON edit wide, by design — the JSON file IS the review
   * step, and the second test here grades what an entry in it has to look
   * like. Nothing in this repository can tell a host we own from a host we do
   * not; that judgement is why the file demands a written reason, and it is a
   * human's to make. The first pass's header for this block claimed an origin
   * "needs more than a JSON edit". It does not, and the verifier proved it:
   * https://incognitobrowser-pro.deno.dev, https://ibpro-abc123-uc.a.run.app
   * and https://paywall.some-vendor.example, each declared with a plausible
   * reason, passed this block 16/16 and mast-bridge-origin-allowlist with
   * findings 0.
   *
   * RE_REGISTERABLE below is NOT a second closed-world gate. It is an
   * enumeration of 21 shared-hosting suffixes — hosts where a subdomain is
   * ALLOCATED rather than registered and returns to a public pool when the
   * account closes, which is precisely what the 2026-09-18 incident was: two
   * *.vercel.app names in the allowlist while that account was being closed.  (no-vercel-guard: this file detects the host, it does not depend on it)
   * What it catches: an origin on any of those 21 suffixes, wherever it
   * appears — tier origin, declared extra, or bare setOf entry — including a
   * declared extra, which the security check exempted from its own (7-suffix)
   * test until 4deb62d. What it does not catch: deno.dev, *.a.run.app, any
   * suffix that is not on the list, and any plain third-party domain. Against
   * those it is silent, and the only thing that fires is the closed-world gate
   * above, which fires only if the JSON was not also edited. The other check
   * in this area, inapp-bridge-origin-allowlist.mjs, still knows one word.
   */
  const RE_REGISTERABLE = /(^|\.)(vercel\.app|netlify\.app|netlify\.com|pages\.dev|workers\.dev|github\.io|gitlab\.io|herokuapp\.com|onrender\.com|surge\.sh|web\.app|firebaseapp\.com|fly\.dev|glitch\.me|repl\.co|replit\.app|azurewebsites\.net|amplifyapp\.com|ngrok\.io|ngrok-free\.app|trycloudflare\.com)$/i;  // no-vercel-guard: names the host in order to refuse it

  /**
   * Wildcard DNS run by somebody else: every `<ip>.nip.io` name resolves
   * because a third party answers for it, so our identity on such a name
   * depends on their zone — and whoever serves that zone can pass the domain
   * validation that issues a certificate for it. IN-APP-BRIDGE.md:15 says all
   * of this about the current live host and calls it temporary. That host is a
   * tier origin, deliberately and visibly; this rule governs what may be ADDED
   * to the declared extras, which is the edit nobody reviews.
   */
  const WILDCARD_DNS = /(^|\.)(nip\.io|sslip\.io|xip\.io|traefik\.me|localtest\.me|lvh\.me)$/i;

  /**
   * The origins the contract hands the app, read as live Kotlin: the UNION of
   * every setOf( … ) in the fence, and a refusal of any origin literal that
   * is outside one.
   *
   * The first version was `/setOf\(([\s\S]*?)\)/.exec(snippet)` — one match,
   * the first setOf, and stop. Kotlin sets add with `+`, so
   *     setOf("https://206-189-186-34.nip.io", …) + setOf("https://partner-paywall.example"),
   * is a valid registration that hands a third party the bridge, and it left
   * this file 16/16, tests/pro-bridge.test.ts 25/25 and only a non-blocking
   * medium from mast-bridge-origin-allowlist (verifier mutation V14,
   * 2026-09-21). Every B6 assertion read the same first-block-only extractor,
   * so all of them were blind to the second block at once. What the app is
   * told to trust is the whole expression, so the whole expression is graded:
   * every setOf, and — because `+ listOf(…)`, `hashSetOf(…)` or a bare string
   * appended with `+` would dodge a setOf-only reader just as well — every
   * scheme-qualified string literal in the live Kotlin has to be inside one.
   */
  function allowlistOrigins(): string[] {
    const snippet = listenerSnippet();
    const blocks = [...snippet.matchAll(/setOf\(([\s\S]*?)\)/g)];
    expect(blocks.length, `${DOC} §2 has no setOf( … ) allowlist`).toBeGreaterThan(0);
    const raw = blocks.flatMap((b) => [...b[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]));
    expect(raw.length, 'the bridge allowlist is empty once commented-out entries stop counting').toBeGreaterThan(0);
    for (const literal of [...snippet.matchAll(/"(https?:\/\/[^"]*)"/g)].map((m) => m[1])) {
      expect(
        raw,
        `${literal} is an origin literal in the live Kotlin of ${DOC} §2 that is not inside any setOf( … ) — it reaches the app by a route this extractor does not read, and nothing below would grade it`,
      ).toContain(literal);
    }
    return [...new Set(raw)];
  }

  /** FREE_BASE_URL / PRO_BASE_URL defaults, read from source so no env var can move them. */
  function tierOrigins(): Set<string> {
    const src = read('lib/tiers.ts');
    const out = new Set<string>();
    for (const name of ['FREE_BASE_URL', 'PRO_BASE_URL']) {
      const m = new RegExp(`${name}[^=]*=\\s*[\\s\\S]{0,200}?\\|\\|\\s*'([^']+)'`).exec(src);
      expect(m, `lib/tiers.ts no longer declares a default for ${name}`).not.toBeNull();
      out.add(new URL(m![1]).origin);
    }
    return out;
  }

  it('no origin in the contract or the declared extras is on one of the 21 enumerated shared-hosting suffixes', () => {
    // An enumeration, not a host-class oracle: see the header. It reaches the
    // declared extras as well as the document, which is the one thing the
    // security check did not do when this was written; it does not reach any
    // suffix that is not in the list.
    const extras: Array<{ origin: string; reason?: string }> = JSON.parse(read(HOSTS_JSON)).extraOrigins || [];
    const everything = [...allowlistOrigins(), ...extras.map((e) => e.origin)];
    expect(everything.length).toBeGreaterThan(0);
    for (const raw of everything) {
      let host: string;
      try { host = new URL(raw).host; } catch { throw new Error(`"${raw}" is in the bridge allowlist and is not a parseable origin`); }
      expect(
        RE_REGISTERABLE.test(host),
        `${raw} is on shared hosting infrastructure: the subdomain returns to a public pool when the account is closed, and whoever is allocated it next is handed window.IncognitoBrowserApp — openUpgrade() and saveImage(), a native MediaStore write — in every app user's WebView, until the app team ships a release. This is the 2026-09-18 Vercel incident with a different suffix; only "vercel" itself was ever pinned.`,  // no-vercel-guard: names the host in order to refuse it
      ).toBe(false);
    }
  });

  it('every declared extra origin is an exact https origin, with a reason, and not on third-party wildcard DNS', () => {
    // scripts/security/data/mast-bridge-hosts.json is the whole gate. Both
    // security checks and tests/pro-bridge.test.ts treat anything in it as
    // allowed, so these are the properties that have to hold of an entry
    // someone adds in a hurry.
    const extras: Array<{ origin: string; reason?: string }> = JSON.parse(read(HOSTS_JSON)).extraOrigins || [];
    expect(extras.length, 'the declared-extras file is empty — if the cutover host has gone, the allowlist assertions below are grading nothing').toBeGreaterThan(0);
    const tiers = tierOrigins();
    for (const e of extras) {
      expect(e.origin, `a declared extra origin has a wildcard in it: ${e.origin}`).not.toContain('*');
      const u = new URL(e.origin);
      expect(u.protocol, `${e.origin} is not https — the bridge would be granted to a plaintext origin`).toBe('https:');
      expect(u.origin, `${e.origin} is not an exact origin (origin matching in addWebMessageListener is scheme + host + port, so a path here is a misunderstanding of what is being granted)`).toBe(e.origin.replace(/\/$/, ''));
      expect(String(e.reason || '').length, `${e.origin} is declared with no real reason — this file is the only review step between an edit and a native bridge on that host`).toBeGreaterThan(40);
      expect(
        WILDCARD_DNS.test(u.host) && !tiers.has(u.origin),
        `${e.origin} is on third-party wildcard DNS. Whoever answers for that zone can point the name elsewhere and pass the domain validation that issues its certificate. The live host is already one of these and IN-APP-BRIDGE.md:15 calls it temporary; adding another is moving the wrong way.`,
      ).toBe(false);
    }
  });

  it('the destinations an upgrade button can carry are not in the allowlist and are not ours to serve', () => {
    // The B5 scope caveat, pinned. components/UpgradeButtons.tsx currently
    // points every upgrade button at a third-party staging paywall
    // (DEMO_UPGRADE_URL, an owner decision dated 2026-09-17), and that href is
    // not matched by isUpgradeLink() — no data-upgrade attribute, not a
    // play.google.com link — so inside the app the tap is NOT handed to the
    // native upgrade screen: the WebView navigates to it. That is tolerable
    // only while that origin is a page like any other. The moment it appears
    // in the bridge allowlist or among the tier origins, a third-party
    // property is being handed saveImage() inside the app.
    const demo = /export\s+const\s+DEMO_UPGRADE_URL\s*=\s*'([^']*)'/.exec(stripTsComments(read(UPGRADE_BUTTONS)));
    expect(demo, `${UPGRADE_BUTTONS} no longer declares DEMO_UPGRADE_URL — the demo switch this reasons about has changed shape`).not.toBeNull();
    const destinations = [demo![1], 'https://play.google.com/store/apps/details'].filter(Boolean);
    const allowed = new Set([...allowlistOrigins().map((o) => new URL(o).origin), ...tierOrigins()]);
    for (const d of destinations) {
      const origin = new URL(d).origin;
      expect(
        allowed.has(origin),
        `${origin} is both a destination an upgrade button sends the WebView to and an origin the app injects the bridge into`,
      ).toBe(false);
    }
  });

  it('the allowlist is the tier origins plus the declared extras, and nothing else — across every setOf', () => {
    // The closure tests/pro-bridge.test.ts makes, repeated here because the
    // assertions above depend on it and because this one reads the union of
    // every setOf block rather than the first: if an origin could be in the
    // document without being in either list, grading the two lists would miss
    // it entirely. This is THE gate (header); everything else in this block
    // is narrower.
    const extras: string[] = (JSON.parse(read(HOSTS_JSON)).extraOrigins || []).map((e: { origin: string }) => e.origin);
    const tiers = tierOrigins();
    const allowed = new Set([...tiers, ...extras]);
    const contract = allowlistOrigins().map((raw) => {
      try { return new URL(raw).origin; } catch { throw new Error(`"${raw}" is in the bridge allowlist and is not a parseable origin`); }
    });
    for (const origin of contract) {
      expect([...allowed], `${origin} is handed the bridge by ${DOC} but is neither a tier origin nor a declared extra`).toContain(origin);
    }
    // And the other direction, from source: the origins lib/tiers.ts serves
    // the pages from are all in the contract. A contract that omits the live
    // origin injects no bridge where the pages actually are (the 2026-09-18
    // allowlist was "both too permissive and non-functional"), and it is also
    // what keeps the comment stripper honest — a stripper that ate the
    // `https://` inside the string literals could not produce these.
    for (const origin of tiers) {
      expect(contract, `${origin} is a tier origin in lib/tiers.ts but ${DOC} §2 does not hand the app a bridge there`).toContain(origin);
    }
  });
});
