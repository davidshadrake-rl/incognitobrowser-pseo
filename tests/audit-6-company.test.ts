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
 *       Two things about G1 this file deliberately does NOT claim to close,
 *       because a test cannot: the check is an IN-BAND prober, so a corp VPN or
 *       an IP allowlist — the two controls the owner names first — are invisible
 *       to it from inside the perimeter; and `confHasAuth` (pro-deploy-host.mjs:475)
 *       is computed and then only interpolated into the evidence string at :513.
 *       Both are reported as source changes, not smuggled in here as a passing
 *       assertion about behaviour that has not changed.
 *
 *   G5  the negative half — "never log cookie values or pasted cookie strings" —
 *       has no regression guard anywhere in tests/. It is the half that cannot
 *       announce itself when it breaks: a `console.log` added during a debugging
 *       session puts every visitor's pasted cookie jar into journald and nothing
 *       fails, nothing 500s, no visitor can tell. So: every log sink in the
 *       request path is enumerated and its arguments are read.
 *
 * TWO HOUSE RULES THIS FILE OBEYS, both earned the hard way in this repo.
 *
 *   1. A GUARD MUST NOT MATCH ITS OWN EXPLANATORY COMMENT. That has shipped
 *      here twice. It is not hypothetical for this file either:
 *      CookieAnalyzerTool.tsx contains the string `document.cookie` TWICE, and
 *      one of them is the comment on line 432 explaining what document.cookie
 *      does. A guard that counted raw occurrences would read 2, "prove" a
 *      second unaccounted-for read of the cookie jar, and be silenced by
 *      whoever next tried to understand it. Every source assertion below runs
 *      on comment-stripped text.
 *
 *   2. A CHECK THAT INSPECTED NOTHING HAS PROVED NOTHING. Every source scan
 *      here asserts a non-zero count of things it actually looked at before it
 *      asserts anything about them, so a refactor that moves a file cannot turn
 *      this suite green by emptying it. Same for the G1 scenarios: each asserts
 *      the check's own `checked` counter is non-zero.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(__dirname, '..');
const src = (p: string) => readFileSync(join(REPO, p), 'utf-8');

/**
 * Remove comments before asserting on source text. See house rule 1.
 *
 * The `[^:"'\`\\]` guard in front of `//` keeps a URL inside a string literal
 * ("https://example.com") from eating the rest of its line — a naive stripper
 * deletes real code there and a guard then "passes" over text that is not what
 * the file says.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '\n')
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

// ===========================================================================
// G1 — "a real gate in front of BOTH /resources-pro AND /api"
// ===========================================================================

const CHECKS_DIR = join(REPO, 'scripts', 'security', 'checks');
const deployHostMod = await import(pathToFileURL(join(CHECKS_DIR, 'pro-deploy-host.mjs')).href);

type CheckDef = {
  id: string;
  severity: string;
  cadence: string;
  run: (ctx: unknown) => Promise<{ findings: Array<Record<string, string>>; checked: number }>;
};

const gateCheck = (deployHostMod.default as CheckDef[]).find((c) => c.id === 'pro_vhost_noindex_but_no_login');

/** A crafted response in the shape ctx.http returns. */
type Stub = { status: number; headers?: Record<string, string>; text?: string };

/**
 * A context whose `http` answers from a table instead of the network.
 *
 * An unstubbed URL THROWS rather than returning a miss. If the check grows a
 * third probe, this file must be told about it — a silent empty answer would
 * let a new, ungraded surface slip in behind a green test.
 */
function fakeCtx(origin: string, routes: Record<string, Stub>) {
  return {
    repoRoot: REPO,
    origin,
    freeBase: `${origin}/resources`,
    proBase: `${origin}/resources-pro`,
    apiBase: `${origin}/api`,
    http: async (url: string) => {
      const r = routes[url];
      if (!r) throw new Error(`the check probed an unstubbed URL: ${url}`);
      return { ok: true, status: r.status, headers: new Headers(r.headers || {}), text: r.text || '', json: null, url };
    },
  };
}

/** Run the check with IB_DEPLOY_TARGET pinned, then put the environment back. */
async function runGate(target: 'company' | 'demo', origin: string, routes: Record<string, Stub>) {
  const hadTarget = Object.prototype.hasOwnProperty.call(process.env, 'IB_DEPLOY_TARGET');
  const prevTarget = process.env.IB_DEPLOY_TARGET;
  const hadHost = Object.prototype.hasOwnProperty.call(process.env, 'IB_COMPANY_HOST');
  const prevHost = process.env.IB_COMPANY_HOST;
  process.env.IB_DEPLOY_TARGET = target;
  delete process.env.IB_COMPANY_HOST;
  try {
    return await gateCheck!.run(fakeCtx(origin, routes));
  } finally {
    if (hadTarget) process.env.IB_DEPLOY_TARGET = prevTarget;
    else delete process.env.IB_DEPLOY_TARGET;
    if (hadHost) process.env.IB_COMPANY_HOST = prevHost;
    else delete process.env.IB_COMPANY_HOST;
  }
}

const COMPANY = 'https://privacy-tools.example-corp.internal';
const DEMO = 'https://206-189-186-34.nip.io';

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
 */
const COOKIE_MATERIAL = [/cookie/i, /\bcustomInput\b/, /\bsetCookies\b/];
/**
 * A raw body is cookie material too, transitively: /event and /scan-url both
 * read a caller-supplied body, and the cookie tool's paste box is one POST
 * away from being in it if anyone ever decides to send it.
 */
const BODY_MATERIAL = [/\brequest\.text\s*\(/, /\breq\.text\s*\(/, /\bbody\.text\b/, /\brawBody\b/, /\brequestBody\b/, /readCappedRequestText/];

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

  type Site = { rel: string; line: number; call: string; args: string };
  const sites: Site[] = [];
  for (const abs of files) {
    const text = stripComments(readFileSync(abs, 'utf-8'));
    const re = /\bconsole\.(log|info|warn|error|debug|trace|dir|table)\s*\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const openIdx = m.index + m[0].length - 1;
      sites.push({
        rel: abs.slice(REPO.length + 1),
        line: text.slice(0, m.index).split('\n').length,
        call: `console.${m[1]}`,
        args: callArgs(text, openIdx),
      });
    }
  }

  it('there are log sinks to inspect at all', () => {
    // Without this, deleting every console call — or breaking the scanner —
    // would make the assertion below pass over an empty list, which is the
    // "0 findings over 0 items" pass the security harness refuses by design.
    expect(files.length, 'the source walk found no TypeScript under app/, lib/ or components/').toBeGreaterThan(50);
    expect(sites.length, 'no console call sites were found — the scanner is broken, not the code clean').toBeGreaterThanOrEqual(5);
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

  it('the one log line on the scan path carries the error TYPE, never the target or the response', () => {
    // app/scan-url/route.ts is the only route that fetches a caller-named URL
    // and parses Set-Cookie out of what comes back, so it is the one whose
    // catch block is worth reading by hand rather than by pattern.
    const route = stripComments(src('app/scan-url/route.ts'));
    expect(route).toContain('const errorType = err instanceof Error ? err.constructor.name');
    const site = sites.find((s) => s.rel === 'app/scan-url/route.ts');
    expect(site, 'the scan route no longer logs at all, or the scanner missed it').toBeTruthy();
    expect(site!.args).toContain('errorType');
    // `result`, `html` and `response` are, respectively, the parsed cookie
    // list, the target's page source and the upstream response object.
    for (const forbidden of ['result', 'html', 'response', 'targetUrl', 'parsedUrl']) {
      expect(site!.args, `the scan route's log line now interpolates ${forbidden}`).not.toContain(forbidden);
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
    // one of them is the comment above line 435 explaining what it does. A
    // count on unstripped text reads 2 and invents a second read that is not
    // there. Assert on the stripped text, and assert the count, so a NEW read
    // added anywhere in the file is a failure rather than a shrug.
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

  it('the result bus carries counts and a score, never a cookie value', () => {
    // The one thing that DOES leave this component is the ToolResult handed to
    // the shared result bus, which ResultCard turns into an analytics event.
    // Its headline is built from counts, so the values never enter the
    // pipeline that ends at /event.
    expect(tool).toContain('report(current ? current.result : null)');
    const headline = tool.slice(tool.indexOf('export function cookieListReport'), tool.indexOf('export function cookieListReport') + 1_600);
    expect(headline.length).toBeGreaterThan(400);
    expect(headline).toMatch(/count\(cookies\.length, 'cookie'\)/);
    expect(headline, 'the headline now interpolates a cookie value').not.toMatch(/\bc\.value\b|\.value\}/);
  });
});
