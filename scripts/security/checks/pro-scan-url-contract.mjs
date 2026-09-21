/**
 * The scanner's server leg, graded from the PRO side.
 *
 * /api/scan-url is the one place this product makes an outbound request to an
 * address a visitor chose. On the Pro deployment that matters more than on the
 * free one, not because the code differs — it does not, there is exactly one
 * API and `IS_PRO_DEPLOYMENT` is a build flag, not an entitlement (lib/tiers.ts:70)
 * — but because the Pro pages are the ones a COMPANY is meant to deploy inside
 * its own network. Whatever this endpoint can be pointed at, it can be pointed
 * at from there.
 *
 * WHAT ALREADY EXISTS, and is deliberately not rebuilt here:
 *   - tests/ssrf-protection.test.ts and tests/ssrf-resolve.test.ts grade the
 *     REAL isBlockedHostname over the text forms, and pin the limits of a text
 *     check (a name that merely RESOLVES somewhere private).
 *   - scripts/security-smoke.mjs runs nine SSRF cases against the live API
 *     with a real solved proof-of-work — from whichever base it is given,
 *     which in practice is the free site.
 *   - scripts/security/checks/api-inproc.mjs drives the real route with the
 *     socket and the resolver replaced by recorders.
 *
 * WHAT IS ADDED, and why each one is not already covered:
 *
 *   pro_scan_url_ssrf_table
 *     The same class of probe issued with the PRO pages' Origin and Referer,
 *     plus four cases the live smoke has never run: the resolver leg
 *     (169-254-169-254.nip.io, 127-0-0-1.nip.io — the two names the route's
 *     dnsLookup branch was added for), the decimal and hex spellings of
 *     127.0.0.1, and a redirect whose Location points into blocked space.
 *     169.254.169.254 is not a theoretical address here: this is a DigitalOcean
 *     droplet and that endpoint answers on port 80 from it.
 *
 *   pro_scan_url_origin_allowlist_company_host
 *     Nothing in this repo asserts that the origin allowlist is configurable
 *     per deployment, or says what has to change when the Pro site moves to a
 *     company host. tests/cors-security.test.ts greps lib/origin.ts for the
 *     env var's NAME; that is not the same question.
 *
 *   pro_scan_xss_cookie_name_and_inline_tracker
 *     The scan response is attacker-shaped data (cookie names, cookie domains,
 *     third-party hostnames) rendered into React. Nothing pins the response's
 *     top-level SHAPE, which is the thing that would change if a future edit
 *     ever put the fetched page body, or our own response headers, into the
 *     JSON. tests/xss-protection.test.ts audits other components and never
 *     looks at the scanner tool.
 *
 * The executable half of the last one — driving the real analyzeScan and the
 * real route with a hostile target — is tests/pro-scan-contract.test.ts. This
 * file grades the contract; that file grades the behaviour.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { check, finding, Skip } from '../lib/harness.mjs';

const read = (ctx, rel) => readFileSync(join(ctx.repoRoot, rel), 'utf-8');

/**
 * The droplet that is the DECLARED demo target (lib/tiers.ts PRO_BASE_URL,
 * API-ON-DROPLET.md, .secrets SITE_ORIGIN). Every check below that has an
 * opinion about production asks whether the target it was pointed at is this
 * host or somebody's company deployment, and grades accordingly — a blanket
 * rule about a staging host would be red on every run against the demo, and a
 * suite that is always red is one nobody reads.
 */
const DEMO_HOST = '206-189-186-34.nip.io';

const hostOf = (origin) => { try { return new URL(origin).host; } catch { return String(origin); } };

// ---------------------------------------------------------------------------
// 1. The SSRF table, from the Pro origin, against the live API
// ---------------------------------------------------------------------------

/**
 * The cases. Each one must come back 400 with the guard's refusal.
 *
 * `why` is not decoration: when one of these goes red the report has to say
 * what the address reaches on THIS box, or whoever reads it cannot tell a
 * cosmetic regression from a live hole.
 */
const SSRF_CASES = [
  { url: 'http://127.0.0.1/', label: 'loopback literal',
    why: 'the droplet itself: Redis on 6379, MySQL, and the API on 127.0.0.1:3100 behind Apache' },
  { url: 'http://192.168.1.1/', label: 'RFC1918 192.168/16',
    why: 'the private space a company Pro deployment would sit inside' },
  { url: 'http://169.254.1.1/', label: 'link-local 169.254/16',
    why: 'the range the cloud metadata service lives in' },
  { url: 'http://169.254.169.254/latest/meta-data/', label: 'cloud metadata (169.254.169.254)',
    why: 'THIS IS A DIGITALOCEAN DROPLET — that address answers on port 80 from here and serves the instance metadata' },
  { url: 'http://[fd00::1]/', label: 'IPv6 unique-local fd00::/8',
    why: 'the IPv6 half of RFC1918; a v6-only internal service is reachable by no other spelling' },
  { url: 'http://[fe80::1]/', label: 'IPv6 link-local fe80::/10',
    why: 'the v6 link-local range, which is where a v6 metadata endpoint would answer' },
  { url: 'http://2130706433/', label: '127.0.0.1 in decimal',
    why: 'WHATWG URL parsing turns this into 127.0.0.1 before the guard sees it; verify the guard sees the normalised form' },
  { url: 'http://0x7f.0.0.1/', label: '127.0.0.1 with a hex octet',
    why: 'same normalisation, different spelling — tests/ssrf-resolve.test.ts pins that the TEXT check alone does not catch these' },
  { url: 'http://[::ffff:a9fe:a9fe]/', label: 'metadata as IPv4-mapped IPv6 in hex',
    why: 'the spelling that actually arrives after URL parsing; was ALLOWED by the real guard on 2026-09-18' },
  { url: 'http://metadata.google.internal./', label: 'blocked name with a trailing dot',
    why: 'a trailing dot is a different string and the same host; was ALLOWED on 2026-09-18' },
  // The resolver leg. These two names are the exact ones app/scan-url/route.ts:230
  // names in the comment that justifies the dnsLookup branch, and neither has
  // ever been fired at the live API by anything in this repo.
  { url: 'http://169-254-169-254.nip.io/', label: 'a public NAME that resolves to the metadata address',
    why: 'the text guard passes it; only the dnsLookup branch at route.ts:241 stops it reaching DigitalOcean metadata' },
  { url: 'http://127-0-0-1.nip.io/', label: 'a public NAME that resolves to loopback',
    why: 'same leg, pointed at this droplet\'s own localhost' },
];

/**
 * The redirect leg.
 *
 * A hostile Location cannot be manufactured from a host we do not control, so
 * this row uses a public redirector and is graded honestly: if the redirector
 * is unreachable the row is UNGRADED and said so, never counted as a pass.
 * The property the route actually implements is stronger than "do not follow a
 * redirect into private space" — with redirect:'manual' it refuses EVERY 3xx
 * (route.ts:308) — so the second row proves that with a redirect that will
 * exist as long as the web does.
 */
const REDIRECT_CASES = [
  { url: 'http://httpbin.org/redirect-to?url=http%3A%2F%2F169.254.169.254%2F',
    label: 'redirect whose Location points at cloud metadata',
    why: 'the only case where the blocked address is never in the URL we validate' },
  { url: 'http://google.com/', label: 'an ordinary public 3xx',
    why: 'CONTROL for the row above: proves no redirect is followed at all, whatever its Location says' },
];

/** The top-level keys a scan response may have. Locked here and in tests/pro-scan-contract.test.ts. */
const RESULT_KEYS = ['url', 'status', 'cookies', 'trackers', 'inlineTrackers', 'thirdPartyDomains', 'security', 'summary'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const solve = (salt, challenge, maxnumber) => {
  for (let n = 0; n <= maxnumber; n++) {
    if (createHash('sha256').update(salt + n).digest('hex') === challenge) return n;
  }
  return -1;
};

const ssrfTable = check({
  id: 'pro_scan_url_ssrf_table',
  discipline: 'dast',
  cadence: 'on-demand',
  severity: 'critical',
  // NOT safe to run unattended. Every row costs a fresh proof-of-work token and
  // the scan limit is 10 per minute per /24, so a full pass deliberately fills
  // that window twice and waits it out. The rows themselves are cheap for the
  // box — all but the control are refused before any socket is opened — but a
  // check that parks a shared rate-limit bucket for three minutes is one a
  // person asks for, not one a cron job springs on a 2-vCPU host that is also
  // serving the team's WordPress.
  //   node scripts/security/run.mjs --only=pro_scan_url_ssrf_table
  needsOptIn: true,
  safeAgainstProd: false,
  describe: 'The live SSRF table, issued with the Pro pages\' Origin and Referer, including the resolver leg and a hostile redirect.',
  async run(ctx) {
    const origin = ctx.origin;
    // Trailing slash deliberately: the Pro site is a static export, so the
    // extensionless form is a 301 to the directory. Asking for the redirect
    // would make the instrumentation guard below fire on a healthy site.
    const proPage = `${ctx.proBase}/tools/ad-tracking/cookie-tracker-scanner/`;

    // INSTRUMENTATION GUARD. If the Pro tool page is not live, "a table from
    // the Pro origin" is a table from nowhere and every 400 below would be
    // reassurance rather than evidence.
    const page = await ctx.http(proPage, { timeoutMs: 20_000 });
    if (!page.ok || page.status !== 200) {
      throw new Skip(`the Pro scanner page is not serving (${proPage} => ${page.status || page.error}); a Pro-origin table would grade nothing`);
    }

    const api = async (path, { headers = {}, body } = {}) => ctx.http(`${ctx.apiBase}${path}`, {
      method: 'POST',
      timeoutMs: 25_000,
      headers: {
        'Content-Type': 'application/json',
        Origin: origin,
        Referer: proPage,
        ...headers,
      },
      body: JSON.stringify(body ?? {}),
    });

    /** A challenge fetched and solved. One per scan — a solved token is single-use. */
    const freshToken = async () => {
      const c = await api('/challenge');
      if (c.status !== 200 || !c.json) return null;
      const n = solve(c.json.salt, c.json.challenge, c.json.maxnumber ?? 100_000);
      if (n < 0) return null;
      return 'Altcha ' + Buffer.from(JSON.stringify({
        algorithm: c.json.algorithm || 'SHA-256',
        salt: c.json.salt,
        number: n,
        signature: c.json.signature,
        expires: c.json.expires,
      })).toString('base64');
    };

    /** One scan with a fresh token, pausing once if the per-/24 window is full. */
    const scan = async (url) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const token = await freshToken();
        if (!token) return { status: 0, json: null, note: 'could not mint a proof-of-work token' };
        const r = await api('/scan-url', { headers: { Authorization: token }, body: { url } });
        if (r.status !== 429) return r;
        await sleep(62_000);
      }
      return { status: 429, json: null, note: 'rate-limited twice; row UNGRADED' };
    };

    const findings = [];
    let checked = 0;

    // The CONTROL comes first. Without a scan that reaches the network and
    // returns a result, a table of refusals could equally mean the API is down.
    const control = await scan('https://example.com/');
    if (control.status !== 200 || !control.json || !Array.isArray(control.json.cookies)) {
      throw new Skip(
        `the control scan of https://example.com/ did not succeed (status ${control.status}${control.note ? `, ${control.note}` : ''}${control.json && control.json.error ? `, ${control.json.error}` : ''}); every refusal below would be vacuous`,
      );
    }
    checked += 1;

    // Live shape lock, on a real response from the real target. tests/pro-scan-contract.test.ts
    // locks the same key set against analyzeScan directly; this is the half that
    // can see something the API adds AFTER analyzeScan returns.
    const keys = Object.keys(control.json).sort();
    const extra = keys.filter((k) => !RESULT_KEYS.includes(k));
    const missing = RESULT_KEYS.filter((k) => !keys.includes(k));
    if (extra.length || missing.length) {
      findings.push(finding({
        severity: extra.length ? 'high' : 'medium',
        title: `The live scan response does not match the locked shape${extra.length ? ` (extra: ${extra.join(', ')})` : ''}`,
        detail: 'Every top-level key is rendered into React by components/tools/CookieAnalyzerTool.tsx. A key that was not there before is a key nothing knows how to render safely, and the ones worth fearing carry the fetched page body or our own response headers.',
        evidence: `POST ${ctx.apiBase}/scan-url {"url":"https://example.com/"} => 200, keys [${keys.join(', ')}]; expected exactly [${RESULT_KEYS.join(', ')}]`,
        remediation: 'Keep the response equal to lib/scanner.ts analyzeScan\'s return value, and add any new key to RESULT_KEYS here and in tests/pro-scan-contract.test.ts deliberately.',
        file: 'lib/scanner.ts',
      }));
    }
    const rawBody = control.text || '';
    if (/wp-json|wp-content|"wordpress"/i.test(rawBody)) {
      findings.push(finding({
        severity: 'high',
        title: 'The scan response carries WordPress markers',
        detail: 'The team\'s WordPress shares this box. Anything of its in an API response means the proxy or the scanner is reaching it.',
        evidence: `POST ${ctx.apiBase}/scan-url returned a body matching /wp-json|wp-content/: ${rawBody.slice(0, 200)}`,
        remediation: 'Trace the Apache /api proxy and the scan target; the API must answer from ib-api on 127.0.0.1:3100 only.',
      }));
    }
    const setCookie = control.headers && control.headers.get ? control.headers.get('set-cookie') : null;
    if (setCookie) {
      findings.push(finding({
        severity: 'medium',
        title: 'The scan API set a cookie of its own',
        detail: 'These pages and this API are sold as storing nothing per visitor. A Set-Cookie from our own origin is both a privacy claim broken and a new thing to secure.',
        evidence: `POST ${ctx.apiBase}/scan-url => Set-Cookie: ${String(setCookie).slice(0, 160)}`,
        remediation: 'app/scan-url/route.ts and lib/origin.ts corsHeadersFor must not emit Set-Cookie.',
        file: 'app/scan-url/route.ts',
      }));
    }

    const ungraded = [];
    for (const c of SSRF_CASES) {
      const r = await scan(c.url);
      if (r.status === 429 || r.status === 0) { ungraded.push(`${c.label} (${r.note || r.status})`); continue; }
      checked += 1;
      if (r.status === 400) continue;
      const reached = r.status === 200;
      findings.push(finding({
        severity: reached ? 'critical' : 'high',
        title: `SSRF: ${c.label} was not refused (HTTP ${r.status})`,
        detail: `${c.why}. Issued with the Pro pages' Origin and Referer, so this is reachable by anyone who can open the Pro scanner.`,
        evidence: `POST ${ctx.apiBase}/scan-url {"url":"${c.url}"} (Origin: ${origin}, Referer: ${proPage}) => ${r.status} ${JSON.stringify(r.json && (r.json.error || Object.keys(r.json))).slice(0, 200)}`,
        remediation: reached
          ? 'app/scan-url/route.ts fetched an internal address. Fix the guard at route.ts:213 (text) or route.ts:241 (resolved addresses) before anything else.'
          : 'Expected 400 from the SSRF guard. A different status means the request got past the guard and failed somewhere later, which is the guard failing.',
        file: 'app/scan-url/route.ts',
        line: 213,
      }));
    }

    for (const c of REDIRECT_CASES) {
      const r = await scan(c.url);
      if (r.status === 429 || r.status === 0 || r.status === 502) {
        // 502 here is the redirector being unreachable, not a verdict.
        ungraded.push(`${c.label} (${r.note || `status ${r.status}`})`);
        continue;
      }
      checked += 1;
      if (r.status === 400) continue;
      findings.push(finding({
        severity: 'critical',
        title: `SSRF: ${c.label} was not refused (HTTP ${r.status})`,
        detail: `${c.why}. app/scan-url/route.ts:308 must refuse every 3xx; a 200 here means a Location was followed and the body of whatever it pointed at was scanned.`,
        evidence: `POST ${ctx.apiBase}/scan-url {"url":"${c.url}"} => ${r.status} ${JSON.stringify(r.json && (r.json.error || Object.keys(r.json))).slice(0, 200)}`,
        remediation: 'Keep redirect:\'manual\' on the outbound fetch and keep the 3xx branch returning 400.',
        file: 'app/scan-url/route.ts',
        line: 308,
      }));
    }

    if (ungraded.length) {
      findings.push(finding({
        severity: 'info',
        title: `${ungraded.length} SSRF row(s) could not be graded on this run`,
        detail: 'Recorded rather than dropped: a row that did not run is not a row that passed, and the count above excludes them.',
        evidence: ungraded.join('; '),
        remediation: 'Re-run when the rate-limit window is clear: node scripts/security/run.mjs --only=pro_scan_url_ssrf_table',
      }));
    }

    return { findings, checked };
  },
});

// ---------------------------------------------------------------------------
// 2. The origin allowlist, and what cutover to a company host requires
// ---------------------------------------------------------------------------

const originAllowlist = check({
  id: 'pro_scan_url_origin_allowlist_company_host',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  describe: 'The API origin allowlist is explicit, per-deployment, and the cutover to a company Pro host is a named, performable edit.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const originSrc = read(ctx, 'lib/origin.ts');
    const targetHost = hostOf(ctx.origin);
    const companyTarget = targetHost !== DEMO_HOST;

    // (a) The list must be configurable at all. If this ever stops being true,
    //     a company deploy cannot set its own origins without a code change.
    checked += 1;
    if (!/process\.env\.ALLOWED_ORIGINS/.test(originSrc)) {
      findings.push(finding({
        severity: 'high',
        title: 'The origin allowlist is no longer environment-configurable',
        detail: 'lib/origin.ts is the only allowlist on this API. If it stops reading ALLOWED_ORIGINS, a company deployment has to fork the code to admit its own Pro host.',
        evidence: 'lib/origin.ts contains no reference to process.env.ALLOWED_ORIGINS',
        remediation: 'Restore getAllowedOrigins()\'s env read.',
        file: 'lib/origin.ts',
        line: 22,
      }));
    }

    // (b) What the fallback admits when nobody sets the variable.
    checked += 1;
    const defaults = [...originSrc.matchAll(/const DEFAULT_ALLOWED = \[([\s\S]*?)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
    if (!defaults.length) {
      findings.push(finding({
        severity: 'medium',
        title: 'Could not read DEFAULT_ALLOWED out of lib/origin.ts',
        detail: 'This check grades what the allowlist falls back to. If the constant cannot be parsed the grade below is unearned, so it is reported rather than assumed.',
        evidence: 'no DEFAULT_ALLOWED array literal matched in lib/origin.ts',
        remediation: 'Update this parser, or keep DEFAULT_ALLOWED a plain array of string literals.',
        file: 'lib/origin.ts',
        line: 15,
      }));
    }

    // (c) THE HEADLINE. Today the pages and the API share one host, so
    //     isOriginAllowed's same-origin shortcut (lib/origin.ts:61) satisfies
    //     every real request and ALLOWED_ORIGINS is not load-bearing at all.
    //     The moment the Pro site is served from a company host and calls this
    //     API, the shortcut stops applying and that variable becomes the only
    //     thing standing between the company's pages and a 403.
    checked += 1;
    const sameOriginShortcut = /new URL\(origin\)\.host === requestHost/.test(originSrc);
    if (sameOriginShortcut) {
      findings.push(finding({
        severity: companyTarget ? 'high' : 'medium',
        title: 'ALLOWED_ORIGINS is untested in practice: the same-origin shortcut carries every request today',
        detail: [
          'lib/origin.ts:61 allows any request whose Origin host equals the Host header. The Pro pages (/resources-pro) and the API (/api) are served from one host today, so every real call is allowed by that branch and the configured list is never consulted.',
          'At cutover the Pro pages move to a company host and the call becomes genuinely cross-origin. ALLOWED_ORIGINS on the API service then decides whether the product works — a variable that has never been exercised.',
        ].join(' '),
        evidence: `lib/origin.ts:58-68 isOriginAllowed returns true on host equality; pages and API share ${DEMO_HOST} (API-ON-DROPLET.md:115 sets ALLOWED_ORIGINS=https://${DEMO_HOST}); target for this run: ${ctx.origin}`,
        remediation: [
          'AT CUTOVER, in order:',
          '1. add the company Pro origin to ALLOWED_ORIGINS in /etc/ib-api.env;',
          `2. remove https://${DEMO_HOST} from that list once the demo host is retired;`,
          '3. restart ib-api — getAllowedOrigins() memoises the parsed list in a module-level cache (lib/origin.ts:20), so editing the env file alone changes nothing;',
          '4. verify with a request from the company origin AND a request from a foreign origin, since only the second can fail for the right reason.',
        ].join(' '),
        file: 'lib/origin.ts',
        line: 58,
      }));
    }

    // (d) The deploy's own origin smoke cannot detect a wrong allowlist.
    checked += 1;
    const deployApi = read(ctx, 'scripts/deploy-api.sh');
    const smokeUsesOwnOrigin = /origin:\$SITE_ORIGIN/.test(deployApi);
    const smokeHasForeignOrigin = /origin:\s*https?:\/\/(?!\$SITE_ORIGIN)/.test(deployApi);
    if (smokeUsesOwnOrigin && !smokeHasForeignOrigin) {
      findings.push(finding({
        severity: 'medium',
        title: 'The deploy smoke proves nothing about the origin allowlist',
        detail: 'scripts/deploy-api.sh posts to $SITE_ORIGIN/api/* with Origin: $SITE_ORIGIN. Origin host and Host header are then equal, so the same-origin shortcut returns 200 whatever ALLOWED_ORIGINS contains — including empty, including the wrong company. The check that would catch a misconfigured allowlist is the one with a foreign Origin, and it is not there.',
        evidence: `scripts/deploy-api.sh:124 ORIGIN="-H origin:$SITE_ORIGIN ..." and no probe with any other Origin value`,
        remediation: 'Add two probes to the deploy smoke: a foreign Origin that must be 403, and — after cutover — the company Pro origin that must be 200.',
        file: 'scripts/deploy-api.sh',
        line: 124,
      }));
    }

    // (e) Where the allowlist value actually lives. It is not in this repo, so
    //     "configure the allowlist" is a step someone performs by hand on the
    //     box; the check's job is to make sure that step is written down.
    checked += 1;
    const doc = existsSync(join(ctx.repoRoot, 'API-ON-DROPLET.md')) ? read(ctx, 'API-ON-DROPLET.md') : '';
    const documented = /ALLOWED_ORIGINS=/.test(doc);
    const writtenByDeploy = /ALLOWED_ORIGINS/.test(deployApi) || /ALLOWED_ORIGINS/.test(read(ctx, 'scripts/deploy.sh'));
    if (documented && !writtenByDeploy) {
      findings.push(finding({
        severity: 'low',
        title: 'The origin allowlist is hand-edited on the box and nothing verifies it after a deploy',
        detail: 'ALLOWED_ORIGINS lives only in /etc/ib-api.env (API-ON-DROPLET.md:115). Neither deploy script writes it, reads it back, or fails when it is missing, and the app falls back to the incognitobrowser.io defaults in silence when it is unset.',
        evidence: `API-ON-DROPLET.md documents ALLOWED_ORIGINS=https://${DEMO_HOST}; grep of scripts/deploy.sh and scripts/deploy-api.sh for ALLOWED_ORIGINS: no match`,
        remediation: 'Have the deploy read the running service\'s ALLOWED_ORIGINS back and print it, so a cutover that forgot the edit is visible in the deploy output rather than at the first cross-origin request.',
        file: 'scripts/deploy-api.sh',
      }));
    }

    // (f) Target-aware: a run pointed at a company host must not still find the
    //     demo droplet baked into the shipped link defaults. This is the row
    //     that would be a blanket ban if it were not target-aware — against the
    //     demo it says nothing, because the demo host IS the product right now.
    checked += 1;
    if (companyTarget) {
      const tiers = read(ctx, 'lib/tiers.ts');
      const baked = [...tiers.matchAll(new RegExp(`'https://${DEMO_HOST.replace(/\./g, '\\.')}[^']*'`, 'g'))].map((m) => m[0]);
      if (baked.length) {
        findings.push(finding({
          severity: 'high',
          title: `Run targets ${targetHost}, but the demo droplet is still the built-in default for Pro and free links`,
          detail: 'lib/tiers.ts PRO_BASE_URL and FREE_BASE_URL fall back to the demo droplet when NEXT_PUBLIC_PRO_URL / NEXT_PUBLIC_FREE_URL are unset. A company build made without those variables ships links to a third-party demo host.',
          evidence: `target ${ctx.origin}; lib/tiers.ts still defaults to ${baked.join(', ')}`,
          remediation: 'Set NEXT_PUBLIC_PRO_URL and NEXT_PUBLIC_FREE_URL in the company build (scripts/deploy.sh:109 already passes them), and change these defaults when the demo droplet is retired.',
          file: 'lib/tiers.ts',
          line: 78,
        }));
      }
    }

    return { findings, checked };
  },
});

// ---------------------------------------------------------------------------
// 3. What comes back, and how it is rendered
// ---------------------------------------------------------------------------

/** Sinks that turn a string into markup. None of them belong in a tool component. */
const HTML_SINKS = ['dangerouslySetInnerHTML', '.innerHTML', 'outerHTML', 'insertAdjacentHTML', 'document.write', 'eval('];

/**
 * The attacker-controlled fields of a scan result, and the exact JSX that
 * renders each. A field with no located render site is reported, not assumed
 * safe: "we could not find where this is displayed" and "this is displayed
 * safely" are different answers and only one of them is evidence.
 */
const RENDER_SITES = [
  { field: 'cookies[].cookieName', re: /\{c\.cookieName\}/, source: 'the Set-Cookie name from the scanned site' },
  { field: 'cookies[].domain', re: /\{c\.domain\}/, source: 'the Domain= attribute from the scanned site' },
  { field: 'cookies[].description', re: /\{c\.description\}/, source: 'our own text for a known cookie, our heuristic text otherwise' },
  { field: 'thirdPartyDomains[]', re: /thirdPartyDomains\.map\(\(domain, i\) => \(/, source: 'hostnames parsed out of the scanned page\'s script tags' },
  { field: 'inlineTrackers[]', re: /inlineTrackers\.map\(\(t, i\) => \(/, source: 'a label from the fixed INLINE_TRACKERS list' },
];

const xssContract = check({
  id: 'pro_scan_xss_cookie_name_and_inline_tracker',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  describe: 'The scan response shape is locked, carries no fetched body or cookies of ours, and every attacker-controlled field is rendered as text.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const scanner = read(ctx, 'lib/scanner.ts');
    const route = read(ctx, 'app/scan-url/route.ts');
    const tool = read(ctx, 'components/tools/CookieAnalyzerTool.tsx');

    // (a) The declared contract: the ScanResult interface.
    checked += 1;
    const ifaceStart = scanner.indexOf('export interface ScanResult {');
    const ifaceEnd = ifaceStart === -1 ? -1 : scanner.indexOf('\n}', ifaceStart);
    if (ifaceStart === -1 || ifaceEnd === -1) {
      throw new Skip('could not locate `export interface ScanResult` in lib/scanner.ts; the shape lock below would grade nothing');
    }
    const ifaceKeys = [...scanner.slice(ifaceStart, ifaceEnd).matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]);
    const ifaceExtra = ifaceKeys.filter((k) => !RESULT_KEYS.includes(k));
    const ifaceMissing = RESULT_KEYS.filter((k) => !ifaceKeys.includes(k));
    if (ifaceExtra.length || ifaceMissing.length) {
      findings.push(finding({
        severity: ifaceExtra.length ? 'high' : 'medium',
        title: `ScanResult no longer matches the locked shape${ifaceExtra.length ? ` (new key: ${ifaceExtra.join(', ')})` : ''}`,
        detail: 'Every top-level key reaches the browser and is rendered by components/tools/CookieAnalyzerTool.tsx. A new one is a field nobody has decided how to display, and the dangerous shapes — the fetched HTML, the target\'s raw headers, our own response headers — all enter this way.',
        evidence: `lib/scanner.ts ScanResult keys [${ifaceKeys.join(', ')}]; locked set [${RESULT_KEYS.join(', ')}]`,
        remediation: 'Add the key here and in tests/pro-scan-contract.test.ts deliberately, with a decision about how it is rendered.',
        file: 'lib/scanner.ts',
        line: 557,
      }));
    }

    // (b) The constructed object: analyzeScan's return. The interface is what
    //     is declared; this is what is built. They can disagree — an extra
    //     property on an object literal assigned to a typed return is a
    //     compile error, but a widened type or an `as` cast is not.
    checked += 1;
    const fnStart = scanner.indexOf('export function analyzeScan(');
    const retStart = fnStart === -1 ? -1 : scanner.indexOf('\n  return {', fnStart);
    const retEnd = retStart === -1 ? -1 : scanner.indexOf('\n  };', retStart);
    if (retStart === -1 || retEnd === -1) {
      throw new Skip('could not locate analyzeScan\'s return literal in lib/scanner.ts; the shape lock would be half-blind');
    }
    const retBlock = scanner.slice(retStart, retEnd);
    const retKeys = [...retBlock.matchAll(/^ {4}(\w+)[,:]/gm)].map((m) => m[1]);
    const retExtra = retKeys.filter((k) => !RESULT_KEYS.includes(k));
    if (retExtra.length) {
      findings.push(finding({
        severity: 'high',
        title: `analyzeScan returns a key that is not in the locked shape: ${retExtra.join(', ')}`,
        detail: 'The returned object is what NextResponse.json sends, whatever the interface says.',
        evidence: `analyzeScan return keys [${retKeys.join(', ')}]; locked set [${RESULT_KEYS.join(', ')}]`,
        remediation: 'Remove the key, or lock it here and decide how the tool renders it.',
        file: 'lib/scanner.ts',
      }));
    }

    // (c) The fetched page body must not travel. `html` is the capped body
    //     inside analyzeScan; it is read by the detectors and must not be a
    //     value in the result.
    checked += 1;
    if (/:\s*html\b|^\s{4}html[,:]/m.test(retBlock)) {
      findings.push(finding({
        severity: 'critical',
        title: 'analyzeScan returns the fetched page body',
        detail: 'The scanned page is an attacker-chosen document. Shipping it to the browser inside a JSON field is a stored-content channel into our own origin, and it is exactly the extra key this lock exists to catch.',
        evidence: `analyzeScan return block contains \`html\`: ${retBlock.replace(/\s+/g, ' ').slice(0, 200)}`,
        remediation: 'Keep the body inside analyzeScan; return only derived findings.',
        file: 'lib/scanner.ts',
      }));
    }

    // (d) The success response must be the result object and nothing more.
    checked += 1;
    if (!/NextResponse\.json\(result,\s*\{\s*headers:\s*allHeaders\s*\}\)/.test(route)) {
      findings.push(finding({
        severity: 'high',
        title: 'The /scan-url success response is no longer analyzeScan\'s return value verbatim',
        detail: 'A spread, a merge or an added field at this line puts something in the payload that the shape lock above cannot see.',
        evidence: 'app/scan-url/route.ts does not contain `NextResponse.json(result, { headers: allHeaders })`',
        remediation: 'Serialise the analyzeScan result unchanged, or extend the lock deliberately.',
        file: 'app/scan-url/route.ts',
        line: 344,
      }));
    }

    // (e) No Set-Cookie of our own, from any route. Restricted to app/ on
    //     purpose: lib/scanner.ts READS the target's set-cookie headers, which
    //     is the whole tool, and grepping it here would be a false positive
    //     that gets this check switched off.
    checked += 1;
    const cookieWrites = [];
    for (const rel of ['app/scan-url/route.ts', 'app/challenge/route.ts', 'app/ip/route.ts', 'app/event/route.ts', 'app/stats/route.ts']) {
      const src = read(ctx, rel);
      if (/['"]?[Ss]et-[Cc]ookie['"]?\s*:/.test(src) || /cookies\(\)\.set\(/.test(src)) cookieWrites.push(rel);
    }
    if (cookieWrites.length) {
      findings.push(finding({
        severity: 'medium',
        title: 'An API route sets a cookie',
        detail: 'These tools are sold as keeping nothing per visitor, and a cookie on this origin is both a broken claim and a new credential to protect.',
        evidence: `Set-Cookie written in: ${cookieWrites.join(', ')}`,
        remediation: 'Remove it, or declare it in scripts/security/data/compliance-exceptions.json with an owner and an expiry.',
      }));
    }

    // (f) The renderer. React escapes an interpolated string; the risk is a
    //     markup sink, and a field whose render site we cannot find.
    checked += 1;
    const sinks = HTML_SINKS.filter((s) => tool.includes(s));
    if (sinks.length) {
      findings.push(finding({
        severity: 'critical',
        title: `The scanner tool uses a markup sink: ${sinks.join(', ')}`,
        detail: 'Cookie names, cookie domains and third-party hostnames come from the scanned site verbatim. Rendered as text they are inert; handed to a markup sink they are script on our origin.',
        evidence: `components/tools/CookieAnalyzerTool.tsx contains ${sinks.join(', ')}`,
        remediation: 'Render every scan field as JSX text.',
        file: 'components/tools/CookieAnalyzerTool.tsx',
      }));
    }
    for (const site of RENDER_SITES) {
      checked += 1;
      if (site.re.test(tool)) continue;
      findings.push(finding({
        severity: 'medium',
        title: `Could not find where ${site.field} is rendered`,
        detail: `${site.source}. This check asserts the field reaches the DOM as text; if the render site has moved, that assertion is no longer being made and the absence of a finding here would be silence, not safety.`,
        evidence: `components/tools/CookieAnalyzerTool.tsx does not match ${site.re}`,
        remediation: 'Update this pattern to the new render site, after confirming it is still JSX text interpolation.',
        file: 'components/tools/CookieAnalyzerTool.tsx',
      }));
    }

    // (g) inlineTrackers is a LABEL, never the matched text. This is the field
    //     the brief worried about — "an inline tracker string containing HTML".
    //     Today it cannot contain anything but one of six literals, and that is
    //     a property worth pinning rather than a coincidence worth trusting.
    checked += 1;
    const inlineStart = scanner.indexOf('export const INLINE_TRACKERS');
    const inlineEnd = inlineStart === -1 ? -1 : scanner.indexOf('\n];', inlineStart);
    const labels = inlineStart === -1 ? [] : [...scanner.slice(inlineStart, inlineEnd).matchAll(/label:\s*'([^']*)'/g)].map((m) => m[1]);
    const mapsLabel = /INLINE_TRACKERS\s*\.filter\([^)]*\)\s*\.map\(\(i\) => i\.label\)/.test(scanner.replace(/\s+/g, ' ').replace(/ \./g, '.'))
      || /INLINE_TRACKERS\.filter\(\(i\) => i\.pattern\.test\(html\)\)\.map\(\(i\) => i\.label\)/.test(scanner);
    if (!labels.length || !mapsLabel) {
      findings.push(finding({
        severity: 'high',
        title: 'inlineTrackers is no longer a fixed label set',
        detail: 'inlineTrackers is built from INLINE_TRACKERS labels — our own literals. If it ever carried the MATCHED text instead, it would carry a fragment of the attacker\'s page into the response and into the DOM.',
        evidence: `INLINE_TRACKERS labels parsed: ${labels.length}; matched the label-only map: ${mapsLabel}`,
        remediation: 'Keep lib/scanner.ts mapping INLINE_TRACKERS to .label, never to the regex match.',
        file: 'lib/scanner.ts',
        line: 698,
      }));
    }

    // (h) cookies[].raw. Not a vulnerability — it is JSON, it is rendered
    //     nowhere, and the cookie was set by the scanned site to an
    //     unauthenticated fetch of ours, so there is no session in it. It is
    //     recorded because it is the one field of the contract that carries a
    //     cookie VALUE, and because the CSV export was written to exclude
    //     values (it writes cookieName) — a future "let's show the raw line"
    //     would be undoing a decision nobody wrote down.
    checked += 1;
    if (/raw:\s*cookieStr/.test(scanner) && !/\{c\.raw\}/.test(tool)) {
      findings.push(finding({
        severity: 'info',
        title: 'cookies[].raw ships the target\'s Set-Cookie line, including its value, and nothing renders it',
        detail: 'lib/scanner.ts truncates the raw Set-Cookie header to 200 characters and puts it in the response. The tool displays cookieName, category, flags and domain, never raw. It is dead weight in the payload today and the only place a cookie value appears in the contract.',
        evidence: 'lib/scanner.ts sets `raw: cookieStr.length > 200 ? ... : cookieStr`; components/tools/CookieAnalyzerTool.tsx has no {c.raw} render site',
        remediation: 'Either drop `raw` from ScanResult, or keep it with a comment saying it is deliberate and must stay unrendered.',
        file: 'lib/scanner.ts',
        line: 655,
      }));
    }

    return { findings, checked };
  },
});

export default [ssrfTable, originAllowlist, xssContract];
