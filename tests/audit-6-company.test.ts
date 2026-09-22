/**
 * Audit group 6 — the COMPANY-DEPLOYMENT requirements (gaps G1, G4, G5).
 *
 * These are the owner's own cutover conditions, and they share a shape that
 * makes them easy to fake coverage for: none of them can be fixed by a line of
 * TypeScript. "Put a VPN in front of it", "take WordPress off the machine",
 * "keep an audit log of scan targets" are all statements about a box this repo
 * does not own. The temptation is therefore to write a check that RECITES the
 * requirement and call the requirement covered. Reciting is not grading.
 *
 * What is actually assertable from here, and what this file asserts:
 *
 *   G1  scripts/security/checks/pro-deploy-host.mjs's `pro_vhost_noindex_but_no_login`
 *       is the only thing standing between "there is a gate" and "there is no
 *       gate". Its whole value is the classification: which live responses it
 *       calls GATED and which it calls OPEN, and how hard it grades OPEN once
 *       the target is a company host. That classifier is pure logic over an
 *       HTTP response, and ctx.http is a plain function on the context object,
 *       so it can be driven offline against crafted responses. This file does
 *       exactly that — five scenarios, no network, no droplet.
 *
 *       The two limitations of G1 that this file used to disclaim — the check
 *       is an in-band prober that cannot see a VPN or IP allowlist from inside
 *       the perimeter, and `confHasAuth` was computed and only narrated — are
 *       now source changes (IB_PROBE_VANTAGE, and a repo-wide auth scan that
 *       escalates). tests/pro-deploy-host.test.ts pins every cell of that
 *       grade matrix; the G1 scenarios here grade the classifier alone, from
 *       an EMPTY repo root so that the day a cutover conf lands in the repo is
 *       not the day these go red.
 *
 *   G4  half two, WordPress off the MACHINE, is `wp_not_on_pro_machine` in the
 *       same file, driven with a fake ssh in tests/pro-deploy-host.test.ts.
 *
 *   G5  the negative half — "never log cookie values or pasted cookie strings" —
 *       has no regression guard anywhere else in tests/. It is the half that
 *       cannot announce itself when it breaks: a `console.log` added during a
 *       debugging session puts every visitor's pasted cookie jar into journald
 *       and nothing fails, nothing 500s, no visitor can tell. So: every log
 *       sink in the request path is enumerated and its arguments are read —
 *       and, because an argument scan is defeated by one alias, the three
 *       files that HOLD raw material are held to zero sinks of any kind.
 *
 *       The positive half — keep an audit log of what the server fetched — is
 *       cnast-api-log-no-ip's new grade, driven here with a fake droplet.
 *
 * THREE HOUSE RULES THIS FILE OBEYS, each earned the hard way in this repo.
 *
 *   1. A GUARD MUST NOT MATCH ITS OWN EXPLANATORY COMMENT. That has shipped
 *      here twice. It is not hypothetical for this file either:
 *      CookieAnalyzerTool.tsx contains the string `document.cookie` TWICE, and
 *      one of them is the comment explaining what document.cookie does. A
 *      guard that counted raw occurrences would read 2, "prove" a second
 *      unaccounted-for read of the cookie jar, and be silenced by whoever
 *      next tried to understand it. Every source assertion below runs on
 *      comment-stripped text.
 *
 *   2. A CHECK THAT INSPECTED NOTHING HAS PROVED NOTHING. Every source scan
 *      here asserts a non-zero count of things it actually looked at before it
 *      asserts anything about them, so a refactor that moves a file cannot turn
 *      this suite green by emptying it. Same for the G1 scenarios: each asserts
 *      the check's own `checked` counter is non-zero.
 *
 *   3. A GUARD BOUND TO A SPELLING IS NOT A GUARD. The first version of the
 *      result-bus test asserted the headline did not contain `c.value`; the
 *      verifier appended `cookies.map((ck) => ck.value).join(', ')` and it
 *      passed. The console-sink scan likewise passed
 *      `const jar = rawSetCookies; console.warn(JSON.stringify(jar))`. Where a
 *      behaviour can be RUN, it is run: the report builder is called with
 *      sentinel values and the whole result is searched for them. Where it
 *      cannot, the rule is a count of zero, which no alias can satisfy.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync, readdirSync, statSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cookieListReport, parseCookieList } from '../components/tools/CookieAnalyzerTool';

const REPO = join(__dirname, '..');
const src = (p: string) => readFileSync(join(REPO, p), 'utf-8');

/**
 * Remove comments before asserting on source text. See house rule 1.
 *
 * LINE-PRESERVING. A block comment is replaced by its own newlines, not by a
 * single '\n', so an offset into the stripped text lands on the same line
 * number as in the original. The first version collapsed comments, and the
 * verifier's planted leak at lib/rate-limit.ts:258 was reported as :179 — a
 * line holding `void backend;`. A failure message that sends the reader to
 * the wrong line is one they stop trusting.
 *
 * The `[^:"'\`\\]` guard in front of `//` keeps a URL inside a string literal
 * ("https://example.com") from eating the rest of its line — a naive stripper
 * deletes real code there and a guard then "passes" over text that is not what
 * the file says.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ''))
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1');
}

/**
 * The text between the parentheses of a call whose `(` is at `openIdx`.
 *
 * Not string-aware on purpose. With comments already gone, the only way this
 * mis-reads is by capturing MORE text than the real argument list — which can
 * only make the forbidden-token scan below fire more readily, never less. A
 * guard is allowed to err toward noticing.
 */
function callArgs(text: string, openIdx: number): string {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return text.slice(openIdx + 1, i);
    }
  }
  return text.slice(openIdx + 1);
}

type Site = { rel: string; line: number; call: string; args: string };

/** Every console sink in comment-stripped source, with its argument text and its ORIGINAL line. */
function logSites(stripped: string, rel: string): Site[] {
  const out: Site[] = [];
  const re = /\bconsole\.(log|info|warn|error|debug|trace|dir|table)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped))) {
    const openIdx = m.index + m[0].length - 1;
    out.push({
      rel,
      line: stripped.slice(0, m.index).split('\n').length,
      call: `console.${m[1]}`,
      args: callArgs(stripped, openIdx),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Harness shared by the offline check runs
// ---------------------------------------------------------------------------

const CHECKS_DIR = join(REPO, 'scripts', 'security', 'checks');
const deployHostMod = await import(pathToFileURL(join(CHECKS_DIR, 'pro-deploy-host.mjs')).href);
const apiLogMod = await import(pathToFileURL(join(CHECKS_DIR, 'cnast-api-log-no-ip.mjs')).href);
const harness = await import(pathToFileURL(join(REPO, 'scripts', 'security', 'lib', 'harness.mjs')).href);
/** The real Skip class, so `isSkip` propagates exactly as the runner sees it. */
const SkipCtor = harness.Skip as new (reason: string) => Error & { isSkip: true };

type Finding = { severity: string; title: string; detail: string; evidence: string; remediation: string; file: string | null; line: number | null };
type CheckDef = {
  id: string;
  severity: string;
  cadence: string;
  run: (ctx: unknown) => Promise<{ findings: Finding[]; checked: number }>;
};

const ENV_KEYS = ['IB_DEPLOY_TARGET', 'IB_COMPANY_HOST', 'IB_PROBE_VANTAGE'] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;

/**
 * Run `fn` with exactly these env keys set (the others deleted), then put all
 * three back. The gate check reads all three; a developer's shell exporting
 * any of them must not change what a scenario sees.
 */
async function withEnv<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  const saved = ENV_KEYS.map((k) => [k, Object.prototype.hasOwnProperty.call(process.env, k), process.env[k]] as const);
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, had, prev] of saved) {
      if (had) process.env[k] = prev;
      else delete process.env[k];
    }
  }
}

const tempDirs: string[] = [];
/** A throwaway repo root holding exactly these files. */
function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ib-audit-6-'));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

const COMPANY = 'https://privacy-tools.example-corp.internal';
const DEMO = 'https://206-189-186-34.nip.io';

// ===========================================================================
// G1 — "a real gate in front of BOTH /resources-pro AND /api"
// ===========================================================================

const gateCheck = (deployHostMod.default as CheckDef[]).find((c) => c.id === 'pro_vhost_noindex_but_no_login');

/** A crafted response in the shape ctx.http returns. */
type Stub = { status: number; headers?: Record<string, string>; text?: string };

/**
 * A context whose `http` answers from a table instead of the network.
 *
 * An unstubbed URL THROWS rather than returning a miss. If the check grows a
 * third probe, this file must be told about it — a silent empty answer would
 * let a new, ungraded surface slip in behind a green test.
 *
 * `repoRoot` is an EMPTY directory, on purpose: the check now scans the repo
 * for auth directives and escalates on their absence, and these scenarios
 * grade the classifier, not the repo. The repo-side grade has its own tests.
 */
const EMPTY_REPO = repoWith({ 'README.md': 'nothing config-shaped here\n' });
function fakeCtx(origin: string, routes: Record<string, Stub>) {
  return {
    repoRoot: EMPTY_REPO,
    origin,
    freeBase: `${origin}/resources`,
    proBase: `${origin}/resources-pro`,
    apiBase: `${origin}/api`,
    Skip: SkipCtor,
    http: async (url: string) => {
      const r = routes[url];
      if (!r) throw new Error(`the check probed an unstubbed URL: ${url}`);
      return { ok: true, status: r.status, headers: new Headers(r.headers || {}), text: r.text || '', json: null, url };
    },
  };
}

/** Run the check with the target pinned and no vantage declared, then put the environment back. */
async function runGate(target: 'company' | 'demo', origin: string, routes: Record<string, Stub>) {
  return withEnv({ IB_DEPLOY_TARGET: target }, () => gateCheck!.run(fakeCtx(origin, routes)));
}

const routesFor = (origin: string, page: Stub, api: Stub) => ({
  [`${origin}/resources-pro/tools/`]: page,
  [`${origin}/api/ip`]: api,
});

/** What a correctly gated deployment looks like on the wire. */
const SSO_REDIRECT: Stub = { status: 302, headers: { location: 'https://sso.example-corp.internal/oauth2/start?rd=%2F' } };
const API_401: Stub = { status: 401, headers: { 'www-authenticate': 'Bearer realm="corp"' } };
/** What this droplet looks like today: everything answers everyone. */
const PAGE_OPEN: Stub = { status: 200, headers: { 'x-robots-tag': 'noindex, nofollow' }, text: '<html>Pro tools</html>' };
const API_OPEN: Stub = { status: 405, headers: { allow: 'POST, OPTIONS' } };

describe('G1 — the gate check tells a gated company deployment from an open one', () => {
  it('the check still exists, is deploy-relevant, and is not something else now', () => {
    // Loaded by id out of the array default export rather than by position:
    // this file must not start grading a different check because someone
    // reordered CHECKS at the bottom of pro-deploy-host.mjs.
    expect(gateCheck, 'pro_vhost_noindex_but_no_login is gone from scripts/security/checks/pro-deploy-host.mjs').toBeTruthy();
    expect(gateCheck!.severity).toBe('critical');
    expect(gateCheck!.cadence).toBe('nightly');
  });

  it('an SSO gate in front of both surfaces is recognised as a gate, not reported as "no authentication at all"', async () => {
    // The shape that matters. oauth2-proxy / OIDC in front of a vhost is much
    // the commonest way a box like this gets protected — far commoner than
    // Basic auth — and it answers 302 to the SSO host, not 401. An earlier
    // version of this check read `status >= 200 && status < 400` as open, so
    // against a CORRECTLY gated host it reported "no authentication at all" at
    // critical: red exactly when its own remediation had been applied, which
    // is how a check gets switched off. redirectLeavesHost() is the fix and
    // this is the case that holds it in place.
    const r = await runGate('company', COMPANY, routesFor(COMPANY, SSO_REDIRECT, API_401));
    expect(r.findings.map((f) => `[${f.severity}] ${f.title}`)).toEqual([]);
    // And it did so having looked at something. "0 findings over 0 items" is
    // the pass this suite exists to refuse.
    expect(r.checked, 'the check reported a clean gated verdict without inspecting anything').toBeGreaterThan(0);
  }, 20_000);

  it('an open COMPANY deployment is one critical finding that names both surfaces', async () => {
    const r = await runGate('company', COMPANY, routesFor(COMPANY, PAGE_OPEN, API_OPEN));
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.severity, 'an unauthenticated Pro surface on a company host is not a medium').toBe('critical');
    // The owner's requirement is a conjunction: the gate has to be in front of
    // the pages AND the API. A finding that named only one of them would let
    // half the job read as done.
    expect(f.detail).toContain('/resources-pro');
    expect(f.detail).toContain('/api');
    // And it must not offer the client-side Pro flag as the answer. That flag
    // is document.documentElement.hasAttribute('data-ib-pro') — a product gate
    // for three UI actions, never an authentication boundary.
    expect(f.detail).toContain('data-ib-pro');
    // Evidence has to be re-checkable by hand: the two URLs actually probed.
    expect(f.evidence).toContain(`${COMPANY}/resources-pro/tools/`);
    expect(f.evidence).toContain(`${COMPANY}/api/ip`);
    expect(r.checked).toBeGreaterThan(0);
  }, 20_000);

  it('the same open responses on the public demo are graded medium, not critical', async () => {
    // Target-awareness is what keeps this check readable. The demo droplet is
    // open on purpose; graded critical every night it would be permanent red
    // and nobody would look. Pinning both grades means neither can quietly
    // collapse into the other — an always-critical check and an always-medium
    // one are both useless, in opposite directions.
    const r = await runGate('demo', DEMO, routesFor(DEMO, PAGE_OPEN, API_OPEN));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('medium');
    expect(r.findings[0].detail, 'the demo grade must still carry the cutover requirement').toContain('DEPLOY REQUIREMENT');
  }, 20_000);

  it('a gate on the pages alone is not enough: an open /api behind a gated vhost still reports', async () => {
    // This is the exact half-fix the requirement is worded against. Someone
    // puts oauth2-proxy on /resources-pro, the pages stop answering strangers,
    // and /api/scan-url is still a free SSRF primitive with the server's own
    // network position. If this check were an AND rather than an OR it would
    // go green on that.
    const r = await runGate('company', COMPANY, routesFor(COMPANY, SSO_REDIRECT, API_OPEN));
    expect(r.findings, 'a gated vhost with an open /api behind it reported nothing').toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
  }, 20_000);

  it('a gate on /api alone is not enough either: the open Pro surface still reports', async () => {
    const r = await runGate('company', COMPANY, routesFor(COMPANY, PAGE_OPEN, API_401));
    expect(r.findings, 'an open Pro surface in front of a gated API reported nothing').toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
  }, 20_000);
});

// ===========================================================================
// G5 — "never log cookie values or pasted cookie strings"
// ===========================================================================

/** Every .ts/.tsx under a tree, skipping nothing that ships. */
function walkSources(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue;
      walkSources(abs, acc);
    } else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) {
      acc.push(abs);
    }
  }
  return acc;
}

/**
 * Identifiers that, appearing inside a log sink's argument list, mean a cookie
 * value or a raw request body is about to be written somewhere durable.
 *
 * `cookie` is matched case-insensitively and deliberately bluntly: every
 * variable in this codebase that holds cookie material has "cookie" in its
 * name, and a false positive here costs one line of thought while a false
 * negative costs the privacy claim the whole product is sold on.
 *
 * Known limit, and why it is tolerable: this is an ARGUMENT scan, and one
 * alias (`const jar = rawSetCookies`) walks past it. That is why the files
 * where raw material actually lives are held to ZERO sinks below — a count
 * of zero has no spelling to evade.
 */
const COOKIE_MATERIAL = [/cookie/i, /\bcustomInput\b/, /\bsetCookies\b/];
/**
 * A raw body is cookie material too, transitively: /event and /scan-url both
 * read a caller-supplied body, and the cookie tool's paste box is one POST
 * away from being in it if anyone ever decides to send it.
 */
const BODY_MATERIAL = [/\brequest\.text\s*\(/, /\breq\.text\s*\(/, /\bbody\.text\b/, /\brawBody\b/, /\brequestBody\b/, /readCappedRequestText/];

/**
 * The files that HOLD raw material, and the export that proves each is the
 * real file rather than a stub left at the path.
 *
 *   lib/scanner.ts        rawSetCookiesAll / rawSetCookies / setCookieLines —
 *                         every Set-Cookie header of every site anyone scans
 *   lib/request-body.ts   the capped body reader every POST route goes through
 *   lib/net-address.ts    the resolved addresses of every scan target
 */
const RAW_MATERIAL_FILES: Array<[rel: string, marker: string]> = [
  ['lib/scanner.ts', 'export function analyzeScan'],
  ['lib/request-body.ts', 'export async function readCappedRequestText'],
  ['lib/net-address.ts', 'export function isPublicUnicastAddress'],
];

const SCAN_ROUTE = 'app/scan-url/route.ts';

describe('G5 — no log sink in the request path is ever handed cookie material', () => {
  // Every place the running service can write a line someone later reads:
  // app/ is the API routes, lib/ is what they call, components/ is what runs
  // in the visitor's browser (where a console.log is visible to any script on
  // the page and to anyone looking over a shoulder).
  const files = [
    ...walkSources(join(REPO, 'app')),
    ...walkSources(join(REPO, 'lib')),
    ...walkSources(join(REPO, 'components')),
  ];

  const rawByRel = new Map<string, string>();
  const sites: Site[] = [];
  for (const abs of files) {
    const rel = abs.slice(REPO.length + 1);
    const raw = readFileSync(abs, 'utf-8');
    rawByRel.set(rel, raw);
    sites.push(...logSites(stripComments(raw), rel));
  }

  it('there are log sinks to inspect at all', () => {
    // Without this, deleting every console call — or breaking the scanner —
    // would make the assertion below pass over an empty list, which is the
    // "0 findings over 0 items" pass the security harness refuses by design.
    expect(files.length, 'the source walk found no TypeScript under app/, lib/ or components/').toBeGreaterThan(50);
    expect(sites.length, 'no console call sites were found — the scanner is broken, not the code clean').toBeGreaterThanOrEqual(5);
  });

  it('reports line numbers of the ORIGINAL file, not of the comment-stripped text', () => {
    // A crafted file with a three-line block comment above the sink. A
    // collapsing stripper reports line 4; the file says line 6.
    const crafted = ['/* one', ' * two', ' */', 'const a = 1; // three', '', 'console.log(a);'].join('\n');
    const found = logSites(stripComments(crafted), 'crafted.ts');
    expect(found).toHaveLength(1);
    expect(found[0].line, 'the sink is on line 6 of the crafted file').toBe(6);
    // And on the real tree: the line each site names, read out of the RAW
    // file, holds that call. Every site, not a sample.
    for (const s of sites) {
      const rawLine = (rawByRel.get(s.rel) || '').split('\n')[s.line - 1] ?? '';
      expect(rawLine, `${s.rel}:${s.line} does not hold ${s.call} — the reported line is wrong`).toContain(s.call);
    }
  });

  it('no console call anywhere writes a cookie value or a raw request body', () => {
    // The concrete failure this guards: api.log deliberately omits the client
    // address (API-ON-DROPLET.md:216, graded by cnast-api-log-no-ip), so the
    // Apache side of the promise is held. journald is the side with nothing in
    // front of it — one console.error(body) in a route and every scan's POST
    // body, pasted cookie jars included, is on disk on a box that also serves
    // someone else's WordPress. Nothing breaks, nothing 500s, no visitor can
    // tell, and the first anyone would know is whenever somebody next reads
    // the journal.
    const bad = sites.filter((s) => [...COOKIE_MATERIAL, ...BODY_MATERIAL].some((re) => re.test(s.args)));
    expect(
      bad.map((s) => `${s.rel}:${s.line} ${s.call}(${s.args.replace(/\s+/g, ' ').slice(0, 140)})`),
      'a log sink is being handed cookie material or a raw request body',
    ).toEqual([]);
  });

  it('the three files that hold raw material have no console sink at all — a rule about zero has no spelling to evade', () => {
    // The verifier's evasion, verbatim: in lib/scanner.ts, right after
    // `const rawSetCookies = rawSetCookiesAll.slice(0, MAX_COOKIES)`,
    //   const jar = rawSetCookies; console.warn(`scan debug: ${JSON.stringify(jar)}`);
    // — every Set-Cookie value of every scanned site into journald — and the
    // argument scan above passed, because the argument text says `jar`. The
    // scanner is where cookie material actually lives and it is the natural
    // place for a debugging line to land. So these three files are held to
    // NO console reference of any kind: not a call, not a property access,
    // nothing. There are none today, and the rule costs nothing to keep.
    for (const [rel, marker] of RAW_MATERIAL_FILES) {
      const raw = rawByRel.get(rel);
      expect(raw, `${rel} is missing from the source walk`).toBeTruthy();
      // The real file, not a stub at that path: it exports what the routes
      // import, and it is not trivially small.
      expect(raw!, `${rel} no longer contains ${marker} — is this the real file?`).toContain(marker);
      expect(raw!.length, `${rel} is suspiciously small`).toBeGreaterThan(2_000);
      const stripped = stripComments(raw!);
      expect(logSites(stripped, rel).map((s) => `${s.rel}:${s.line} ${s.call}(${s.args.replace(/\s+/g, ' ').slice(0, 120)})`), `a console sink appeared in ${rel}`).toEqual([]);
      expect((stripped.match(/\bconsole\b/g) || []).length, `${rel} references console at all`).toBe(0);
    }
  });

  it('EVERY log line on the scan path carries the error TYPE, and none carries the target, the response, the body or the caller', () => {
    // app/scan-url/route.ts is the only route that fetches a caller-named URL
    // and parses Set-Cookie out of what comes back, so it is the one whose
    // log lines are worth reading by hand rather than by pattern.
    //
    // ALL of them. The first version did `sites.find(...)`, which graded the
    // first console call in the file: a second log line added ABOVE it would
    // silently have become the one graded and the original would have
    // stopped being checked. Two guards now: the count is a tripwire (a new
    // line fails here before anyone has to reason about whether it is safe),
    // and the loop grades every line anyway, so loosening the count cannot
    // by itself let one through.
    const route = stripComments(src(SCAN_ROUTE));
    expect(route).toContain('const errorType = err instanceof Error ? err.constructor.name');
    const routeSites = sites.filter((s) => s.rel === SCAN_ROUTE);
    expect(routeSites.length, 'the scan route logs nowhere, or somewhere new — read the new line before changing this number').toBe(1);
    expect(routeSites.some((s) => s.args.includes('errorType')), 'the catch-block log line no longer carries the error type').toBe(true);
    // `result`, `html` and `response` are, respectively, the parsed cookie
    // list, the target's page source and the upstream response object.
    // `targetUrl` / `parsedUrl` are the target; `clientIP` / `bucket` are the
    // caller and the caller's /24 — the address api.log omits on purpose, and
    // journald is the other place it could land.
    const FORBIDDEN = ['result', 'html', 'response', 'targetUrl', 'parsedUrl', 'clientIP', 'bucket', 'body', 'headers'];
    for (const site of routeSites) {
      for (const forbidden of FORBIDDEN) {
        expect(site.args, `${SCAN_ROUTE}:${site.line} ${site.call}(…) now interpolates ${forbidden}`).not.toContain(forbidden);
      }
    }
  });
});

describe('G5 — the cookie analyzer keeps pasted cookies and document.cookie in the browser', () => {
  const raw = src('components/tools/CookieAnalyzerTool.tsx');
  const tool = stripComments(raw);
  const count = (re: RegExp) => (tool.match(re) || []).length;

  it('the file being graded is the real one', () => {
    expect(raw.length, 'CookieAnalyzerTool.tsx is empty or missing').toBeGreaterThan(5_000);
    expect(tool).toContain('export function parseCookieList');
  });

  it('has no outbound or logging sink of any kind', () => {
    // The tool's three modes are "scan a URL", "this page" and "paste". Two of
    // them handle cookie material that belongs to the VISITOR — their own
    // browser jar, and whatever they pasted out of DevTools, which on a
    // logged-in site is a set of live session tokens. The only safe design is
    // that those two modes have nowhere to send it, so the absence of a sink
    // is the control, and this is the assertion that keeps it absent.
    expect(count(/\bconsole\./g), 'a console call appeared in the cookie analyzer').toBe(0);
    expect(count(/sendBeacon/g), 'the cookie analyzer now beacons').toBe(0);
    expect(count(/\btrack\s*\(/g), 'the cookie analyzer now sends an analytics event').toBe(0);
    expect(count(/\bfetch\s*\(/g), 'the cookie analyzer now makes its own fetch').toBe(0);
    expect(count(/localStorage|sessionStorage|indexedDB/g), 'the cookie analyzer now persists to browser storage').toBe(0);
  });

  it('reads document.cookie exactly once, straight into the local parser', () => {
    // House rule 1, live: the raw file contains "document.cookie" TWICE and
    // one of them is the comment explaining what it does. A count on
    // unstripped text reads 2 and invents a second read that is not there.
    // Assert on the stripped text, and assert the count, so a NEW read added
    // anywhere in the file is a failure rather than a shrug.
    expect((raw.match(/document\.cookie/g) || []).length, 'the fixture assumption changed').toBe(2);
    expect(count(/document\.cookie/g)).toBe(1);
    expect(tool).toContain('setCookies(parseCookieList(document.cookie))');
  });

  it('the pasted textarea contents reach the parser, the state setter and the input value — nothing else', () => {
    // `customInput` is the paste box. Every appearance of it is enumerated
    // here by the expression it sits in, so adding a fifth one — a fetch body,
    // a track() prop, a URL query parameter — fails this test by count before
    // anyone has to reason about whether the new one is safe.
    const uses = [...tool.matchAll(/[^\n]*\bcustomInput\b[^\n]*/g)].map((m) => m[0].trim());
    expect(uses.length, 'the paste box is gone, or the scan missed it').toBe(4);
    expect(uses).toEqual([
      "const [customInput, setCustomInput] = useState('');",
      'if (!customInput.trim()) return;',
      'setCookies(parseCookieList(customInput));',
      'value={customInput}',
    ]);
  });

  it('the only thing the tool sends to the server is the URL the visitor typed', () => {
    // Mode three really does call the API. It must carry urlInput and nothing
    // adjacent to it: the cookie state, the paste box and document.cookie all
    // live in the same component and are one careless argument away.
    const calls = [...tool.matchAll(/\bscanUrl\s*</g)];
    expect(calls.length, 'the cookie analyzer no longer calls scanUrl, or calls it more than once').toBe(1);
    expect(tool).toContain('await scanUrl<URLScanResult>(urlInput.trim(), setScanStatus)');
    // The scanURL function body, from its declaration to the next top-level
    // `const` in the component. Bounded by a forward search rather than by a
    // named end marker: `const tracking = cookies.filter` occurs twice in this
    // file and the FIRST one is above scanURL, which silently produced an
    // empty slice — a "no forbidden identifier found" pass over zero bytes.
    const start = tool.indexOf('const scanURL = async');
    expect(start, 'the scanURL function is gone').toBeGreaterThan(-1);
    const end = tool.indexOf('\n  const ', start + 1);
    const outbound = tool.slice(start, end > start ? end : undefined);
    expect(outbound.length, 'the outbound slice is empty, so the assertions below would prove nothing').toBeGreaterThan(200);
    for (const forbidden of ['customInput', 'document.cookie', 'cookies']) {
      expect(outbound, `the outbound path now touches ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('the result bus carries counts and a score, never a cookie value — proven by running the report builder', () => {
    // The one thing that DOES leave this component is the ToolResult handed
    // to the shared result bus: ResultCard renders its headline, and puts the
    // headline and stats into the share text and the scorecard image — the
    // things a visitor sends to other people. So the builder is RUN, with
    // cookie values no real cookie could have, and the whole result is
    // searched for them. House rule 3: the first version of this test
    // asserted the headline source did not contain `c.value`, and
    // `cookies.map((ck) => ck.value).join(', ')` walked straight past it.
    expect(tool).toContain('report(current ? current.result : null)');

    const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    // Four names that land in four different categories, so the headline's
    // counts are non-trivial and a value could ride in on any of them.
    const jar: Array<[name: string, value: string]> = [
      ['PHPSESSID', `SENTINELVALUE0${stamp}`],
      ['_ga', `SENTINELVALUE1${stamp}`],
      ['wordpress_logged_in_9f2c', `SENTINELVALUE2${stamp}`],
      ['ad_click_id', `SENTINELVALUE3${stamp}`],
    ];
    const cookies = parseCookieList(jar.map(([n, v]) => `${n}=${v}`).join('; '));
    // Anti-vacuity: the sentinels really went in. A parser that dropped
    // values would make every assertion below pass over nothing.
    expect(cookies.map((c) => c.value)).toEqual(jar.map(([, v]) => v));
    expect(new Set(cookies.map((c) => c.category)).size, 'the four names were meant to spread across categories').toBeGreaterThan(1);

    for (const mode of ['browser', 'paste'] as const) {
      const report = cookieListReport(cookies, mode);
      const whole = JSON.stringify(report);
      expect(whole.length).toBeGreaterThan(150);
      // The headline is the COUNTING one — the assertion below is only
      // meaningful if the builder produced a real headline over these cookies.
      expect(report.result.headline).toMatch(/\b4 cookies\b/);
      expect(report.result.stats?.length).toBe(4);
      for (const [name, value] of jar) {
        expect(whole, `the cookie value of ${name} reached the ToolResult in ${mode} mode`).not.toContain(value);
      }
    }
  });
});

// ===========================================================================
// G5 — the positive half: an audit log of what the server FETCHED
// ===========================================================================

/**
 * cnast-api-log-no-ip, driven with a fake droplet.
 *
 * The check reads the cnast batch (cnast-lib.mjs) — one ssh command whose
 * output is marker-delimited sections — and, on a company target only, one
 * further grep for mod_security's audit directives. Both go through ctx.ssh,
 * which is a plain function on the context, so a scenario is a description
 * of a box. The batch is cached per context object, so every run gets a
 * fresh one.
 */
const apiLogCheck = apiLogMod.default as CheckDef;
const VHOST_FILE = '/etc/apache2/sites-enabled/000-default-le-ssl.conf';
const NOIP_FORMAT = 'LogFormat "%{%Y-%m-%dT%H:%M:%S}t \\"%r\\" %>s %b %Dus" ib_api_noip';

/** The :443 vhost as `grep -n` reports it, exactly as API-ON-DROPLET.md:188-217 has it. */
function vhostGrep(format = NOIP_FORMAT): string {
  return [
    `${VHOST_FILE}:12:RequestHeader unset X-Forwarded-For`,
    `${VHOST_FILE}:30:ProxyPass /api/ http://127.0.0.1:3100/ retry=0 timeout=10`,
    `${VHOST_FILE}:40:SetEnvIf Request_URI "^/api/" ib_api`,
    `${VHOST_FILE}:41:${format}`,
    `${VHOST_FILE}:42:CustomLog \${APACHE_LOG_DIR}/api.log ib_api_noip env=ib_api`,
    `${VHOST_FILE}:43:CustomLog \${APACHE_LOG_DIR}/access.log combined env=!ib_api`,
  ].join('\n');
}

function cnastBatch(vhost: string): string {
  return ['---CNAST:HOST---', 'Ubuntu 24.04.1 LTS', '6.8.0-45-generic', '---CNAST:SITESENABLED---', '000-default-le-ssl.conf', '000-default.conf', '---CNAST:VHOST---', vhost, '---CNAST:END---', ''].join('\n');
}

type ApiLogOpts = { modsec?: string; repoRoot?: string; vhost?: string };

async function runApiLog(target: 'company' | 'demo', opts: ApiLogOpts = {}) {
  const sshCalls: string[] = [];
  const origin = target === 'demo' ? DEMO : COMPANY;
  const ctx = {
    repoRoot: opts.repoRoot || REPO,
    origin,
    freeBase: `${origin}/resources`,
    proBase: `${origin}/resources-pro`,
    apiBase: `${origin}/api`,
    Skip: SkipCtor,
    ssh: (cmd: string) => {
      sshCalls.push(cmd);
      if (cmd.includes('---CNAST:')) return cnastBatch(opts.vhost ?? vhostGrep());
      if (cmd.includes('---IB:MODSEC-END---')) return `${opts.modsec ?? ''}\n---IB:MODSEC-END---\n`;
      throw new Error(`the check sent an ssh command this scenario does not know: ${cmd.slice(0, 80)}`);
    },
    http: async () => { throw new Error('cnast-api-log-no-ip must not use the network'); },
  };
  const r = await withEnv({ IB_DEPLOY_TARGET: target }, () => apiLogCheck.run(ctx));
  return { ...r, sshCalls };
}

const ABSENT_TITLE = /No audit log of scan targets/;
const sev = (r: { findings: Finding[] }, s: string) => r.findings.filter((f) => f.severity === s);

describe('G5 — the positive half: cnast-api-log-no-ip grades the ABSENCE of a scan-target audit log', () => {
  it('the fake droplet drives the existing no-client-address guards too, so the harness is not a rubber stamp', async () => {
    // Before trusting what this harness says about the new grade, prove it
    // reaches the old ones: an ib_api_noip format that grew a %h is the
    // finding this check was written for, and it must come out high.
    const r = await runApiLog('demo', { vhost: vhostGrep('LogFormat "%h %{%Y-%m-%dT%H:%M:%S}t \\"%r\\" %>s %b %Dus" ib_api_noip') });
    expect(sev(r, 'high').map((f) => f.title)).toEqual(['The ib_api_noip format now includes a client address token']);
    // And the correct vhost produces none.
    const ok = await runApiLog('demo');
    expect(sev(ok, 'high')).toEqual([]);
    expect(sev(ok, 'critical')).toEqual([]);
    expect(ok.checked).toBeGreaterThan(0);
  });

  it('on a COMPANY target with nothing recording the target, it is one medium finding that names both ways to close it', async () => {
    // The fact: api.log's format is %t %r %>s %b %D, and %r is
    // `POST /api/scan-url HTTP/1.1` — the route, never the target, which
    // travels in the POST body. The route holds the target and its resolved
    // addresses in `resolved` and discards them. Nothing on the box says what
    // was fetched. On a company network that is an incident nobody can
    // reconstruct.
    const r = await runApiLog('company');
    const absent = r.findings.filter((f) => ABSENT_TITLE.test(f.title));
    expect(absent, 'the absence of a scan-target audit log was not reported on a company target').toHaveLength(1);
    const f = absent[0];
    expect(f.severity).toBe('medium');
    expect(f.title).toMatch(/request line only/);
    expect(f.title).toMatch(/POST body/);
    expect(f.detail).toContain('LIVE ON THIS TARGET');
    // Both options, by name. Option (a) is the route-side sink with NO client
    // address; option (b) is mod_security, with its caveat said out loud.
    expect(f.remediation).toContain('scanAuditLog(');
    expect(f.remediation).toMatch(/SEPARATE file/);
    expect(f.remediation).toMatch(/NO client address/);
    expect(f.remediation).toMatch(/mod_security/);
    expect(f.remediation).toContain('SecAuditLog');
    expect(f.remediation).toMatch(/A section records the client address/);
    // The evidence quotes the format so a reader can see there is no body
    // token in it, and says the route has no sink.
    expect(f.evidence).toContain('ib_api_noip');
    expect(f.evidence).toContain('app/scan-url/route.ts has no audit sink');
    // Nothing about it is a high: the no-IP half is intact on this vhost.
    expect(sev(r, 'high')).toEqual([]);
  });

  it('on the DEMO it is the current behaviour at info, said out loud, and the demo nightly is charged no second ssh session', async () => {
    const r = await runApiLog('demo');
    const absent = r.findings.filter((f) => ABSENT_TITLE.test(f.title));
    expect(absent, 'the demo must still RECORD the absence — never silently').toHaveLength(1);
    expect(absent[0].severity).toBe('info');
    expect(absent[0].title).toMatch(/by design/);
    expect(absent[0].detail).toContain('DEPLOY REQUIREMENT');
    expect(sev(r, 'medium')).toEqual([]);
    // cnast-lib.mjs exists so that the nightly opens ONE root session to the
    // shared box. The mod_security grep is spent only where it informs a real
    // grade — the company target — and the demo's evidence says so.
    expect(r.sshCalls, 'the demo run opened a second ssh session').toHaveLength(1);
    expect(absent[0].evidence).toMatch(/not inspected on the demo target/);
  });

  it('the company target\'s one extra ssh read is a grep and nothing else', async () => {
    const r = await runApiLog('company');
    expect(r.sshCalls).toHaveLength(2);
    const extra = r.sshCalls.find((c) => c.includes('---IB:MODSEC-END---'))!;
    expect(extra, 'the mod_security read is not a plain grep').toMatch(/^grep -rhoE /);
    for (const seg of extra.split(';').map((s) => s.trim()).filter(Boolean)) {
      expect(seg, `a non-read-only segment in the mod_security command: ${seg}`).toMatch(/^(?:grep |echo )/);
    }
  });

  it('a mod_security audit log with SecAuditEngine On satisfies the audit half — and is reported for what its A section records', async () => {
    const r = await runApiLog('company', { modsec: 'SecRuleEngine On\nSecAuditEngine On\nSecAuditLog /var/log/apache2/modsec_audit.log' });
    expect(r.findings.filter((f) => ABSENT_TITLE.test(f.title)), 'a full mod_security audit log was not recognised').toEqual([]);
    const modsec = r.findings.filter((f) => /mod_security/.test(f.title));
    expect(modsec).toHaveLength(1);
    // Not green. Every entry's A section carries the client address, so the
    // target and the caller sit in one file: the audit clause met, the
    // privacy clause reduced to who can read that file. The check says so
    // rather than certify a promise the config does not keep.
    expect(modsec[0].severity).toBe('medium');
    expect(modsec[0].title).toMatch(/A section records the client address/);
    expect(modsec[0].evidence).toContain('SecAuditLog /var/log/apache2/modsec_audit.log');
  });

  it('SecAuditEngine RelevantOnly is not an audit log of every scan — the absence still reports', async () => {
    const r = await runApiLog('company', { modsec: 'SecRuleEngine On\nSecAuditEngine RelevantOnly\nSecAuditLog /var/log/apache2/modsec_audit.log' });
    const absent = r.findings.filter((f) => ABSENT_TITLE.test(f.title));
    expect(absent, 'RelevantOnly logs only flagged transactions and must not read as the audit log').toHaveLength(1);
    expect(absent[0].severity).toBe('medium');
    expect(absent[0].evidence).toContain('SecAuditEngine RelevantOnly');
  });

  it('a route-side sink named scanAuditLog, handed target and resolved addresses only, is recognised and recorded at info with its line', async () => {
    const root = repoWith({
      'app/scan-url/route.ts': [
        "import { lookup as dnsLookup } from 'node:dns/promises';",
        'export async function POST(request: Request) {',
        '  const parsedUrl = new URL(await request.text());',
        '  const resolved = await dnsLookup(parsedUrl.hostname, { all: true });',
        "  scanAuditLog(parsedUrl.hostname, resolved.map((r) => r.address), 'allowed');",
        '}',
        '',
      ].join('\n'),
    });
    const r = await runApiLog('company', { repoRoot: root });
    expect(r.findings.filter((f) => ABSENT_TITLE.test(f.title)), 'a route-side sink was not recognised').toEqual([]);
    const sink = r.findings.filter((f) => /scan-target audit sink exists/.test(f.title));
    expect(sink).toHaveLength(1);
    expect(sink[0].severity).toBe('info');
    expect(sink[0].file).toBe('app/scan-url/route.ts');
    expect(sink[0].line).toBe(5);
    expect(sev(r, 'high')).toEqual([]);
  });

  it('a route-side sink handed the client address is HIGH — the join the whole promise exists to prevent', async () => {
    // api.log omits %h so that no file on the box says which person scanned
    // which site. A sink that takes clientIP (or the /24 bucket, or the
    // request headers it is derived from) beside the target recreates that
    // record under a different name.
    for (const args of ['clientIP, parsedUrl.hostname, resolved', 'parsedUrl.hostname, resolved, { bucket }', "parsedUrl.hostname, resolved, request.headers.get('x-forwarded-for')"]) {
      const root = repoWith({ 'app/scan-url/route.ts': `export async function POST(request: Request) {\n  scanAuditLog(${args});\n}\n` });
      const r = await runApiLog('company', { repoRoot: root });
      const joined = sev(r, 'high');
      expect(joined.map((f) => f.title), `scanAuditLog(${args}) was not graded high`).toEqual([
        'The scan-target audit sink at app/scan-url/route.ts:2 is handed a client address — the target is joined to the caller',
      ]);
      expect(joined[0].evidence).toContain(args);
    }
  });

  it('the real route today has no audit sink, so the company grade above is about THIS code and not a fixture', () => {
    // Pinned so the finding cannot be explained away as a stale fixture: the
    // route holds `resolved` right after dnsLookup and never hands it to a
    // sink. The day option (a) lands, this expectation flips to the sink
    // scenario above — and that is the test that should change, not this
    // file's understanding of the route.
    const route = stripComments(src(SCAN_ROUTE));
    expect(route).toContain('const resolved = await dnsLookup(parsedUrl.hostname, { all: true })');
    expect(route).not.toMatch(/\b(?:scanAudit\w*|auditScan\w*|logScanTarget|appendFile(?:Sync)?|createWriteStream)\s*\(/);
  });
});
