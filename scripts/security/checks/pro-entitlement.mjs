/**
 * The paid control itself: what <html data-ib-pro> actually decides, and what
 * it must never be asked to decide.
 *
 * These three checks exist because the PRO deployment is the first surface on
 * this site where the words "free" and "paid" are load-bearing, and the whole
 * mechanism is one DOM attribute:
 *
 *   lib/in-app.ts bootInApp()      sets <html data-ib-pro> when, and only when,
 *                                  `source && pro && (bridged || named)`
 *   lib/in-app.ts inAppPro()       reads that attribute, nothing else
 *   components/useUpgradeGate.tsx  shouldGate() === !inAppPro()
 *   guard(action)                  runs `action` for a subscriber, otherwise
 *                                  opens components/ui/UpgradeOverlay.tsx
 *
 * Three actions sit behind it (lib/card-copy.ts GATE_COPY): cookie-csv-export,
 * browser-privacy-rerun, metadata-multi-file. Scanning, pasting, a single
 * photo and the first audit are free BY DESIGN and the overlay copy says so —
 * nothing here treats them as paid.
 *
 * What each check is for:
 *
 *   pro_gate_csv_blocked_without_ib_pro   the wiring is intact: the one paid
 *     action with a real artifact (a CSV file) is reachable only through the
 *     guard, and the guard's decision is still the confirmed attribute.
 *     tests/pro-entitlement.test.ts executes the same boundary against the
 *     real shouldGate()/useUpgradeGate(); this grades the call site those
 *     unit tests cannot see.
 *
 *   pro_gate_not_trusted_as_server_auth   DELIBERATELY FIRES. /api/scan-url
 *     contains no entitlement check of any kind, so the gate is a UX nudge and
 *     not authorisation. That is not a bug to fix here — fixing it means real
 *     auth, which this product does not have anywhere — it is a DEPLOYMENT
 *     REQUIREMENT that has to be in the report every single run so it cannot
 *     be forgotten at cutover. It is keyed on the ABSENCE of a server check,
 *     not on a comment, so the day somebody adds one it stops firing by
 *     itself.
 *
 *   pro_upgrade_url_not_staging_ufile     TARGET-AWARE, on purpose. Pointing
 *     the CTAs at staging.ufile.io is a live owner decision for the present
 *     demo, declared with an owner, a reason and an expiry in
 *     scripts/security/data/compliance-exceptions.json. A blanket ban would
 *     fight a decision somebody made on the record. So: red for a company or
 *     production target, reported-but-green for the declared unexpired demo,
 *     and never a silent pass in either direction.
 *
 * WHAT THESE DO NOT DO. Nothing here touches the live API. /api/scan-url is
 * rate limited to 10 scans/min per /24 with 20 concurrent scans globally on a
 * 2 vCPU box that also serves the team's WordPress, and the claim being graded
 * ("the route has no entitlement check") is a property of the source, which is
 * exactly where it can be read without spending a real user's quota.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

const rel = (root, p) => relative(root, p).split(sep).join('/');

/** Comments are where this repo explains these rules at length; grading prose would flag the explanation as a breach. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

function walk(dir, test, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, test, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/* ------------------------------------------------------------------ *
 * 1. pro_gate_csv_blocked_without_ib_pro
 * ------------------------------------------------------------------ */

const CSV_TOOL = 'components/tools/CookieAnalyzerTool.tsx';
const GATE_HOOK = 'components/useUpgradeGate.tsx';
const IN_APP = 'lib/in-app.ts';

const csvGate = check({
  id: 'pro_gate_csv_blocked_without_ib_pro',
  discipline: 'pentest',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The CSV export — the one gated action that produces a file — is reachable only through the upgrade guard, and that guard still decides on the confirmed <html data-ib-pro> mark.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    // ---- A. the call site: downloadCsv is only ever reached via the guard --
    const toolPath = join(ctx.repoRoot, CSV_TOOL);
    if (!existsSync(toolPath)) throw new Skip(`${CSV_TOOL} is missing — the gated CSV export cannot be graded`);
    const toolSrc = readFileSync(toolPath, 'utf-8');
    const tool = stripComments(toolSrc);
    checked++;

    const guardName = /\bguard\s*:\s*([A-Za-z_$][\w$]*)/.exec(tool)?.[1] || null;
    if (!guardName) {
      findings.push(finding({
        severity: 'high', file: CSV_TOOL,
        title: 'The cookie analyzer no longer destructures a guard from useUpgradeGate',
        detail: 'Export CSV is one of the three paid actions (lib/card-copy.ts GATE_COPY cookie-csv-export). With no guard in this file there is nothing between a visitor without Pro and the download.',
        evidence: `${CSV_TOOL}: no \`guard: <name>\` destructured from useUpgradeGate()`,
        remediation: 'Restore `const { guard: guardExport, overlay: exportGate } = useUpgradeGate({ gate: "cookie-csv-export", ... })` and wrap the export handler in it.',
      }));
    }

    // Every mention of downloadCsv except its own declaration must sit inside
    // a guard call. `guardExport(() => downloadCsv(urlResult))` is the shape
    // today; an onClick that calls it directly is the regression to catch.
    const decl = /\b(?:const|let|function)\s+downloadCsv\b/.exec(tool);
    if (!decl) {
      findings.push(finding({
        severity: 'medium', file: CSV_TOOL,
        title: 'downloadCsv() is gone from the cookie analyzer',
        detail: 'This check grades the gate in front of the CSV download by name. If the download has been renamed or moved, the gate it grades may still be here while guarding nothing.',
        evidence: `${CSV_TOOL}: no \`const downloadCsv\` / \`function downloadCsv\` declaration found`,
        remediation: 'Point this check at the new name, or confirm the export is gone.',
      }));
    } else {
      for (const m of tool.matchAll(/\bdownloadCsv\s*\(/g)) {
        if (m.index < decl.index + 40 && m.index >= decl.index) continue; // the declaration itself
        checked++;
        const before = tool.slice(Math.max(0, m.index - 200), m.index);
        const guarded = guardName && new RegExp(`\\b${guardName}\\s*\\(`).test(before);
        if (!guarded) {
          findings.push(finding({
            severity: 'high', file: CSV_TOOL, line: lineOf(tool, m.index),
            title: 'The CSV export is callable without passing the upgrade gate',
            detail: 'cookie-csv-export is a paid action. This call reaches downloadCsv() without going through the guard, so a visitor with no Pro mark gets the file. The scan itself is free and full by design; only the download is gated.',
            evidence: `${CSV_TOOL}:${lineOf(tool, m.index)}: …${before.slice(-90).replace(/\s+/g, ' ')}downloadCsv(`,
            remediation: `Wrap it: onClick={${guardName || 'guardExport'}(() => downloadCsv(result))}.`,
          }));
        }
      }
    }

    // The overlay the guard opens has to actually be rendered, or "the gate
    // shows" is a state change nobody ever sees.
    checked++;
    const overlayName = /\boverlay\s*:\s*([A-Za-z_$][\w$]*)/.exec(tool)?.[1] || null;
    if (!overlayName || !new RegExp(`\\{\\s*${overlayName}\\s*\\}`).test(tool)) {
      findings.push(finding({
        severity: 'medium', file: CSV_TOOL,
        title: 'The cookie analyzer never renders the upgrade overlay it opens',
        detail: 'useUpgradeGate returns { guard, overlay }. The guard sets state on the overlay element; if that element is not in the tree, a blocked export is a click that silently does nothing at all — which reads as a broken button, not as a paid feature.',
        evidence: `${CSV_TOOL}: overlay destructured as ${overlayName || '(nothing)'}; no \`{${overlayName || 'exportGate'}}\` in the returned JSX`,
        remediation: 'Render the overlay element the hook returns.',
      }));
    }

    // ---- B. the decision is still the confirmed attribute ------------------
    const hookPath = join(ctx.repoRoot, GATE_HOOK);
    if (!existsSync(hookPath)) throw new Skip(`${GATE_HOOK} is missing — the gate decision cannot be graded`);
    const hook = stripComments(readFileSync(hookPath, 'utf-8'));
    checked++;
    if (!/function\s+shouldGate\s*\(\s*\)\s*:\s*boolean\s*\{\s*return\s+!inAppPro\s*\(\s*\)\s*;?\s*\}/.test(hook)) {
      findings.push(finding({
        severity: 'high', file: GATE_HOOK,
        title: 'shouldGate() is no longer exactly !inAppPro()',
        detail: 'The CSS that hides the upgrade bands (app/globals.css) and the JavaScript that opens the gates deliberately read the SAME attribute. A second, different rule in JavaScript is how the two drift apart — one surface treating a visitor as a subscriber while the other does not.',
        evidence: `${GATE_HOOK}: shouldGate() body is not \`return !inAppPro();\``,
        remediation: 'Keep the decision a single read of <html data-ib-pro> via inAppPro().',
      }));
    }
    checked++;
    if (!/if\s*\(\s*!shouldGate\s*\(\s*\)\s*\)\s*\{\s*action\s*\(\s*\.\.\.a\s*\)\s*;\s*return\s*;?\s*\}/.test(hook)) {
      findings.push(finding({
        severity: 'high', file: GATE_HOOK,
        title: 'The guard no longer runs the action only for a confirmed subscriber',
        detail: 'guard() is the single place a paid action is either performed or replaced by the ask. Its shape — run untouched when !shouldGate(), otherwise open the overlay and return — is what makes "downloads nothing" true for everybody else.',
        evidence: `${GATE_HOOK}: no \`if (!shouldGate()) { action(...a); return; }\` in guard()`,
        remediation: 'Restore the early return, and keep the overlay branch after it.',
      }));
    }

    const inAppPath = join(ctx.repoRoot, IN_APP);
    if (!existsSync(inAppPath)) throw new Skip(`${IN_APP} is missing — inAppPro() cannot be graded`);
    const inApp = stripComments(readFileSync(inAppPath, 'utf-8'));
    checked++;
    if (!/hasAttribute\('data-ib-pro'\)/.test(inApp)) {
      findings.push(finding({
        severity: 'high', file: IN_APP,
        title: 'inAppPro() no longer reads <html data-ib-pro>',
        detail: 'Every Pro-aware surface on the site — the gates, the CSS that hides the upgrade bands, the in-app labelling — resolves to this one attribute. If inAppPro() now derives the answer some other way, the surfaces can disagree about who has paid.',
        evidence: `${IN_APP}: no document.documentElement.hasAttribute('data-ib-pro') in inAppPro()`,
        remediation: 'Keep inAppPro() a single attribute read.',
      }));
    }

    return { findings, checked };
  },
});

/* ------------------------------------------------------------------ *
 * 2. pro_gate_not_trusted_as_server_auth   (fires by design)
 * ------------------------------------------------------------------ */

/**
 * What a REAL server-side entitlement check would look like here.
 *
 * Deliberately NOT in this list: `request.headers.get('authorization')` in
 * app/scan-url/route.ts. That is the Altcha proof-of-work solution — an
 * anti-abuse cost, paid identically by everyone, subscriber or not. Counting
 * it would let this finding stop firing because of a control that grants
 * nothing, which is the precise way a check like this becomes decorative.
 */
const ENTITLEMENT_MARKERS = [
  { re: /\brequirePro\b/, name: 'requirePro(' },
  { re: /\bverifyPro\b/, name: 'verifyPro(' },
  { re: /\bassertPro\b/, name: 'assertPro(' },
  { re: /\bisProRequest\b/, name: 'isProRequest(' },
  { re: /\bentitlement/i, name: 'an entitlement lookup' },
  { re: /\bsubscription\b/i, name: 'a subscription lookup' },
  { re: /headers\.get\(\s*['"]x-ib-pro['"]/i, name: "headers.get('x-ib-pro')" },
  { re: /\bdata-ib-pro\b/, name: 'data-ib-pro' },
  { re: /\binAppPro\b/, name: 'inAppPro()' },
  { re: /\bIS_PRO_DEPLOYMENT\b/, name: 'IS_PRO_DEPLOYMENT' },
];

const SCAN_ROUTE = 'app/scan-url/route.ts';

const notServerAuth = check({
  id: 'pro_gate_not_trusted_as_server_auth',
  discipline: 'pentest',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'States, in the report, that <html data-ib-pro> is a UX gate and not authorisation: /api/scan-url performs no entitlement check, so an internal deployment needs SSO or network ACLs in front of /resources-pro AND /api.',
  async run(ctx) {
    const appDir = join(ctx.repoRoot, 'app');
    if (!existsSync(appDir)) throw new Skip('no app/ directory — there are no routes to grade');
    const routes = walk(appDir, (n) => n === 'route.ts' || n === 'route.tsx');
    if (!routes.length) throw new Skip('app/ holds no route handlers — nothing to grade');

    const findings = [];
    let checked = 0;
    const withCheck = [];
    const withoutCheck = [];

    for (const abs of routes) {
      checked++;
      const r = rel(ctx.repoRoot, abs);
      const code = stripComments(readFileSync(abs, 'utf-8'));
      const hit = ENTITLEMENT_MARKERS.find((k) => k.re.test(code));
      if (hit) withCheck.push(`${r} (${hit.name})`);
      else withoutCheck.push(r);
    }

    // Keyed on the ABSENCE. Add a real check to the scan route and this stops
    // firing on its own; no comment, allowlist or suppression can silence it.
    const scanRouteHasCheck = withCheck.some((s) => s.startsWith(SCAN_ROUTE));
    if (!scanRouteHasCheck) {
      const scanAbs = join(ctx.repoRoot, SCAN_ROUTE);
      const scanSrc = existsSync(scanAbs) ? readFileSync(scanAbs, 'utf-8') : '';
      const controls = [
        /rateLimit\s*\(/.test(scanSrc) ? 'rateLimit()' : null,
        /verifySolution\s*\(/.test(scanSrc) ? 'verifySolution() (proof-of-work)' : null,
        /corsHeadersFor\s*\(/.test(scanSrc) ? 'corsHeadersFor() (origin gate)' : null,
      ].filter(Boolean);
      findings.push(finding({
        severity: 'medium', file: SCAN_ROUTE,
        title: 'data-ib-pro is a UX gate, not authorisation — /api/scan-url has no entitlement check at all',
        detail:
          'The paid control on this product is entirely client-side: lib/in-app.ts sets <html data-ib-pro>, components/useUpgradeGate.tsx reads it, and that is the whole mechanism. A scripted client — curl, a copied fetch() out of devtools, anything that is not a browser running our page — calls /api/scan-url with no attribute anywhere in the request and is served exactly like a subscriber, because there is nothing in the request that could carry the claim and nothing in the route that would read it. '
          + 'This is NOT a defect to patch here. Enforcing it server-side means real authentication, which this product does not have on any surface, and inventing a header the client sets would move the same self-asserted claim one layer down. '
          + 'It is a DEPLOYMENT REQUIREMENT: an internal or company deployment must put SSO or network ACLs in front of /resources-pro AND in front of /api, because putting them in front of only the pages leaves every API the pages call wide open. Until that is done, treat everything behind the gate as public — which it currently is, and which is tolerable only because all three gated actions (lib/card-copy.ts GATE_COPY) are client-side reformatting of data the visitor already has on screen.',
        evidence:
          `${SCAN_ROUTE}: 0 matches for ${ENTITLEMENT_MARKERS.map((m) => m.name).join(' / ')} across ${scanSrc.split('\n').length} lines. `
          + `The controls it DOES apply are ${controls.length ? controls.join(', ') : '(none found)'} — anti-abuse, paid identically by every caller, subscriber or not. `
          + `${withoutCheck.length} of ${routes.length} route handlers have no entitlement check: ${withoutCheck.join(', ')}.`,
        remediation:
          'At cutover: put SSO (or an IP allowlist / VPN-only listener) in front of both /resources-pro and /api on the company deployment, and record it in DEPLOYMENT.md. If instead a server-side entitlement check is ever added to this route, this finding stops firing by itself — it is keyed on the absence, not on a comment.',
      }));
    }

    // The same boundary, stated from the other end: who can set the mark.
    // A page script in our own origin can. That is acceptable ONLY while the
    // mark grants nothing but wording — so the statement and the condition it
    // depends on are reported together rather than left implicit.
    const inAppPath = join(ctx.repoRoot, IN_APP);
    if (existsSync(inAppPath)) {
      checked++;
      const inApp = readFileSync(inAppPath, 'utf-8');
      const acceptsAnyObject = /typeof\s+b\s*===\s*'object'\s*&&\s*b\s*!==\s*null/.test(inApp);
      const uaAccepted = /\/incognito \?browser\/i/.test(inApp);
      if (acceptsAnyObject || uaAccepted) {
        findings.push(finding({
          severity: 'info', file: IN_APP,
          title: 'Any script running in our origin can self-grant the Pro mark (accepted, because the mark grants nothing)',
          detail:
            'bootInApp() accepts the app\'s claim when window.IncognitoBrowserApp is any object, or when the user agent matches /incognito ?browser/i. Both are things only the real app can produce IN A REAL BROWSER TAB — but neither is unforgeable on the open web: a page script in our origin (an injected script, a compromised dependency, a devtools paste) can set window.IncognitoBrowserApp = { postMessage(){} } before the boot script runs and be treated as a subscriber for the rest of that tab. '
            + 'The honest answer is that this is ACCEPTABLE AS IT STANDS, and the reason is narrow: the mark decides wording and hides upgrade asks, and the three actions behind it are a CSV of cookies already listed on the page, a re-run of an audit that only reads this browser, and a second local photo. Self-granting buys a visitor nothing they could not already have, and costs the server nothing. '
            + 'It stops being acceptable the moment anything behind the gate costs the server work, returns data the free tier does not hold, or is billed. At that point the mark would have to be replaced by a server-verified entitlement, not hardened — a stricter bridge handshake would still be a claim made by the client.',
          evidence:
            `${IN_APP}: onBridge() accepts \`typeof b === 'object' && b !== null\`${uaAccepted ? ", and named() accepts a user agent matching /incognito ?browser/i" : ''}; `
            + 'both are set by the page\'s own environment, so any script with execution in our origin satisfies them. Gated actions today: cookie-csv-export, browser-privacy-rerun, metadata-multi-file (lib/card-copy.ts GATE_COPY) — all client-side.',
          remediation: 'No change while the gate is copy-only. If a gated action ever reaches the server or is billed, do not harden this handshake — move the decision to the server.',
        }));
      }
    }

    return { findings, checked };
  },
});

/* ------------------------------------------------------------------ *
 * 3. pro_upgrade_url_not_staging_ufile   (target-aware)
 * ------------------------------------------------------------------ */

const PLAY_PACKAGE = 'com.androidbull.incognito.browser';
const APP_SCHEME_URL = 'incognitobrowser://upgrade';
const UPGRADE_BUTTONS = 'components/UpgradeButtons.tsx';
const EXCEPTIONS = 'scripts/security/data/compliance-exceptions.json';

/** Hosts that mean "this build is going to the company's own production site". */
const COMPANY_HOSTS = new Set(['incognitobrowser.io', 'www.incognitobrowser.io']);
const COMPANY_WORDS = new Set(['company', 'production', 'prod', 'internal', 'cutover']);
const DEMO_WORDS = new Set(['demo', 'droplet', 'staging', 'dev', 'local']);

/**
 * Which deploy this run is grading.
 *
 * SECURITY_TARGET wins when it is set; otherwise the target origin decides,
 * because that is already what the runner prints on its header line
 * (`--origin https://incognitobrowser.io` is how a company deploy is graded).
 * An unrecognised SECURITY_TARGET grades as a company deploy: guessing "demo"
 * from a word nobody defined is the guess that hides the finding.
 */
function resolveTarget(ctx) {
  const env = String(process.env.SECURITY_TARGET || '').trim().toLowerCase();
  if (COMPANY_WORDS.has(env)) return { company: true, why: `SECURITY_TARGET=${env}` };
  if (DEMO_WORDS.has(env)) return { company: false, why: `SECURITY_TARGET=${env}` };
  if (env) return { company: true, why: `SECURITY_TARGET=${env} is not a target this check knows — grading as a company deploy, which is the strict side` };
  let host = '';
  try { host = new URL(ctx.origin).host.toLowerCase(); } catch { /* not a URL */ }
  if (COMPANY_HOSTS.has(host)) return { company: true, why: `target origin ${ctx.origin} is a company production host` };
  return { company: false, why: `target origin ${ctx.origin} is not a company production host and SECURITY_TARGET is unset` };
}

/** The declared, unexpired demo destinations, with the whole entry for the report. */
function declaredDestinations(ctx) {
  const p = join(ctx.repoRoot, EXCEPTIONS);
  if (!existsSync(p)) return { map: new Map(), expired: [] };
  let j;
  try { j = JSON.parse(readFileSync(p, 'utf-8')); } catch { return { map: new Map(), expired: [] }; }
  const today = new Date().toISOString().slice(0, 10);
  const map = new Map();
  const expired = [];
  for (const d of j.upgradeDestinations || []) {
    if (!d || !d.host || !d.owner || !d.reason || !d.expires) continue;
    if (d.expires >= today) map.set(String(d.host).toLowerCase(), d);
    else expired.push(d);
  }
  return { map, expired };
}

const upgradeDestination = check({
  id: 'pro_upgrade_url_not_staging_ufile',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'A company or production deploy fails if the demo paywall host is anywhere in the bundle; the declared, unexpired demo stays green but is reported every run. The Play package and the single custom scheme are asserted in both.',
  async run(ctx) {
    const findings = [];
    let checked = 0;
    const target = resolveTarget(ctx);

    // ---- the switch's current value, read from source, never imported -----
    const btnPath = join(ctx.repoRoot, UPGRADE_BUTTONS);
    if (!existsSync(btnPath)) throw new Skip(`${UPGRADE_BUTTONS} is missing — the upgrade destination cannot be graded`);
    const btnSrc = readFileSync(btnPath, 'utf-8');
    checked++;
    const demoUrl = /export\s+const\s+DEMO_UPGRADE_URL\s*=\s*['"]([^'"]*)['"]/.exec(btnSrc)?.[1];
    if (demoUrl === undefined) {
      findings.push(finding({
        severity: 'medium', file: UPGRADE_BUTTONS,
        title: 'DEMO_UPGRADE_URL is no longer a readable string literal',
        detail: 'This check reads the switch out of the source rather than importing it, because an import compares the constant to itself and passes for any value ever assigned. If the switch has become computed, that reading is gone and so is the one-line rollback the file documents.',
        evidence: `${UPGRADE_BUTTONS}: no \`export const DEMO_UPGRADE_URL = '…'\` literal found`,
        remediation: 'Keep it a plain string literal, empty when off.',
      }));
    }

    let demoHost = null;
    if (demoUrl) {
      try { demoHost = new URL(demoUrl).host.toLowerCase(); } catch { demoHost = null; }
    }
    // The id names this host, so it is graded whether or not the switch still
    // points there: a stale copy left in a chunk is the realistic half-revert.
    const hosts = new Set(['staging.ufile.io']);
    if (demoHost) hosts.add(demoHost);

    const { map: declared, expired } = declaredDestinations(ctx);

    // ---- where the host actually appears ---------------------------------
    const roots = ['out', 'out-pro'].map((d) => join(ctx.repoRoot, d)).filter((d) => existsSync(d) && statSync(d).isDirectory());
    const artifacts = roots.flatMap((r) => walk(r, (n) => n.endsWith('.html') || n.endsWith('.js')));
    const sources = ['app', 'components', 'lib']
      .map((d) => join(ctx.repoRoot, d))
      .filter((d) => existsSync(d))
      .flatMap((d) => walk(d, (n) => /\.(ts|tsx|js|jsx|mjs)$/.test(n)));

    const occurrences = [];
    for (const abs of [...sources, ...artifacts]) {
      checked++;
      const text = readFileSync(abs, 'utf-8');
      for (const h of hosts) {
        const i = text.indexOf(h);
        if (i < 0) continue;
        const n = text.split(h).length - 1;
        occurrences.push({
          file: rel(ctx.repoRoot, abs),
          host: h,
          count: n,
          line: abs.endsWith('.js') || abs.endsWith('.html') ? null : lineOf(text, i),
          built: abs.startsWith(join(ctx.repoRoot, 'out')),
        });
      }
    }
    if (!artifacts.length) {
      // Source-only is a partial grade and says so rather than reading green.
      findings.push(finding({
        severity: 'info', file: null,
        title: 'No built site in out/ or out-pro/ — this run graded source only',
        detail: 'The bundle is what ships. A source-only grade cannot see a stale chunk left behind by a partial revert, which is the realistic half-fix this check exists to catch.',
        evidence: `no out/ or out-pro/ directory under ${ctx.repoRoot}; graded ${sources.length} source files instead`,
        remediation: 'Run `npm run build` before the pre-deploy run.',
      }));
    }

    const inBundle = occurrences.filter((o) => o.built);
    const shown = occurrences.slice(0, 8).map((o) => `${o.file}${o.line ? ':' + o.line : ''} ×${o.count} (${o.host})`).join('; ');
    const total = occurrences.reduce((a, o) => a + o.count, 0);

    if (occurrences.length && target.company) {
      findings.push(finding({
        severity: 'high', file: occurrences[0].file, line: occurrences[0].line,
        title: `A company deploy still carries the demo paywall host (${[...new Set(occurrences.map((o) => o.host))].join(', ')})`,
        detail:
          'The staging.ufile.io demo is a real, declared owner decision — for the DEMO. On a company or production deploy it is not: every buyer-intent click leaves for another product\'s staging paywall, no Play install referrer is sent so the click is lost to attribution, and the footnote under the button ("Pro is part of the free Incognito Browser app") stops describing where the tap goes. These pages also render inside the Android app\'s WebView, so a purchase CTA for a digital good that leaves Play Billing is a Play policy question as well as a truthfulness one. '
          + `The declaration in ${EXCEPTIONS} does not cover this target and is not treated as covering it.`,
        evidence:
          `target: ${target.why}. ${total} occurrence(s) across ${occurrences.length} file(s)${inBundle.length ? `, ${inBundle.length} of them in the built bundle` : ''}: ${shown}${occurrences.length > 8 ? ` … +${occurrences.length - 8} more` : ''}`,
        remediation: `Set ${UPGRADE_BUTTONS} DEMO_UPGRADE_URL back to '' and rebuild BOTH sites, then confirm the chunk hashes changed. That one line is the whole rollback.`,
      }));
    } else if (occurrences.length) {
      const undeclared = [...new Set(occurrences.map((o) => o.host))].filter((h) => !declared.has(h));
      if (undeclared.length) {
        const wasExpired = expired.filter((d) => undeclared.includes(String(d.host).toLowerCase()));
        findings.push(finding({
          severity: 'high', file: occurrences[0].file, line: occurrences[0].line,
          title: `Upgrade CTAs point at ${undeclared.join(', ')} with no live declaration`,
          detail:
            'A demo destination is forgiven only while somebody has written down who decided it, why, and when it ends. An expired entry fails exactly like a missing one — that is the entire point of the end date: a demo that cannot expire is not a demo, it is the product.',
          evidence:
            `target: ${target.why}. ${EXCEPTIONS} has no unexpired entry for ${undeclared.join(', ')}`
            + `${wasExpired.length ? ` (expired ${wasExpired.map((d) => `${d.host} on ${d.expires}`).join(', ')}; today is ${new Date().toISOString().slice(0, 10)})` : ''}. `
            + `${total} occurrence(s): ${shown}`,
          remediation: `Either clear DEMO_UPGRADE_URL and rebuild, or extend the entry in ${EXCEPTIONS} with a named owner, a reason and a new end date.`,
        }));
      } else {
        // Green — but never silent. The decision, its owner and its clock are
        // printed every single run, which is what makes the expiry real.
        const days = (h) => Math.ceil((Date.parse(declared.get(h).expires + 'T23:59:59Z') - Date.now()) / 86_400_000);
        const lines = [...new Set(occurrences.map((o) => o.host))]
          .map((h) => `${h}: owner=${declared.get(h).owner}, expires ${declared.get(h).expires} (${days(h)} day(s) left)`);
        findings.push(finding({
          severity: 'info', file: UPGRADE_BUTTONS,
          title: 'Upgrade CTAs point at the declared demo paywall, not Play (current owner decision)',
          detail:
            'Reported, not flagged. This is the live demo switch, declared with an owner, a reason and an end date, and this check is target-aware on purpose: it goes red for a company or production target and stays green here. It is printed anyway so the decision and its clock are visible in every report rather than only in a JSON file nobody opens — and so that nobody has to guess whether the suite noticed.',
          evidence: `target: ${target.why}. ${lines.join(' | ')}. ${total} occurrence(s) across ${occurrences.length} file(s)${inBundle.length ? `, ${inBundle.length} in the built bundle` : ''}: ${shown}${occurrences.length > 8 ? ` … +${occurrences.length - 8} more` : ''}`,
          remediation: `Before a company deploy: clear DEMO_UPGRADE_URL in ${UPGRADE_BUTTONS} and rebuild, or run this suite with SECURITY_TARGET=company to see the deploy-blocking view.`,
        }));
      }
    }

    // ---- the Play package, and the one custom scheme ----------------------
    const playPath = join(ctx.repoRoot, 'lib', 'play.ts');
    if (!existsSync(playPath)) throw new Skip('lib/play.ts is missing — the Play package cannot be graded');
    const playSrc = readFileSync(playPath, 'utf-8');
    checked++;
    const pkg = /export\s+const\s+PLAY_PACKAGE\s*=\s*['"]([^'"]+)['"]/.exec(playSrc)?.[1];
    if (pkg !== PLAY_PACKAGE) {
      findings.push(finding({
        severity: 'high', file: 'lib/play.ts',
        title: `The Play package is ${pkg || '(unreadable)'}, not ${PLAY_PACKAGE}`,
        detail: 'Every install and upgrade link on both sites is built from this one constant. A wrong package sends buyer-intent traffic to somebody else\'s listing, and the install referrer with it.',
        evidence: `lib/play.ts: PLAY_PACKAGE = ${pkg === undefined ? '(no string literal found)' : `'${pkg}'`}`,
        remediation: `Restore PLAY_PACKAGE = '${PLAY_PACKAGE}'.`,
      }));
    }
    // Every Play URL that shipped names the same package.
    for (const abs of artifacts.filter((f) => f.endsWith('.html'))) {
      const html = readFileSync(abs, 'utf-8');
      for (const m of html.matchAll(/play\.google\.com\/store\/apps\/details\?id=([A-Za-z0-9_.%]+)/g)) {
        checked++;
        const id = decodeURIComponent(m[1]);
        if (id !== PLAY_PACKAGE) {
          findings.push(finding({
            severity: 'high', file: rel(ctx.repoRoot, abs),
            title: `A shipped Play link names ${id}, not our package`,
            detail: 'The built page sends this visitor to a different app listing than the one this product is.',
            evidence: `${rel(ctx.repoRoot, abs)}: play.google.com/store/apps/details?id=${id}`,
            remediation: 'Build every Play link through lib/play.ts playUrl().',
          }));
        }
      }
    }

    // The only custom scheme the app ever navigates to.
    checked++;
    const inAppSrc = existsSync(join(ctx.repoRoot, IN_APP)) ? readFileSync(join(ctx.repoRoot, IN_APP), 'utf-8') : '';
    const appUrl = /export\s+const\s+APP_UPGRADE_URL\s*=\s*['"]([^'"]+)['"]/.exec(inAppSrc)?.[1];
    if (appUrl !== APP_SCHEME_URL) {
      findings.push(finding({
        severity: 'high', file: IN_APP,
        title: `The app upgrade scheme is ${appUrl || '(unreadable)'}, not ${APP_SCHEME_URL}`,
        detail: 'Inside the app, an upgrade tap with no JavaScript bridge navigates to this URL. Only the Incognito Browser app registers this scheme; any other scheme is either dead (nothing handles it) or hands the tap to whatever app does.',
        evidence: `${IN_APP}: APP_UPGRADE_URL = ${appUrl === undefined ? '(no string literal found)' : `'${appUrl}'`}`,
        remediation: `Restore APP_UPGRADE_URL = '${APP_SCHEME_URL}'.`,
      }));
    }
    // And no OTHER custom scheme is used to navigate anywhere. chrome:// in
    // components/tools/PermissionCheckerTool.tsx is deliberately not this: it
    // is an address printed for the reader to type, never a link — web pages
    // cannot open chrome:// at all, which that file says in its own comment.
    for (const abs of sources) {
      const src = stripComments(readFileSync(abs, 'utf-8'));
      for (const m of src.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9+.-]*):\/\/[^'"`\s]*/g)) {
        const scheme = m[1].toLowerCase();
        if (scheme === 'http' || scheme === 'https') continue;
        checked++;
        const literal = m[0].slice(1);
        if (literal.startsWith(APP_SCHEME_URL)) continue;
        const lineText = src.split('\n')[lineOf(src, m.index) - 1] || '';
        const navigable = /\bhref\b|\blocation\b|window\.open|\bredirect\b|\bnavigate\b/.test(lineText);
        if (!navigable) continue; // printed for the reader, not followed
        findings.push(finding({
          severity: 'medium', file: rel(ctx.repoRoot, abs), line: lineOf(src, m.index),
          title: `A second custom scheme is navigated to: ${scheme}://`,
          detail: `${APP_SCHEME_URL} is the only scheme the Incognito Browser app has agreed to handle (IN-APP-BRIDGE.md). Navigating to any other custom scheme either does nothing or hands the tap to whichever app claimed it — on a page that is about privacy, from a button the visitor thinks is an upgrade.`,
          evidence: `${rel(ctx.repoRoot, abs)}:${lineOf(src, m.index)}: ${literal.slice(0, 120)}`,
          remediation: `Use ${APP_SCHEME_URL} (via appUpgradeUrl()) or an ordinary https link.`,
        }));
      }
    }

    return { findings, checked };
  },
});

export default [csvGate, notServerAuth, upgradeDestination];
