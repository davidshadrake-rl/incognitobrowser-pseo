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
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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
// The id's name overclaims: nothing in this repo can assert that the shipped
// Android app ignores an unknown action. The check's own describe is honest
// about grading the web side and the contract text, and no finding it emits
// claims otherwise, so the audit's substantive criticism is about the NAME.
//
// What the check does grade is real, and it has two blind spots that a rename
// would not fix. Both are closed here.
// ===========================================================================

const DOC = 'IN-APP-BRIDGE.md';
const KNOWN_ACTIONS = ['saveImage', 'upgrade'];

/** The `when (…) { … }` body, brace-balanced rather than regex-guessed. */
function balancedWhenBody(doc: string): { body: string; open: number } {
  const m = /when\s*\(\s*msg\.optString\("action"\)\s*\)\s*\{/.exec(doc);
  if (!m) throw new Error(`${DOC} has no when(msg.optString("action")) { block`);
  const open = m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < doc.length; i++) {
    if (doc[i] === '{') depth++;
    else if (doc[i] === '}') {
      depth--;
      if (depth === 0) return { body: doc.slice(open + 1, i), open };
    }
  }
  throw new Error(`${DOC}: the when block never closes`);
}

describe('pro_bridge_unknown_action_ignored — the two blind spots in the check', () => {
  it('every action the page can put on the wire is a literal from the contract', () => {
    // BLIND SPOT 1. The check matches `action:\s*'([^']+)'` — single-quoted
    // literals only. `action: name`, `action: "x"` or a template literal is
    // invisible to it, and a file with one literal plus one computed value
    // still passes: the Skip only fires when there are NO literals at all.
    // A computed action is precisely how a third capability reaches the native
    // dispatch without ever appearing in IN-APP-BRIDGE.md.
    for (const rel of [DEFINITION, 'components/InAppBridge.tsx']) {
      const code = stripComments(read(rel));
      const keys = [...code.matchAll(/\baction\s*:/g)];
      const literals = [...code.matchAll(/\baction\s*:\s*'([^']+)'/g)].map((m) => m[1]);
      expect(
        literals.length,
        `${rel} has ${keys.length} \`action:\` key(s) but ${literals.length} single-quoted literal(s) — the difference is a value the CI check cannot see`,
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

  it("the check's non-greedy when-capture still sees the whole dispatch block", () => {
    // BLIND SPOT 2, and the dangerous one. The check captures the `when` body
    // with `\{([\s\S]*?)\n\s*\}` — non-greedy to the FIRST newline-then-brace.
    // Every branch in the contract is a single line today, so that happens to
    // be the real closing brace. Give one branch a multi-line body and the
    // capture stops early: the check then grades a truncated block, and any
    // `else ->` after it becomes invisible. It would report "ok, 0 findings"
    // about the exact catch-all it exists to catch.
    const doc = read(DOC);
    const naive = /when\s*\(\s*msg\.optString\("action"\)\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(doc);
    expect(naive, `${DOC}: the dispatch snippet the CI check greps is gone`).not.toBeNull();
    const balanced = balancedWhenBody(doc);

    expect(
      naive![1].trim(),
      'the CI check\'s non-greedy capture no longer matches the real brace-balanced block: it is grading a truncated dispatch and can no longer see a trailing `else ->`. Fix the check\'s regex before landing a multi-line branch in the contract.',
    ).toBe(balanced.body.trim());

    // And, over the balanced body rather than the naive one: the two branches,
    // and no catch-all. addWebMessageListener injects the bridge into every
    // page on an allowed origin, so anything that gets script onto that host
    // can post arbitrary JSON at this dispatch. With only named branches an
    // unknown action is ignored by construction; an `else ->` makes whatever
    // it does reachable from any such page.
    expect([...balanced.body.matchAll(/"([^"]+)"\s*->/g)].map((m) => m[1])).toEqual(['upgrade', 'saveImage']);
    expect(balanced.body).not.toMatch(/(^|\n)\s*else\s*->/);
  });

  it('the contract and the page agree on the action set, in both directions', () => {
    // A branch the page never sends is a native capability with no caller; an
    // action the page sends with no branch is a handoff that silently drops.
    const balanced = balancedWhenBody(read(DOC));
    const branches = [...balanced.body.matchAll(/"([^"]+)"\s*->/g)].map((m) => m[1]).sort();
    const sent = [...stripComments(read(DEFINITION)).matchAll(/\baction\s*:\s*'([^']+)'/g)].map((m) => m[1]).sort();
    expect(branches).toEqual(sent);
  });
});
