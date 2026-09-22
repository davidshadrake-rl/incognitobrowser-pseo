/**
 * Three CI ids that describe a property they never exercise.
 *
 * The audit graded this group "partial" for one repeated reason: the check id
 * names a runtime property, and the check body greps source text. A grep can
 * tell you the guard is spelled correctly. It cannot tell you the guard fires,
 * and it certainly cannot tell you what the guard is worth when the request
 * that would trip it never arrives in the first place. These tests supply the
 * half that was missing — they send the request.
 *
 * WHAT THIS FILE DOES NOT CLAIM.
 *
 *   - The native half of the bridge is not here. There is no APK and no
 *     Android source in this repo, so nothing below asserts what the app does
 *     with a message. Where the web side is the only side we can see, the test
 *     name says "the page" or "the contract", never "the app".
 *
 *   - saveImageInApp still validates neither the filename nor the MIME type.
 *     That is a source change and it is reported as one, not smuggled in here
 *     behind a passing test. What this file adds is the enforcement the
 *     containment argument was resting on but never had — see section B.
 *
 * Two specific failures in this repo's history shaped how these are written.
 * One test imported a module whose import regenerated the fixture it compared
 * against, so it passed unconditionally. One check found the right fact and
 * then graded it reassuringly because its probe was sized too politely to show
 * the consequence. So: every assertion below either drives a real exported
 * function or a real route handler, and every source string is compared with
 * comments stripped first — a guard that matches its own explanatory comment
 * has shipped twice here.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(__dirname, '..');
const read = (rel: string) => readFileSync(join(REPO, rel), 'utf-8');

/** Prose about the code is not the code. Both comment forms, always, before any match. */
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

// ===========================================================================
// A. pro_scan_url_origin_allowlist_company_host
//
// The check (scripts/security/checks/pro-scan-url-contract.mjs:322) reads
// lib/origin.ts and reports, correctly, that ALLOWED_ORIGINS is untested in
// practice: the same-origin shortcut carries every request the deploy smoke
// sends, so the configured list is never consulted. It then writes the cutover
// down as a four-step to-do. Nobody has performed the to-do against the code.
//
// These tests perform it. They drive the real POST /challenge handler — the
// route whose origin gate runs first, before the rate limit and before the
// challenge is minted, so a 403 here is the origin gate and nothing else.
// ===========================================================================

/** The API's own host at cutover: a company API host, not the demo droplet. */
const API_HOST = 'api.incognitobrowser.io';
/** The company Pro origin the cutover has to admit. Genuinely cross-origin to API_HOST. */
const COMPANY_PRO_ORIGIN = 'https://pro.incognitobrowser.io';
/** Today's demo origin, which is what /etc/ib-api.env names right now. */
const DEMO_ORIGIN = 'https://206-189-186-34.nip.io';

let savedHmac: string | undefined;
let savedRedis: string | undefined;
let savedAllowed: string | undefined;

beforeEach(() => {
  savedHmac = process.env.ALTCHA_HMAC_KEY;
  savedRedis = process.env.REDIS_URL;
  savedAllowed = process.env.ALLOWED_ORIGINS;
  process.env.ALTCHA_HMAC_KEY = 'audit-7-ci-ids-test-key-at-least-32-characters-long';
  // No Redis: the limiter falls back to its in-memory map, which is per module
  // instance and therefore per loadChallengeRoute() call.
  delete process.env.REDIS_URL;
  delete process.env.ALLOWED_ORIGINS;
});

afterEach(() => {
  if (savedHmac === undefined) delete process.env.ALTCHA_HMAC_KEY;
  else process.env.ALTCHA_HMAC_KEY = savedHmac;
  if (savedRedis === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = savedRedis;
  if (savedAllowed === undefined) delete process.env.ALLOWED_ORIGINS;
  else process.env.ALLOWED_ORIGINS = savedAllowed;
});

/**
 * A fresh route module bound to a fresh lib/origin, so whatever ALLOWED_ORIGINS
 * the test just set is the list the route runs with.
 *
 * The cache reset is not a convenience. getAllowedOrigins() memoises into
 * module scope (lib/origin.ts:20), so without this the FIRST test to touch the
 * module would fix the allowlist for every test after it — which is exactly the
 * shape of the bug that makes step 3 of the check's own cutover remediation
 * ("restart ib-api") load-bearing. That property gets its own test below rather
 * than being quietly worked around here.
 */
async function loadChallengeRoute() {
  const { vi } = await import('vitest');
  vi.resetModules();
  const origin = await import('@/lib/origin');
  origin._resetOriginCacheForTests();
  return import('@/app/challenge/route');
}

/**
 * `host` and `origin` are set independently on purpose. Equal ones take the
 * same-origin shortcut; different ones are the genuinely cross-origin call the
 * allowlist exists for and that nothing has ever sent.
 */
function challengeRequest(opts: { origin: string | null; host: string; ip: string }): NextRequest {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    host: opts.host,
    'x-forwarded-for': opts.ip,
  };
  if (opts.origin) headers.origin = opts.origin;
  return new NextRequest(`https://${opts.host}/challenge`, {
    method: 'POST',
    headers,
    body: '{}',
  });
}

describe('pro_scan_url_origin_allowlist_company_host — the allowlist, actually exercised', () => {
  it('a foreign Origin on a genuinely cross-origin call is refused 403 and gets no ACAO header', async () => {
    // The probe the deploy smoke does not send. Origin host !== Host header, so
    // the same-origin shortcut cannot fire and the decision is the allowlist's.
    process.env.ALLOWED_ORIGINS = COMPANY_PRO_ORIGIN;
    const { POST } = await loadChallengeRoute();
    const res = await POST(challengeRequest({ origin: 'https://evil.example', host: API_HOST, ip: '203.0.113.11' }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe('Origin not allowed.');
    // And the refusal does not hand the browser permission anyway. An ACAO
    // echoing a refused origin would make the 403 body readable cross-origin,
    // which is how a "blocked" endpoint still leaks its error surface.
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(res.headers.get('vary')).toBe('Origin');
  });

  it('the company Pro origin is admitted ONLY because ALLOWED_ORIGINS names it', async () => {
    // Step 1 and step 4 of the check's cutover remediation, performed. First
    // the configured case: the company Pro site calls the company API across
    // origins and the product works.
    process.env.ALLOWED_ORIGINS = `${COMPANY_PRO_ORIGIN},${DEMO_ORIGIN}`;
    {
      const { POST } = await loadChallengeRoute();
      const res = await POST(challengeRequest({ origin: COMPANY_PRO_ORIGIN, host: API_HOST, ip: '203.0.113.12' }));
      expect(res.status, 'the company Pro origin was refused with the allowlist naming it').toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(COMPANY_PRO_ORIGIN);
      // A real challenge came back, so the request went the whole way through
      // the handler rather than stopping somewhere benign.
      const body = await res.json();
      expect(Object.keys(body)).toEqual(expect.arrayContaining(['challenge', 'salt', 'signature']));
    }

    // Now the cutover that forgot the edit. ALLOWED_ORIGINS unset falls back to
    // DEFAULT_ALLOWED (lib/origin.ts:16), which names incognitobrowser.io and
    // www — not the Pro host, and not the demo droplet. The failure mode is a
    // 403 on every call from the Pro site: visible, and fail-closed.
    delete process.env.ALLOWED_ORIGINS;
    {
      const { POST } = await loadChallengeRoute();
      const res = await POST(challengeRequest({ origin: COMPANY_PRO_ORIGIN, host: API_HOST, ip: '203.0.113.13' }));
      expect(res.status, 'the fallback admitted the Pro origin, so forgetting the env edit would be invisible').toBe(403);
    }

    // Same request, same missing env, but from the origin the fallback DOES
    // name. This is the control: it proves the 403 above was the allowlist
    // deciding and not something unrelated refusing every cross-origin call.
    {
      const { POST } = await loadChallengeRoute();
      const res = await POST(challengeRequest({ origin: 'https://incognitobrowser.io', host: API_HOST, ip: '203.0.113.14' }));
      expect(res.status).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe('https://incognitobrowser.io');
    }
  });

  it("today's deployment answers 200 with the allowlist empty, and with the WRONG company in it", async () => {
    // THE HEADLINE FINDING, as behaviour rather than as a regex over
    // lib/origin.ts. The pages and the API share one host today, so every real
    // call takes the same-origin shortcut and ALLOWED_ORIGINS is not consulted
    // at all. Both of these are 200. That is why the green deploy smoke
    // (scripts/deploy-api.sh:130, which sends `origin:$SITE_ORIGIN` and nothing
    // else) is not evidence that the allowlist is configured correctly — it is
    // not evidence that the allowlist is configured at all.
    for (const [label, value] of [
      ['empty', ''],
      ['a different company entirely', 'https://pro.some-other-company.example'],
    ] as const) {
      if (value) process.env.ALLOWED_ORIGINS = value;
      else delete process.env.ALLOWED_ORIGINS;
      const { POST } = await loadChallengeRoute();
      const res = await POST(challengeRequest({
        origin: `https://${DEMO_ORIGIN.replace('https://', '')}`,
        host: DEMO_ORIGIN.replace('https://', ''),
        ip: '203.0.113.15',
      }));
      expect(res.status, `same-origin call with ALLOWED_ORIGINS ${label} should still be 200 today`).toBe(200);
      expect(res.headers.get('access-control-allow-origin')).toBe(DEMO_ORIGIN);
    }
  });

  it('the parsed allowlist is memoised, so editing the env without a restart changes nothing', async () => {
    // Step 3 of the check's remediation, demonstrated instead of asserted.
    // /etc/ib-api.env is hand-edited on the box and nothing re-reads it; a
    // cutover that edits the file and skips `systemctl restart ib-api` gets the
    // OLD list, silently, for as long as the process lives.
    const { vi } = await import('vitest');
    vi.resetModules();
    const origin = await import('@/lib/origin');
    origin._resetOriginCacheForTests();

    process.env.ALLOWED_ORIGINS = DEMO_ORIGIN;
    expect(origin.getAllowedOrigins()).toEqual([DEMO_ORIGIN]);

    // The cutover edit lands in the environment...
    process.env.ALLOWED_ORIGINS = COMPANY_PRO_ORIGIN;
    expect(
      origin.getAllowedOrigins(),
      'the memoised list followed an env change without a restart — the remediation step would be wrong',
    ).toEqual([DEMO_ORIGIN]);
    expect(origin.isOriginAllowed(COMPANY_PRO_ORIGIN, API_HOST)).toBe(false);

    // ...and only a restart (here, the cache reset) picks it up.
    origin._resetOriginCacheForTests();
    expect(origin.getAllowedOrigins()).toEqual([COMPANY_PRO_ORIGIN]);
    expect(origin.isOriginAllowed(COMPANY_PRO_ORIGIN, API_HOST)).toBe(true);
  });

  it('a malformed Origin falls through to the allowlist and is refused, never to the shortcut', async () => {
    // isOriginAllowed parses the Origin with new URL() inside a try. The catch
    // must fall THROUGH to the list, not return true — a throw that was caught
    // and treated as same-origin would admit every unparseable header.
    const { vi } = await import('vitest');
    vi.resetModules();
    const origin = await import('@/lib/origin');
    origin._resetOriginCacheForTests();
    process.env.ALLOWED_ORIGINS = COMPANY_PRO_ORIGIN;
    origin._resetOriginCacheForTests();

    for (const bad of ['null', 'not a url', '://', 'javascript:alert(1)', '']) {
      expect(origin.isOriginAllowed(bad, API_HOST), `malformed Origin "${bad}" was allowed`).toBe(false);
      expect(origin.corsHeadersFor(bad, API_HOST)['Access-Control-Allow-Origin']).toBeUndefined();
    }
    expect(origin.isOriginAllowed(null, API_HOST)).toBe(false);
  });
});

// ===========================================================================
// B. pro_bridge_saveImage_filename_and_mime
//
// The id names a property that does not hold: saveImageInApp (lib/in-app.ts:257)
// forwards both the filename and the MIME type to a native MediaStore write
// with no validation. The check reports that honestly — and reports it at
// `medium`, while tests/security-suite.test.ts fails only on high/critical and
// scripts/security/run.mjs:67 defaults to --fail-on=high. So the finding cannot
// block a commit.
//
// The argument that this is safe anyway is containment: exactly one caller,
// components/Scorecard.tsx, going through scorecardFilename(). That containment
// is owned by mast-save-image-caller-allowlist — which is ALSO `medium`, and
// emits its unexpected-caller finding at `medium`. So a second caller passing a
// visitor-supplied filename into an unvalidated native file write does not fail
// CI either. The whole argument rests on a check that cannot block.
//
// This section does not fix the function; that is a source change and it is
// reported as one. It makes the containment blocking, because vitest is in
// `npm run build` and the security suite's medium findings are not.
// ===========================================================================

const CALLER_SCAN_DIRS = ['app', 'components', 'lib'];
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs)$/;
const DEFINITION = 'lib/in-app.ts';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'out') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

describe('pro_bridge_saveImage_filename_and_mime — the containment it leans on, made blocking', () => {
  it('the function validates both values itself, so the caller allowlist is defence in depth, not the control', () => {
    // Rewritten 2026-09-22 when safeImageFilename() landed. This used to pin
    // the function as unvalidated so the section below could never be read as
    // "closed". Now the function refuses on its own — tests/pro-bridge.test.ts
    // proves it behaviourally — and the caller allowlist below is a second
    // layer, kept because a second caller passing visitor input is still a
    // bug worth stopping at build time.
    const src = stripComments(read(DEFINITION));
    const start = src.indexOf('export async function saveImageInApp');
    expect(start, 'saveImageInApp is gone or renamed — re-read this whole section').toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('\n}', start) + 2);
    expect(body).toMatch(/const name = safeImageFilename\(filename, mime\);/);
    expect(body).toMatch(/if \(!name\) return false;/);
    // The sanitised name is what crosses, on BOTH transports.
    expect(body).toMatch(/action: 'saveImage', filename: name, mime, base64/);
    expect(body).toMatch(/saveImage!\(base64, name, mime\)/);
    expect(body).not.toMatch(/action: 'saveImage', filename, mime/);
  });

  it('saveImageInApp has exactly the callers the reviewed allowlist names', () => {
    // mast-save-image-caller-allowlist asserts the same thing at `medium`,
    // where nothing fails. Here it is at a severity the repo actually enforces:
    // vitest runs inside `npm run build`, so a second caller stops the build.
    const allow = JSON.parse(read('scripts/security/data/mast-in-app-consumers.json'));
    const allowed: string[] = (allow.saveImageCallers || []).map((e: { path: string }) => e.path);
    expect(allowed.length, 'the allowlist is empty, which would make any caller set match vacuously').toBeGreaterThan(0);

    const dirs = CALLER_SCAN_DIRS.filter((d) => existsSync(join(REPO, d)));
    expect(dirs).toEqual(CALLER_SCAN_DIRS);
    const files = dirs.flatMap((d) => walk(join(REPO, d))).filter((f) => SOURCE_EXT.test(f));
    expect(files.length, 'the walk found nothing — this test would pass over an empty repo').toBeGreaterThan(50);

    const callers = files
      .map((abs) => relative(REPO, abs).split(sep).join('/'))
      .filter((rel) => rel !== DEFINITION)
      .filter((rel) => /\bsaveImageInApp\s*\(/.test(stripComments(read(rel))));

    // Both directions. A NEW caller is the hazard; a STALE allowlist entry
    // quietly pre-approves whatever lands at that path next.
    expect(
      callers.sort(),
      'a file calls saveImageInApp that nobody reviewed for it. The function validates neither the filename nor the MIME type it hands the native MediaStore write, so the new caller must be checked for where its bytes, its filename and its MIME type come from — see scripts/security/data/mast-in-app-consumers.json.',
    ).toEqual(allowed.sort());
  });

  it('the one reviewed caller still goes through the sanitiser the containment argument names', () => {
    // If Scorecard.tsx stops calling scorecardFilename(), the allowlist above
    // still matches — one caller, the reviewed one — while the property that
    // made it safe is gone. The allowlist alone cannot see that.
    const src = stripComments(read('components/Scorecard.tsx'));
    expect(src).toMatch(/saveImageInApp\(\s*b\s*,\s*scorecardFilename\(/);
  });
});

// ===========================================================================
// C. pro_bridge_unknown_action_ignored
//
// The id's name overclaims, and the id stays: the owner's CI list names it.
// Nothing in this repo can assert that the SHIPPED Android app ignores an
// unknown action — there is no APK and no native source. What the check can
// verify, and what its describe and every title it emits now say, is that the
// DOCUMENTED contract ignores unknown actions: the Kotlin dispatch the app
// team is asked to copy out of IN-APP-BRIDGE.md §2 has two named branches and
// no catch-all, and lib/in-app.ts sends only those two names.
//
// Rewritten 2026-09-22 when the check was fixed. The audit pass had shown,
// live, that the check could not be trusted with its own property:
//
//   (1) It captured the `when` body with `\{([\s\S]*?)\n\s*\}` — non-greedy to
//       the first newline-then-brace. A multi-line branch truncated the capture
//       and an `else ->` after it was never seen. Under that mutation the check
//       printed a spurious low ("no longer dispatches saveImage") and PASSed;
//       the medium catch-all finding it exists for was gone.
//   (2) It matched `action:\s*'…'` — single-quoted literals — and Skipped only
//       when there were none. With one send changed to `action: ACTION_UP` it
//       reported "4 checked", no findings.
//   (3) Its describe said "the contract the app implements"; a title said the
//       contract "tells the app to handle". Neither is observable from here.
//
// These tests drive the REAL check, imported from
// scripts/security/checks/pro-bridge-contract.mjs, against copies of the two
// files it reads with one thing broken, and require the finding — or the
// Skip. The earlier version of this section kept a private brace-balanced
// parser and compared the check's regex against it; that proved the regex was
// wrong, not that the check was right. Now the check has the parser and this
// file has the mutations.
//
// Why a source-level assertion (C1) survives beside the check-level ones: the
// check's findings are `medium`, and tests/security-suite.test.ts blocks only
// on high and critical. C1 and C2 are what stop the build.
// ===========================================================================

const DOC = 'IN-APP-BRIDGE.md';
const KNOWN_ACTIONS = ['saveImage', 'upgrade'];
const BRIDGE_CHECKS = 'scripts/security/checks/pro-bridge-contract.mjs';

type BridgeFinding = { severity: string; title: string; detail: string; evidence: string; file: string | null; line: number | null };
type BridgeCheck = {
  id: string;
  describe: string;
  run: (ctx: { repoRoot: string }) => Promise<{ findings: BridgeFinding[]; checked: number }>;
};

const bridgeChecks: BridgeCheck[] = (await import(pathToFileURL(join(REPO, BRIDGE_CHECKS)).href)).default;
const unknownAction = bridgeChecks.find((c) => c.id === 'pro_bridge_unknown_action_ignored');
if (!unknownAction) throw new Error(`${BRIDGE_CHECKS} no longer exports pro_bridge_unknown_action_ignored — the owner's CI list names it`);
const runUnknownAction = (repoRoot: string) => unknownAction.run({ repoRoot });

/** One edit to one of the two files the check reads: a string or regex, and its replacement. */
type Edit = [rel: string, from: string | RegExp, to: string];

const mutantDirs: string[] = [];
afterAll(() => { for (const d of mutantDirs) rmSync(d, { recursive: true, force: true }); });

/**
 * A copy of the two files the check reads, with the edits applied. An edit
 * that changes nothing throws: a mutation test whose mutation stopped landing
 * is a green test that proves nothing, and a code snippet in a Markdown file
 * is exactly the kind of text that gets re-indented.
 */
function mutantTree(edits: Edit[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'ib-audit-7-bridge-'));
  mutantDirs.push(dir);
  for (const rel of [DEFINITION, DOC]) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), read(rel));
  }
  for (const [rel, from, to] of edits) {
    const p = join(dir, rel);
    const before = readFileSync(p, 'utf-8');
    const after = before.replace(from, to);
    if (after === before) throw new Error(`mutation target not found in ${rel}: ${String(from).slice(0, 60)} — this test is no longer mutating anything`);
    writeFileSync(p, after);
  }
  return dir;
}

/** The two branch lines as the document has them today, matched loosely so a re-indent of the snippet cannot blind the mutations. */
const UPGRADE_BRANCH = /"upgrade"\s*->\s*openUpgradeScreen\(msg\)[^\n]*/;
const SAVE_IMAGE_BRANCH = /("saveImage"\s*->\s*saveImage\(msg\)[^\n]*)/;

/** Every mutation this section grades, by name, so the last test can sweep all of their titles. */
const MUTANTS: Record<string, Edit[]> = {
  'a multi-line upgrade branch followed by else -> handleUnknown(msg)': [
    [DOC, UPGRADE_BRANCH, '"upgrade" -> {\n            val from = msg.optString("from")\n            openUpgradeScreen(msg)\n        }'],
    [DOC, SAVE_IMAGE_BRANCH, '$1\n        else -> handleUnknown(msg)'],
  ],
  'a one-line else -> handleUnknown(msg)': [[DOC, SAVE_IMAGE_BRANCH, '$1\n        else -> handleUnknown(msg)']],
  'an explicit no-op else -> {}': [[DOC, SAVE_IMAGE_BRANCH, '$1\n        else -> {}']],
  'a branch for an action §2 does not list': [[DOC, SAVE_IMAGE_BRANCH, '$1\n        "exportCsv" -> exportCsv(msg)']],
  'the saveImage branch removed': [[DOC, /[ \t]*"saveImage"\s*->\s*saveImage\(msg\)[^\n]*\n/, '']],
  'the upgrade send built from a constant': [[DEFINITION, "action: 'upgrade'", 'action: ACTION_UP']],
};

const CATCH_ALL = /does not ignore unknown actions/;

describe('pro_bridge_unknown_action_ignored — the documented contract, graded by the real check', () => {
  it('every action the page can put on the wire is a single-quoted literal from the contract', () => {
    // Source-level, over the real tree, and BLOCKING: this file runs inside
    // `npm run build`; the check's medium findings do not stop anything. A
    // computed action (`action: name`, `action: "x"`, a template) is how a
    // third capability reaches the native dispatch without ever appearing in
    // IN-APP-BRIDGE.md — see (2) in the header.
    for (const rel of [DEFINITION, 'components/InAppBridge.tsx']) {
      const code = stripComments(read(rel));
      const keys = [...code.matchAll(/\baction\s*:/g)];
      const literals = [...code.matchAll(/\baction\s*:\s*'([^']+)'/g)].map((m) => m[1]);
      expect(
        literals.length,
        `${rel} has ${keys.length} \`action:\` key(s) but ${literals.length} single-quoted literal(s) — the difference is a value nobody can grade against the contract`,
      ).toBe(keys.length);
      for (const a of literals) {
        expect(KNOWN_ACTIONS, `${rel} sends an action the contract does not define`).toContain(a);
      }
    }
    // And the page really does emit both, so the assertion above is not
    // passing over a file that emits nothing.
    const sent = [...stripComments(read(DEFINITION)).matchAll(/\baction\s*:\s*'([^']+)'/g)].map((m) => m[1]);
    expect(sent.sort()).toEqual([...KNOWN_ACTIONS].sort());
  });

  it("today's contract passes the check outright: two branches, no catch-all, five things looked at", async () => {
    // The property, on the real tree. This is the assertion that turns red
    // the day someone lands an `else ->` in IN-APP-BRIDGE.md — and it is red
    // at build time, which the check's own medium finding is not.
    const r = await runUnknownAction(REPO);
    expect(r.findings.map((f) => `[${f.severity}] ${f.title}`)).toEqual([]);
    // Two sends, two branches, one dispatch. Not "more than zero": a change
    // to the check's accounting should be a deliberate edit of this line.
    expect(r.checked).toBe(5);
  });

  it('a multi-line branch is read to its real closing brace, so the else -> after it is the finding and nothing spurious is', async () => {
    // (1) in the header, closed. The audit's live mutation: give the upgrade
    // branch a block body and put an `else ->` after the last branch. The old
    // regex stopped at the block's own `}`, graded a body containing only
    // "upgrade", and reported a low "no longer dispatches saveImage" — which
    // is the tell that the block was truncated, so its ABSENCE is asserted
    // here as well as the catch-all's presence.
    const r = await runUnknownAction(mutantTree(MUTANTS['a multi-line upgrade branch followed by else -> handleUnknown(msg)']));
    const titles = r.findings.map((f) => f.title);
    expect(
      titles.some((t) => /no branch for "saveImage"/.test(t)),
      'the truncated-parse tell is back: the check did not read past the multi-line branch',
    ).toBe(false);
    const catchAll = r.findings.filter((f) => CATCH_ALL.test(f.title));
    expect(catchAll, `the else -> after a multi-line branch was not reported; findings: ${titles.join(' | ') || '(none)'}`).toHaveLength(1);
    expect(catchAll[0].severity).toBe('medium');
    expect(catchAll[0].file).toBe(DOC);
    // The evidence shows the whole block: the branch AFTER the multi-line one
    // and the else, not a fragment ending at the first `}`.
    expect(catchAll[0].evidence).toContain('"saveImage" ->');
    expect(catchAll[0].evidence).toContain('else -> handleUnknown(msg)');
    expect(r.checked).toBe(5);
  });

  it('a contract that does not ignore unknown actions is a finding, whatever the else does', async () => {
    // A one-line else, and an else that is visibly a no-op. Without a Kotlin
    // parser the check cannot tell a no-op from a handler, so it reports both
    // and its remediation says to drop the branch: `else -> {}` is one edit
    // away from `else -> { handle(msg) }`, and nothing in the document would
    // flag the second edit.
    for (const name of ['a one-line else -> handleUnknown(msg)', 'an explicit no-op else -> {}']) {
      const r = await runUnknownAction(mutantTree(MUTANTS[name]));
      const catchAll = r.findings.filter((f) => CATCH_ALL.test(f.title));
      expect(catchAll, `${name}: not reported`).toHaveLength(1);
      expect(catchAll[0].severity).toBe('medium');
    }
  });

  it('a branch §2 does not list, and a send §2 lists with no branch, are each still the finding they were', async () => {
    // Both findings predate the fix. The parser they ran on changed, so they
    // are proved again against the new one rather than assumed to survive.
    {
      const r = await runUnknownAction(mutantTree(MUTANTS['a branch for an action §2 does not list']));
      const f = r.findings.filter((x) => /does not list \("exportCsv"\)/.test(x.title));
      expect(f).toHaveLength(1);
      expect(f[0].severity).toBe('medium');
      expect(r.checked).toBe(6);
    }
    {
      const r = await runUnknownAction(mutantTree(MUTANTS['the saveImage branch removed']));
      const f = r.findings.filter((x) => /no branch for "saveImage"/.test(x.title));
      expect(f).toHaveLength(1);
      expect(f[0].severity).toBe('low');
      // A missing branch is not a catch-all. The two findings must stay apart
      // or the low one starts to look like the medium one it used to hide.
      expect(r.findings.filter((x) => CATCH_ALL.test(x.title))).toHaveLength(0);
    }
  });

  it('a send built from anything but a literal is a finding that names the real line', async () => {
    // (2) in the header, closed in the check itself; the first test above
    // closes it at build time. The line number is asserted because it was
    // wrong: the check strips comments before matching and mapped the
    // stripped index back onto the UNstripped file, so the evidence for this
    // send said line 77 when the send is on line 213.
    const dir = mutantTree(MUTANTS['the upgrade send built from a constant']);
    const r = await runUnknownAction(dir);
    const f = r.findings.filter((x) => /cannot tell what it sends/.test(x.title));
    expect(f, `a computed action went unreported; findings: ${r.findings.map((x) => x.title).join(' | ') || '(none)'}`).toHaveLength(1);
    expect(f[0].severity).toBe('medium');
    expect(f[0].file).toBe(DEFINITION);
    const realLine = readFileSync(join(dir, DEFINITION), 'utf-8').split('\n').findIndex((l) => l.includes('action: ACTION_UP')) + 1;
    expect(realLine).toBeGreaterThan(0);
    expect(f[0].line, 'the evidence line is not the line the send is on').toBe(realLine);
    expect(f[0].evidence).toContain(`${DEFINITION}:${realLine}: `);
    // The literal send that is still there is not reported alongside it.
    expect(r.findings).toHaveLength(1);
  });

  it('a dispatch it cannot find, or cannot find the end of, is a Skip and never a pass', async () => {
    // Rule 1 of the harness. The brace-balanced parser has a second way to
    // come up short — a `{` with no matching `}` — and it must not grade the
    // fragment it did read: a fragment is exactly what the old regex graded.
    await expect(runUnknownAction(mutantTree([[DOC, 'msg.optString("action")', 'msg.optString("kind")']])))
      .rejects.toMatchObject({ isSkip: true, message: expect.stringMatching(/has no when\(msg\.optString\("action"\)\)/) });
    await expect(runUnknownAction(mutantTree([[DOC, /\}/g, '']])))
      .rejects.toMatchObject({ isSkip: true, message: expect.stringMatching(/never closes/) });
  });

  it('an else -> or a quoted label inside a Kotlin comment is prose, not a branch', async () => {
    // The other direction. A guard that matches its own explanatory comment
    // has shipped twice in this repo. Two shapes, guarded by two different
    // things: `// no else ->` is kept out by the else regex being anchored to
    // the start of a line, and `// "legacy" ->` is kept out only because the
    // check strips Kotlin comments from the dispatch body before it looks for
    // branches — without that strip it reports an undocumented "legacy"
    // branch. The first mutation pass found this test green with the strip
    // removed, which is how the second line got here.
    const r = await runUnknownAction(mutantTree([[DOC, SAVE_IMAGE_BRANCH, [
      '$1',
      '        // no else -> branch here, on purpose: an unknown action is ignored',
      '        // "legacy" -> removed 2026-09; do not put it back',
    ].join('\n')]]));
    expect(r.findings.map((f) => f.title)).toEqual([]);
  });

  it('the describe and every title say what was verified — the document — and never what the app does', async () => {
    // (3) in the header, pinned. The id cannot change (the owner's CI list),
    // so the words under it carry the scope: "the documented contract", "the
    // page", never "the app implements/ignores/handles".
    expect(unknownAction.describe).toContain('the documented contract ignores unknown actions');
    expect(unknownAction.describe).toMatch(/no APK or Android source/);
    const overclaim = /\bthe (shipped )?app (implements|ignores|drops|handles|accepts|will)\b|tells the app to/i;
    expect(unknownAction.describe).not.toMatch(overclaim);

    const titles: string[] = [];
    for (const edits of Object.values(MUTANTS)) {
      const r = await runUnknownAction(mutantTree(edits));
      titles.push(...r.findings.map((f) => f.title));
    }
    expect(titles.length, 'the sweep collected no titles — the mutants above stopped producing findings').toBeGreaterThanOrEqual(6);
    for (const t of titles) {
      expect(t, `overclaims the app: ${t}`).not.toMatch(overclaim);
      expect(t, `does not say which side it verified: ${t}`).toMatch(/^The (page|documented (contract|dispatch))\b/);
    }
  });
});
