/**
 * The five things that have to be true about the HOST the Pro site is served
 * from — asked about the company server the owner actually cares about, not
 * about this droplet.
 *
 * WHY THESE ARE TARGET-AWARE AND NOT BLANKET BANS.
 * Every check in this file grades a property that is FINE on the public demo
 * and DANGEROUS on a company deployment: WordPress sharing the vhost, WebRTC
 * ICE going to Cloudflare and Google, /resources-pro answering anyone who asks,
 * and PRO_BASE_URL/FREE_BASE_URL/ALLOWED_ORIGINS naming a nip.io host. Graded
 * as blanket failures they would be red every single night against a state the
 * owner chose on purpose, and a suite that is always red is one nobody reads —
 * the same trap scripts/security/data/compliance-exceptions.json exists to keep
 * the upgrade-CTA check out of. Graded as nothing they would be silent on the
 * day someone points a company hostname at this code, which is the failure this
 * suite was written after.
 *
 * So each finding is REPORTED ON BOTH TARGETS and SEVERITY-GRADED BY TARGET:
 * medium on the demo, where the finding text IS the cutover requirement, and
 * high/critical on a company target, where the same sentence is a live hole.
 * Nothing here is ever silently suppressed. How the target is decided:
 *
 *   IB_DEPLOY_TARGET=company|demo   explicit, wins over everything
 *   IB_COMPANY_HOST=<host>          set ⇒ company
 *   otherwise                       the --origin/.secrets host: *.nip.io or a
 *                                   dashed-IP host is the demo, ANYTHING ELSE
 *                                   is treated as company (the strict side —
 *                                   an unrecognised host gets the harder grade,
 *                                   never the softer one).
 *
 * WHERE THE PROBER IS STANDING. pro_vhost_noindex_but_no_login is an in-band
 * prober: it asks the vhost a question and reads the answer. The two controls
 * the owner names first — a corporate VPN and an IP allowlist — work by making
 * the host unreachable from OUTSIDE, and from inside the perimeter they are
 * invisible to it. Run the nightly from a runner on the company network against
 * a correctly VPN-gated host and it would report "no authentication at all" at
 * critical every night, which is how a check gets switched off. So the runner
 * declares where it stands and the check grades what it can actually see:
 *
 *   IB_PROBE_VANTAGE=outside   the runner is on the public internet. An open
 *                              answer from a company host is a live hole.
 *   IB_PROBE_VANTAGE=inside    the runner is on the company network. An open
 *                              answer proves only that nothing in-band gates
 *                              the surface; a VPN or allowlist may still be in
 *                              front of it. Graded medium, with that caveat in
 *                              the title, never silently dropped.
 *   unset                      'unknown': graded as outside (the strict side),
 *                              and the finding says which declaration it needs.
 *
 * AND WHAT THE REPO DECLARES. The same check scans every config-shaped file in
 * the repo (.conf, .htaccess, .sh) for an auth or allow directive. That scan is
 * an ESCALATOR, never a suppressor: an open company surface with no such
 * directive anywhere is critical (nothing this repo ships would close the door
 * either); with one it is high (there is at least something to deploy, and it
 * is not in force). It never turns a finding off — a directive in a file is not
 * a gate on a vhost, and the earlier version of this check that merely narrated
 * the value into the evidence string was reported as a gap for exactly that.
 *
 * PRODUCTION SAFETY. Seven single GETs per nightly run across the whole file,
 * paced, redirect:manual, no credentials, no POST, nothing that reaches
 * /scan-url or /challenge and nothing that touches Redis. The API limits
 * (10 scans/min per /24, 30 challenges/min, 20 concurrent scans) are nowhere
 * near in play, so none of these needs opt-in. The WordPress probes are GETs on
 * the team's public front door and are never followed by a POST: we are guests
 * in that web root, exactly as dast-wordpress-untouched puts it. The one ssh
 * check (wp_not_on_pro_machine) is three read-only listings: `ls`, `ls -d` and
 * `systemctl is-active`. Nothing writes, nothing reloads.
 *
 * WHAT EACH CHECK REFUSES TO DO. Every one of them throws Skip rather than
 * report a clean pass over nothing: a vhost that did not answer, a source file
 * that is not there, a constant that could not be parsed. `checked` is the real
 * count of things inspected.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { pace, httpOnce } from './dast-shared.mjs';

// ---------------------------------------------------------------------------
// Which deployment are we grading?
// ---------------------------------------------------------------------------

/**
 * Hosts that are the present PUBLIC DEMO. `206-189-186-34.nip.io` is both a
 * nip.io name and a dashed-IP one; either pattern alone identifies it, and the
 * second also catches the sslip.io/traefik.me style names a future demo box
 * might use.
 */
const DEMO_HOST_RE = /(?:^|\.)nip\.io(?::\d+)?$|^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\./;

/**
 * Where the runner stands relative to the company perimeter. Read beside the
 * target, never inferred: a prober cannot tell from a 200 whether there is a
 * VPN behind it. Anything other than the two declared values is 'unknown'.
 */
function probeVantage() {
  const v = String(process.env.IB_PROBE_VANTAGE || '').trim().toLowerCase();
  return v === 'outside' || v === 'inside' ? v : 'unknown';
}

/**
 * Exported (not only used here) so a check in another file can grade the same
 * property by the same rule instead of carrying its own copy of it.
 * cnast-api-log-no-ip imports it; dast-wp-user-enum predates the export.
 */
export function deployTarget(ctx) {
  let host = '';
  try { host = new URL(ctx.origin).host.toLowerCase(); } catch { host = String(ctx.origin || '').toLowerCase(); }
  const vantage = probeVantage();

  const declared = String(process.env.IB_DEPLOY_TARGET || '').trim().toLowerCase();
  if (declared === 'demo' || declared === 'company') {
    return { kind: declared, host, vantage, companyHost: declared === 'company' ? (String(process.env.IB_COMPANY_HOST || '').trim().toLowerCase() || host) : null, why: `IB_DEPLOY_TARGET=${declared}` };
  }
  const companyHost = String(process.env.IB_COMPANY_HOST || '').trim().toLowerCase() || null;
  if (companyHost) return { kind: 'company', host, vantage, companyHost, why: `IB_COMPANY_HOST=${companyHost}` };
  if (DEMO_HOST_RE.test(host)) return { kind: 'demo', host, vantage, companyHost: null, why: `target host ${host} is the public demo droplet` };
  return { kind: 'company', host, vantage, companyHost: host || null, why: `target host ${host || '(unparsed origin)'} is not the demo droplet, so it is graded as a company deployment` };
}

/** Severity for a property that is accepted on the demo and not on a company box. */
export const sev = (t, demo, company) => (t.kind === 'company' ? company : demo);

/** Prefix that makes the demo-target grade legible in the report. */
export const cutover = (t) =>
  t.kind === 'company'
    ? 'LIVE ON THIS TARGET. '
    : `DEPLOY REQUIREMENT, graded medium because this run is pointed at the public demo (${t.why}) where it is a deliberate state, not a defect. The same finding is graded high/critical the moment this suite runs against a company host — the text below is what has to change at cutover. `;

/** Header read that works for both ctx.http (Headers) and a plain object. */
const hdr = (res, name) => {
  const k = name.toLowerCase();
  if (res.headers && typeof res.headers.get === 'function') return res.headers.get(k) || '';
  return (res.headers && res.headers[k]) || '';
};

/** 1-based line number of a character offset. */
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

// ===========================================================================
// 1. wp_not_on_pro_vhost
// ===========================================================================

/**
 * On this droplet the Pro site is a folder inside the team's WordPress web root
 * (/var/www/html/resources-pro), so these WILL answer and the findings below
 * are expected. That is the point: the finding text is the requirement for the
 * company box, where the Pro vhost has to be its own virtual host with no PHP
 * application under it at all.
 */
const WP_PATHS = [
  { path: '/wp-login.php', why: 'the sign-in form — a password-guessing surface and, through its error text, a username oracle' },
  { path: '/xmlrpc.php', why: 'XML-RPC: system.multicall turns credential stuffing into one request per hundred guesses, and pingback gives an unauthenticated caller an SSRF primitive inside whatever network this box sits in' },
  { path: '/wp-json/', why: 'the REST API: /wp-json/wp/v2/users enumerates author accounts on a default install' },
  { path: '/wp-admin/', why: 'the admin surface; even a redirect to the login form confirms the application is mounted here' },
];

/** Strings that only a WordPress response carries. */
const WP_MARKERS = [
  'XML-RPC server accepts POST requests only',
  'wp-login.php',
  'wp-includes',
  '/wp-json/',
  'wordpress',
];

/**
 * Everything in a response that only WordPress produces. The headers matter as
 * much as the body: /wp-admin/ answers 302 with an EMPTY body and
 * `X-Redirect-By: WordPress`, pointing at https://206.189.186.34/wp-login.php —
 * a different host string than the vhost, so a host-comparison alone reads that
 * as "redirected away" and silently drops the most obvious hit of the four.
 * That was not hypothetical: the first version of this check reported 3 of 4.
 */
function wpSignals(res) {
  const sig = [];
  const by = hdr(res, 'x-redirect-by');
  if (/wordpress/i.test(by)) sig.push(`X-Redirect-By: ${by}`);
  const loc = hdr(res, 'location');
  if (/\/wp-(login|admin|json)|xmlrpc\.php/i.test(loc)) sig.push(`Location: ${loc}`);
  const link = hdr(res, 'link');
  if (/wp-json/i.test(link)) sig.push(`Link: ${link.slice(0, 120)}`);
  const body = (res.text || '').slice(0, 4000).toLowerCase();
  const m = WP_MARKERS.find((x) => body.includes(x.toLowerCase()));
  if (m) sig.push(`body contains "${m}"`);
  return sig;
}

function classify(res, vhost) {
  if (!res.ok) return { state: 'unreachable', signals: [] };
  const signals = wpSignals(res);
  if (res.status === 404 || res.status === 410) return { state: 'absent', signals };
  if (res.status >= 300 && res.status < 400) {
    const loc = hdr(res, 'location');
    let sameHost = true;
    if (/^https?:\/\//i.test(loc)) {
      try { sameHost = new URL(loc).host.toLowerCase() === vhost; } catch { sameHost = true; }
    }
    if (sameHost) return { state: 'present', note: `redirects within this vhost to ${loc || '(no Location)'}`, signals };
    return signals.length
      ? { state: 'present', note: `redirects to ${loc} — another name for the same application, and the response is WordPress's own`, signals }
      : { state: 'elsewhere', note: `redirects off this vhost to ${loc}`, signals };
  }
  // A 200 with no WordPress marker in it is NOT evidence of WordPress. Many
  // static and CDN layouts answer every unknown path with a catch-all 200 or a
  // soft-404 page; against one of those this returned four "WordPress <path>
  // answers" findings at high, on a host with no WordPress anywhere. The
  // evidence line admitted there was no marker while the title asserted the
  // opposite — and on a company target that is four highs and a failed run.
  //
  // Still reported, because an endpoint answering where a 404 belongs is worth
  // knowing, but titled and graded for what was actually observed.
  return signals.length
    ? { state: 'present', signals }
    : { state: 'answers-unmarked', signals };
}

const wpNotOnProVhost = check({
  id: 'wp_not_on_pro_vhost',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'No WordPress endpoint (/wp-login.php, /xmlrpc.php, /wp-json/, /wp-admin/) answers on the vhost that serves /resources-pro.',

  async run(ctx) {
    const t = deployTarget(ctx);
    const vhost = t.host;
    const findings = [];
    let checked = 0;
    let answered = 0;

    for (const p of WP_PATHS) {
      await pace(250); // one GET each, spaced — never a sweep
      const url = `${ctx.origin}${p.path}`;
      const res = await httpOnce(ctx, url, { redirect: 'manual', timeoutMs: 12_000 });
      const verdict = classify(res, vhost);

      if (verdict.state === 'unreachable') {
        findings.push(finding({
          severity: 'low',
          title: `Could not probe ${p.path} on the Pro vhost`,
          detail: 'An unreachable probe is not a pass. This endpoint was NOT graded on this run.',
          evidence: `GET ${url} → ${res.error}`,
          remediation: 'Re-run when the vhost is reachable.',
        }));
        continue;
      }

      answered++;
      checked++;
      if (verdict.state === 'absent' || verdict.state === 'elsewhere') continue;

      if (verdict.state === 'answers-unmarked') {
        findings.push(finding({
          severity: sev(t, 'low', 'medium'),
          title: `${p.path} answers on the Pro vhost, with nothing in the response identifying WordPress`,
          detail: `${cutover(t)}A path that should not exist returned a response instead of a 404. That is not proof of WordPress — a catch-all 200, an SPA rewrite or a soft-404 page produces the same thing — but a vhost serving a static export has no reason to answer this path at all, and a catch-all makes every "is X exposed?" question unanswerable from outside.`,
          evidence: `GET ${url} → ${res.status}${verdict.note ? ` (${verdict.note})` : ''}, ${(res.text || '').length} bytes; no WordPress marker in the response`,
          remediation: 'At cutover: serve the Pro export from a document root that 404s unknown paths, so this check can tell "absent" from "answered by a catch-all".',
        }));
        continue;
      }

      findings.push(finding({
        severity: sev(t, 'medium', 'high'),
        title: `WordPress ${p.path} answers on the same vhost that serves /resources-pro`,
        detail: `${cutover(t)}The Pro product surface and a PHP application share one hostname, so every visitor, scanner and bot that can reach the Pro tools can also reach ${p.why}. On the company deployment /resources-pro must be its own virtual host — a document root with the static export in it and no PHP application mounted anywhere under it — and any WordPress must live on a different name with its own access control. Nothing in this repo can fix it: it is a server-layout requirement for the cutover, which is why it is written here as one.`,
        evidence: `GET ${url} → ${res.status}${verdict.note ? ` (${verdict.note})` : ''}, ${(res.text || '').length} bytes${verdict.signals.length ? `; WordPress signals: ${verdict.signals.join('; ')}` : '; no WordPress marker in the response, but the endpoint answered'}`,
        remediation: 'At cutover: serve the Pro export from a dedicated vhost/document root, and confirm this check reports 404 (or no answer) for all four paths against the company host. A vhost split alone is NOT the requirement: WordPress has to be off the MACHINE that runs the API, which wp_not_on_pro_machine grades separately over ssh — this check going green while that one is red is half the job.',
      }));
    }

    if (!answered) {
      throw new Skip(`none of the four WordPress paths answered on ${ctx.origin} — nothing was graded, and this is not a pass`);
    }
    return { findings, checked };
  },
});

// ===========================================================================
// 2. pro_audit_webrtc_stun_allowlist
// ===========================================================================

/** Files that run WebRTC ICE in the browser. Both are read; a missing one is a Skip. */
const WEBRTC_FILES = [
  'components/tools/BrowserPrivacyTool.tsx',
  'components/tools/WhatsMyIpTool.tsx',
];

/** Hosts an operator has declared as the internal STUN server(s) for this build. */
function internalStunHosts() {
  return new Set(
    String(process.env.IB_STUN_ALLOWLIST || '')
      .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  );
}

const stunHostOf = (url) => {
  const m = /^(?:stuns?|turns?):\/{0,2}([^:/?#]+)/i.exec(url);
  return m ? m[1].toLowerCase() : null;
};

const proAuditWebrtcStunAllowlist = check({
  id: 'pro_audit_webrtc_stun_allowlist',
  discipline: 'pentest',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The Pro audit\'s STUN servers are an explicit, reviewable constant pointing somewhere a company is willing to send ICE, and the private addresses it discovers never leave the browser.',

  async run(ctx) {
    const sources = [];
    for (const rel of WEBRTC_FILES) {
      const p = join(ctx.repoRoot, rel);
      if (!existsSync(p)) continue;
      const src = readFileSync(p, 'utf-8');
      sources.push({ rel, src });
      // Follow this file's own local imports one level, and include any that
      // mention a stun:/turn: URL.
      //
      // Without this, the check disabled itself the moment anyone followed its
      // own remediation. "Export one STUN_SERVERS constant that both tools
      // import" moves every stun: literal out of these two files, so the scan
      // found none, threw Skip, and the assertions that actually matter for a
      // company build — WHERE the ICE goes — stopped running. It was honest
      // about it (SKIP, never a pass), but the nightly cron does not pass
      // --strict, so it would have degraded to one line in a log nobody reads.
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        if (!spec.startsWith('.') && !spec.startsWith('@/')) continue; // not ours
        const base = spec.startsWith('@/')
          ? join(ctx.repoRoot, spec.slice(2))
          : join(ctx.repoRoot, rel, '..', spec);
        for (const ext of ['.ts', '.tsx', '.mjs', '.js', '/index.ts', '']) {
          const cand = base + ext;
          if (!existsSync(cand) || cand.endsWith('/')) continue;
          const imported = readFileSync(cand, 'utf-8');
          if (!/\bstuns?:|\bturns?:/i.test(imported)) break;
          const crel = cand.slice(ctx.repoRoot.length + 1);
          if (!sources.some((x) => x.rel === crel)) sources.push({ rel: crel, src: imported });
          break;
        }
      }
    }
    if (!sources.length) throw new Skip(`neither ${WEBRTC_FILES.join(' nor ')} is present — nothing to grade`);

    const t = deployTarget(ctx);
    const findings = [];
    let checked = 0;

    // ---- a. is the list an explicit, reviewable constant? -----------------
    // Today it is not: BrowserPrivacyTool.tsx:76 builds the array inline inside
    // detectWebRtcLeaks(), and WhatsMyIpTool.tsx repeats the same two hosts in
    // its own inline array. There is no single place to review, and no single
    // place for a company build to change.
    const occurrences = [];
    const inlineSites = [];
    for (const { rel, src } of sources) {
      checked++;
      for (const m of src.matchAll(/['"]((?:stuns?|turns?):[^'"]+)['"]/g)) {
        occurrences.push({ rel, line: lineOf(src, m.index), url: m[1], host: stunHostOf(m[1]) });
      }
      for (const m of src.matchAll(/iceServers\s*:\s*\[/g)) {
        inlineSites.push({ rel, line: lineOf(src, m.index) });
      }
    }
    if (!occurrences.length) {
      throw new Skip(`no stun:/turn: URL found in ${sources.map((s) => s.rel).join(', ')} — the parser found nothing to grade, which is a parser result, not a clean build`);
    }
    checked += occurrences.length;

    if (inlineSites.length) {
      findings.push(finding({
        severity: 'medium',
        file: inlineSites[0].rel,
        line: inlineSites[0].line,
        title: 'The WebRTC STUN list is an inline array literal, not a reviewable constant',
        detail: 'The servers this audit sends ICE to are written inline at the call site, and the same two hosts are written a second time in the other WebRTC tool. Nobody reviewing "where does this product send traffic" has one place to look, and a company build that has to swap them has two edits to find rather than one constant to set. Make it a single named, exported constant (like BROWSER_PRIVACY_CHECKS already is in the same file) that both tools import, so the destination list is a reviewable artifact and a test can assert it.',
        evidence: [
          ...inlineSites.map((s) => `${s.rel}:${s.line} iceServers: [ … ] (inline literal)`),
          ...occurrences.map((o) => `${o.rel}:${o.line} ${o.url}`),
        ].join('\n  '),
        remediation: 'Export one STUN_SERVERS constant (a single module both tools import), and have a unit test pin its contents so a host cannot be added without a review.',
      }));
    }

    // ---- b. where the ICE actually goes -----------------------------------
    const allow = internalStunHosts();
    const externalAll = occurrences.filter((o) => o.host && !allow.has(o.host));
    // One entry per host, keeping the FIRST occurrence: the file/line a reader
    // is sent to should be the Pro audit itself (BrowserPrivacyTool.tsx), not
    // whichever copy happens to be parsed last.
    const external = [];
    for (const o of externalAll) if (!external.some((e) => e.host === o.host)) external.push(o);
    if (external.length) {
      findings.push(finding({
        severity: sev(t, 'medium', 'high'),
        file: external[0].rel,
        line: external[0].line,
        title: `Running the Pro audit sends ICE to ${external.map((e) => e.host).join(' and ')}`,
        detail: `${cutover(t)}An employee on a corporate LAN who runs this audit causes their browser to open UDP to these third parties, and the ICE gathering that follows enumerates the machine's local interface addresses (PRIVATE_IP_RE in BrowserPrivacyTool.tsx matches 10./172.16-31./192.168./169.254./fc00::/fd00::/fe80::). The candidates themselves go to the STUN server, which learns the source address of the corporate egress; the internal addressing is revealed to the page, and to anything that can observe or operate that server. A company build needs either an INTERNAL STUN server (set IB_STUN_ALLOWLIST to it here so this check goes green for the right reason) or the WebRTC row disabled outright. Second, non-negotiable half: the private addresses this row discovers must never be logged, beaconed or otherwise sent off-box — see the separate finding recording what the code does today.`,
        evidence: externalAll.map((e) => `${e.rel}:${e.line} ${e.url}`).join('\n  ')
          + `\n  IB_STUN_ALLOWLIST=${process.env.IB_STUN_ALLOWLIST ? String(process.env.IB_STUN_ALLOWLIST) : '(unset — no internal STUN server declared)'}`,
        remediation: 'At cutover: point the STUN constant at the company STUN server and declare it in IB_STUN_ALLOWLIST, or drop the WebRTC row from the Pro build. Do not simply remove one of the two public servers.',
      }));
    }

    // ---- c. do the private addresses leave the browser today? -------------
    // Recorded as a verified property rather than assumed. The scan is a ±240
    // character window around every fetch/sendBeacon/track call site in the two
    // WebRTC files, plus the shape of TrackProps, plus what the /event route
    // says it stores.
    const senders = [];
    const leaks = [];
    for (const { rel, src } of sources) {
      for (const m of src.matchAll(/\b(?:fetch|sendBeacon|track)\s*\(/g)) {
        const window = src.slice(Math.max(0, m.index - 240), m.index + 240);
        const site = { rel, line: lineOf(src, m.index), call: m[0].replace(/\s*\($/, '') };
        senders.push(site);
        if (/privateIPs|publicIPs|\bcandidate\b/i.test(window)) leaks.push({ ...site, window: window.replace(/\s+/g, ' ').slice(0, 200) });
      }
    }
    checked += senders.length;

    const trackSrc = existsSync(join(ctx.repoRoot, 'lib', 'track.ts'))
      ? readFileSync(join(ctx.repoRoot, 'lib', 'track.ts'), 'utf-8') : '';
    const propsBlock = /export interface TrackProps \{([\s\S]*?)\n\}/.exec(trackSrc);
    const ipish = propsBlock
      ? [...propsBlock[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]).filter((k) => /ip|addr|host|candidate/i.test(k))
      : null;
    if (trackSrc) checked++;

    if (leaks.length || (ipish && ipish.length)) {
      findings.push(finding({
        severity: sev(t, 'high', 'critical'),
        file: leaks[0] ? leaks[0].rel : 'lib/track.ts',
        line: leaks[0] ? leaks[0].line : null,
        title: 'WebRTC-discovered addresses reach an outbound call',
        detail: 'The addresses this audit discovers are the employee\'s internal network layout. They must never leave the browser — not to our own API, not to a counter, not in a share body. This is the one assertion in this check that is not a cutover task: it is wrong today, wherever it is deployed.',
        evidence: [
          ...leaks.map((l) => `${l.rel}:${l.line} ${l.call}( … ) near: ${l.window}`),
          ...((ipish && ipish.length) ? [`lib/track.ts TrackProps has address-shaped field(s): ${ipish.join(', ')}`] : []),
        ].join('\n  '),
        remediation: 'Keep privateIPs in component state only; send counts, never values.',
      }));
    } else {
      findings.push(finding({
        severity: 'info',
        file: 'lib/track.ts',
        title: 'No WebRTC address exfiltration found by a windowed source scan',
        detail: 'Recorded as a known property rather than left to be rediscovered, because the company requirement above depends on it staying true. What was actually checked, and what it showed: (1) components/tools/BrowserPrivacyTool.tsx makes no fetch, sendBeacon or track call at all — privateIPs live in component state and are rendered; (2) components/tools/WhatsMyIpTool.tsx does make one outbound call, a POST to API_BASE + "/ip" with the literal body "{}", so the WebRTC candidates are not in it — the server answers with the address it saw, which is that tool\'s whole purpose and is not a WebRTC value; (3) lib/track.ts TrackProps carries tool/niche/severity/target/page/benefit/reason/gate and no address-shaped field, and the event body is JSON.stringify({event, ...props, platform, inApp}) so nothing else can ride along; (4) app/event/route.ts validates against the lib/event-schema allowlist and increments day-bucketed counters, documenting that no IP, cookie or user id is stored. A regression in any of those flips this finding to the critical one above.',
        evidence: `scanned ${senders.length} fetch/sendBeacon/track call site(s) across ${sources.map((s) => s.rel).join(', ')}; ${senders.map((s) => `${s.rel}:${s.line} ${s.call}`).join(', ') || '(none)'}; TrackProps fields: ${propsBlock ? [...propsBlock[1].matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\??:/gm)].map((m) => m[1]).join(', ') : '(lib/track.ts not parsed)'}`,
        remediation: 'No action. Keep it this way.',
      }));
    }

    return { findings, checked };
  },
});

// ===========================================================================
// 3. pro_vhost_noindex_but_no_login
// ===========================================================================

/**
 * A line that declares access control in Apache or nginx config.
 *
 * `Require all granted` AND `Require all denied` are both excluded: the first
 * opens a path and the second closes one (the body cap in API-ON-DROPLET.md is
 * a `Require all denied` inside an <If>), and neither authenticates anyone.
 * The earlier form excluded only `all granted`, so a deny-all on a dotfile
 * path would have read as "the repo declares auth" — a softer grade earned by
 * a directive that gates nothing.
 */
const AUTH_DIRECTIVE_RE = /^\s*(?:AuthType|AuthName|AuthUserFile|AuthGroupFile|AuthBasicProvider|AuthLDAPURL|AuthFormProvider|Require\s+(?!all\b)|Allow\s+from|Deny\s+from|<RequireAll|<RequireAny|auth_basic\b|auth_request\b|auth_jwt\b)/im;

/** Directories that are never repo-declared config. */
const NOT_CONFIG_DIRS = new Set(['node_modules', '.next', '.git', 'out', 'out-pro', 'reports', '.claude', 'coverage', 'test-results', 'playwright-report']);
/** File names that can carry an Apache or nginx access-control directive. */
const CONFIG_FILE_RE = /(?:^|\.)htaccess(?:\.|$)|\.(?:conf|vhost|sh)$|^nginx/i;

/**
 * Every access-control directive declared in any config-shaped file in the
 * repo, with where it is. "Anywhere in the repo" has to mean the repo: the
 * previous version read exactly one file, scripts/droplet-htaccess.conf, and
 * wrote "there is no access control declared anywhere in the repo" into the
 * evidence on the strength of that one grep.
 *
 * Returns { scanned, declarations }. `scanned` is how many files were read, so
 * a caller can tell "no directive in 3 files" from "no directive in 0 files".
 */
export function authDeclarations(repoRoot, maxDepth = 6) {
  const declarations = [];
  let scanned = 0;
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let names = [];
    try { names = readdirSync(dir); } catch { return; }
    for (const name of names) {
      const abs = join(dir, name);
      let st;
      try { st = statSync(abs); } catch { continue; }
      if (st.isDirectory()) {
        if (!NOT_CONFIG_DIRS.has(name)) walk(abs, depth + 1);
        continue;
      }
      if (!CONFIG_FILE_RE.test(name) || st.size > 512 * 1024) continue;
      let text = '';
      try { text = readFileSync(abs, 'utf-8'); } catch { continue; }
      scanned++;
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (AUTH_DIRECTIVE_RE.test(lines[i])) {
          declarations.push({ file: relative(repoRoot, abs).split(sep).join('/'), line: i + 1, text: lines[i].trim().slice(0, 120) });
        }
      }
    }
  };
  walk(repoRoot, 0);
  return { scanned, declarations };
}

const proVhostNoindexButNoLogin = check({
  id: 'pro_vhost_noindex_but_no_login',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: '/resources-pro carries the noindex header — and, separately, whether anything at all stands between the internet and the Pro surface plus /api.',

  async run(ctx) {
    const t = deployTarget(ctx);
    const findings = [];
    let checked = 0;

    const pageUrl = `${ctx.proBase}/tools/`;
    await pace(250);
    const page = await httpOnce(ctx, pageUrl, { redirect: 'manual', timeoutMs: 15_000 });

    // A GET on a POST-only route: Next answers 405 without touching Redis, the
    // rate limiter or a scan slot. It proves the API is mounted and answering
    // on this public vhost, which is all this check needs from it.
    const apiUrl = `${ctx.apiBase}/ip`;
    await pace(250);
    const api = await httpOnce(ctx, apiUrl, { redirect: 'manual', timeoutMs: 15_000 });

    if (!page.ok && !api.ok) {
      // From a declared OUTSIDE vantage an unreachable company host is what a
      // VPN or IP allowlist looks like — and also what a typo in --origin or a
      // box that is down looks like. It is recorded as SKIPPED with that said,
      // never as a pass: this check grades answers, and there was none.
      const outsideNote = t.kind === 'company' && t.vantage === 'outside'
        ? ' From IB_PROBE_VANTAGE=outside that is consistent with a VPN or IP allowlist doing its job, but it is equally consistent with a wrong origin, so it is recorded as skipped rather than as a pass.'
        : '';
      throw new Skip(`neither ${pageUrl} nor ${apiUrl} answered (${page.error} / ${api.error}) — nothing was graded.${outsideNote}`);
    }

    // ---- a. the noindex header is NOT graded here, on purpose -------------
    //
    // cmp-tier-surfaces-distinct (compliance-provenance.mjs) already asserts
    // X-Robots-Tag on this exact URL, and does it better: it Skips unless the
    // page is a real 200, so an auth gate answering instead of the app is not
    // mistaken for a missing header.
    //
    // This file's version dropped that 200 guard and graded it `high`, so a 401
    // or a 302 to an SSO host — the very thing the check below demands for a
    // company deploy — reported "/resources-pro is not being served
    // X-Robots-Tag: noindex" and failed the run. The header was absent because
    // the gate answered and the application never saw the request. A check that
    // goes red exactly when its own remediation is applied trains people to
    // ignore it, so it is deleted rather than duplicated.

    // ---- b. the sentence that matters -------------------------------------
    //
    // What the repo declares, used to ESCALATE and never to suppress. A
    // directive in a file in this checkout is not a gate on the vhost that
    // just answered; it only changes whether the fix is "deploy what is
    // written" (high) or "nothing is written" (critical).
    const auth = authDeclarations(ctx.repoRoot);
    checked += auth.scanned;
    const confHasAuth = auth.declarations.length > 0;

    /**
     * A redirect to a DIFFERENT host is a gate, not an open door.
     *
     * This read `status >= 200 && status < 400`, so a 302 counted as open. An
     * oauth2-proxy or OIDC gate — much the commonest way a vhost like this gets
     * protected, far more common than Basic auth — answers exactly that: 302 to
     * the SSO host. Against a correctly gated mock (302 to an SSO host on the
     * page, 401 + WWW-Authenticate on /api) this check still reported
     * "no authentication at all" at critical.
     *
     * So: same-host redirects (a trailing-slash 301, an http->https bump) stay
     * "open"; a redirect that leaves the host is treated as a gate answering.
     */
    const redirectLeavesHost = (res) => {
      if (!res.ok || res.status < 300 || res.status >= 400) return false;
      const loc = hdr(res, 'location');
      if (!loc) return false;
      try {
        return new URL(loc, res.url).host.toLowerCase() !== new URL(res.url).host.toLowerCase();
      } catch { return false; }
    };
    const pageOpen = page.ok && page.status >= 200 && page.status < 400
      && !hdr(page, 'www-authenticate') && !redirectLeavesHost(page);
    const apiOpen = api.ok && !hdr(api, 'www-authenticate') && api.status !== 401 && api.status !== 407;
    if (api.ok) checked++;

    if (pageOpen || apiOpen) {
      const company = t.kind === 'company';
      const inside = company && t.vantage === 'inside';

      // The grade, in one place so a test can pin every cell of it:
      //   demo                         medium  (the deliberate public state)
      //   company, inside              medium  (open in-band; VPN/allowlist unseen)
      //   company, outside|unknown     critical, or high if the repo at least
      //                                declares an auth directive somewhere
      const severity = !company ? 'medium' : inside ? 'medium' : (confHasAuth ? 'high' : 'critical');

      const title = inside
        ? 'The Pro tools and /api answer without authentication FROM INSIDE the perimeter — an in-band prober cannot see a VPN or IP allowlist, so this is graded medium, not critical'
        : 'Anyone who can reach this vhost gets the Pro tools and /api with no authentication at all — noindex is not access control';

      const vantageNote = !company ? ''
        : inside
          ? ' THIS RUN DECLARED IB_PROBE_VANTAGE=inside: it is on the company network, so a VPN or an IP allowlist at the perimeter would not be visible to it. What it has established is that nothing IN-BAND (SSO, Basic auth, a 401 or a redirect to an identity provider) gates either surface. If the perimeter control is the whole gate, that is a design the owner has to be able to point at; if it is not there either, this is the critical finding wearing a medium label.'
          : t.vantage === 'outside'
            ? ' THIS RUN DECLARED IB_PROBE_VANTAGE=outside: it is on the public internet, so the open answer above is a live hole — nothing at the perimeter stopped it and nothing in-band did.'
            : ' IB_PROBE_VANTAGE IS NOT DECLARED, so this run does not know where it stands and is graded as if from outside (the strict side). It needs one of two declarations: IB_PROBE_VANTAGE=outside when the runner is on the public internet (an open answer is then a real hole, and an unreachable host is the gate working), or IB_PROBE_VANTAGE=inside when the runner is on the company network (a VPN or IP allowlist is then invisible to it, and this finding is graded medium with that caveat in its title).';

      const authNote = !company ? ''
        : confHasAuth
          ? ` The repo does declare access control — ${auth.declarations.slice(0, 3).map((d) => `${d.file}:${d.line} ${d.text}`).join('; ')} — and the surface still answered, so what is written is not in force on this vhost. Graded high rather than critical only because there is something to deploy.`
          : ` No AuthType / AuthUserFile / Require / Allow-from / auth_basic directive is declared in ANY of the ${auth.scanned} config-shaped file(s) in this repo (.conf, .htaccess, .sh), so nothing this repo ships would close the door either.${inside ? '' : ' Graded critical.'}`;

      findings.push(finding({
        severity,
        file: 'scripts/droplet-htaccess.conf',
        title,
        detail: `${cutover(t)}Say it plainly: an internal deployment of this code with nothing in front of it is a free, unauthenticated, self-service intranet crawler for anyone who can route to the host. /api answers unauthenticated requests, the Pro tools drive it, and the whole point of those tools is to fetch a URL you name, resolve it, follow what it returns and hand you the result — from inside the company network perimeter, with the server's own network position, attributed to the server rather than to the caller. The X-Robots-Tag: noindex header keeps the pages out of Google; it does not keep one person out of the pages, and it is the only thing currently in front of them. The company deployment needs a real gate in front of BOTH /resources-pro AND /api — VPN, SSO, or an IP allowlist at the vhost, terminated before the application sees the request. Note what it CANNOT be: the entitlement in this codebase is document.documentElement.hasAttribute('data-ib-pro') (lib/in-app.ts, components/useUpgradeGate.tsx), which is a client-side product gate for three UI actions and is not, and was never intended as, an authentication boundary.${vantageNote}${authNote}`,
        evidence: [
          `GET ${pageUrl} → ${page.ok ? `${page.status}${hdr(page, 'www-authenticate') ? `, WWW-Authenticate: ${hdr(page, 'www-authenticate')}` : ', no WWW-Authenticate'}, X-Robots-Tag: ${hdr(page, 'x-robots-tag') || '(absent)'}` : page.error}`,
          `GET ${apiUrl} → ${api.ok ? `${api.status}${hdr(api, 'www-authenticate') ? `, WWW-Authenticate: ${hdr(api, 'www-authenticate')}` : ', no WWW-Authenticate'} (POST-only route; a 405/403 still proves the API answers this vhost)` : api.error}`,
          `vantage: IB_PROBE_VANTAGE=${t.vantage === 'unknown' ? '(unset → unknown)' : t.vantage}; target: ${t.kind} (${t.why})`,
          `repo auth scan: ${auth.scanned} config-shaped file(s) read; ${auth.declarations.length ? `${auth.declarations.length} access-control directive(s): ${auth.declarations.slice(0, 5).map((d) => `${d.file}:${d.line} ${d.text}`).join(' | ')}` : 'NO access-control directive declared in any of them'}`,
        ].join('\n  '),
        remediation: 'At cutover: put VPN/SSO/IP-allowlist termination in front of the Pro vhost and the API, declare IB_PROBE_VANTAGE for the runner, and re-run this check against the company host — from outside it must then find the gate (a 401/403 before the application, or an unreachable host); from inside it must find an in-band gate or the owner must be able to name the perimeter control.',
      }));
    }

    return { findings, checked };
  },
});

// ===========================================================================
// 4. pro_host_cutover_not_nip_io
// ===========================================================================

/** The `|| '…'` default on the right of a base-URL declaration in lib/tiers.ts. */
/**
 * The default a `export const <NAME> = … || '<value>'` declaration falls back to.
 *
 * Anchored to `^export const <NAME>` on purpose. The loose form matched the
 * constant's name ANYWHERE, including in prose: with `export const PRO_BASE_URL`
 * renamed away entirely, it still reported "PRO_BASE_URL still defaults to the
 * demo droplet", citing a COMMENT line that merely mentioned the old name and
 * quoting FREE_BASE_URL's value as PRO's. It reported on a constant that no
 * longer existed. Returning null now means the parse failed, which the caller
 * turns into a Skip rather than a confident wrong answer.
 */
function tierDefault(src, name) {
  const m = new RegExp(`^export const ${name}\\b[^=]*=\\s*[\\s\\S]{0,200}?\\|\\|\\s*'([^']+)'`, 'm').exec(src);
  if (!m) return null;
  return { value: m[1], line: lineOf(src, m.index) };
}

const proHostCutoverNotNipIo = check({
  id: 'pro_host_cutover_not_nip_io',
  discipline: 'compliance',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'PRO_BASE_URL, FREE_BASE_URL and the API origin allowlist name the host this build is actually for — not the demo droplet.',

  async run(ctx) {
    const t = deployTarget(ctx);
    const tiersPath = join(ctx.repoRoot, 'lib', 'tiers.ts');
    const originPath = join(ctx.repoRoot, 'lib', 'origin.ts');
    if (!existsSync(tiersPath) || !existsSync(originPath)) {
      throw new Skip('lib/tiers.ts or lib/origin.ts is missing — the declarations this check grades are not here');
    }
    const tiersSrc = readFileSync(tiersPath, 'utf-8');
    const originSrc = readFileSync(originPath, 'utf-8');

    const declarations = [];
    for (const name of ['PRO_BASE_URL', 'FREE_BASE_URL']) {
      const d = tierDefault(tiersSrc, name);
      if (d) declarations.push({ name, file: 'lib/tiers.ts', ...d });
    }
    if (declarations.length !== 2) {
      throw new Skip(`could not parse both base-URL defaults out of lib/tiers.ts (found ${declarations.length}) — refusing to report a clean pass over a parse failure`);
    }

    // DEFAULT_ALLOWED is what the API falls back to when ALLOWED_ORIGINS is unset.
    const defBlock = /const DEFAULT_ALLOWED = \[([\s\S]*?)\]/.exec(originSrc);
    if (!defBlock) throw new Skip('could not parse DEFAULT_ALLOWED out of lib/origin.ts');
    const defaultAllowed = [...defBlock[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const defaultAllowedLine = lineOf(originSrc, defBlock.index);

    const findings = [];
    let checked = declarations.length + defaultAllowed.length;

    const hostOf = (u) => { try { return new URL(u).host.toLowerCase(); } catch { return null; } };

    // ---- a. the two base URLs ---------------------------------------------
    for (const d of declarations) {
      const host = hostOf(d.value);
      if (!host || !DEMO_HOST_RE.test(host)) continue;
      findings.push(finding({
        severity: sev(t, 'medium', 'high'),
        file: d.file,
        line: d.line,
        title: `${d.name} still defaults to the demo droplet (${host})`,
        detail: `${cutover(t)}This is a NEXT_PUBLIC_ constant, so whatever it resolves to at build time is baked into every exported page and every client chunk — a company build that forgets NEXT_PUBLIC_PRO_URL/NEXT_PUBLIC_FREE_URL does not fail, it ships a company-hosted site whose cross-tier links, canonical/og URLs (lib/seo.ts) and in-app sister-origin allowlist all name a public droplet. That last one is the sharp edge: components/InAppBridge.tsx derives SISTER_ORIGINS from exactly these two constants, so the Android app is handed the droplet's origin as a trusted sibling to propagate its in-app flags to.`,
        evidence: `${d.file}:${d.line} ${d.name} default is '${d.value}' (host ${host}); this run's target is ${t.kind} (${t.why})`,
        remediation: 'At cutover: set NEXT_PUBLIC_PRO_URL and NEXT_PUBLIC_FREE_URL to the company host for every build, and change the literal defaults in lib/tiers.ts so a forgotten env var cannot silently fall back to the droplet.',
      }));
    }

    // ---- b. the API origin allowlist --------------------------------------
    const demoInDefaults = defaultAllowed.filter((o) => { const hst = hostOf(o); return hst && DEMO_HOST_RE.test(hst); });
    if (demoInDefaults.length) {
      findings.push(finding({
        severity: sev(t, 'medium', 'high'),
        file: 'lib/origin.ts',
        line: defaultAllowedLine,
        title: `The API's fallback origin allowlist names the demo droplet (${demoInDefaults.join(', ')})`,
        detail: `${cutover(t)}DEFAULT_ALLOWED is what getAllowedOrigins() returns when ALLOWED_ORIGINS is unset, so a deploy that forgets the env var grants these origins access to the API.`,
        evidence: `lib/origin.ts:${defaultAllowedLine} DEFAULT_ALLOWED = [${defaultAllowed.map((o) => `'${o}'`).join(', ')}]`,
        remediation: 'Remove demo hosts from DEFAULT_ALLOWED and set ALLOWED_ORIGINS explicitly on the company API service.',
      }));
    }

    // The live value, when there is a droplet login. ALLOWED_ORIGINS is a list
    // of public origins, not a secret, so printing it is safe — and only the
    // box knows what is actually in force.
    let liveAllowed = null;
    let liveNote = '';
    try {
      const out = String(ctx.ssh(
        "(sudo -n grep -h '^ALLOWED_ORIGINS=' /etc/ib-api.env 2>/dev/null || grep -h '^ALLOWED_ORIGINS=' /etc/ib-api.env 2>/dev/null) || echo '--NONE--'",
        { timeoutMs: 20_000 },
      )).trim();
      if (out.includes('--NONE--') || !out) liveNote = 'ALLOWED_ORIGINS is not set in /etc/ib-api.env (or is not readable), so the API is running on the DEFAULT_ALLOWED fallback';
      else liveAllowed = out.replace(/^ALLOWED_ORIGINS=/, '').replace(/^["']|["']$/g, '').split(',').map((s) => s.trim()).filter(Boolean);
    } catch (err) {
      if (!(err && err.isSkip)) throw err;
      liveNote = `live /etc/ib-api.env NOT inspected: ${err.message}`;
    }

    if (liveAllowed) {
      checked += liveAllowed.length;
      const demoLive = liveAllowed.filter((o) => { const hst = hostOf(o); return hst && DEMO_HOST_RE.test(hst); });
      if (demoLive.length) {
        findings.push(finding({
          severity: sev(t, 'medium', 'high'),
          title: `The live API origin allowlist still names the demo droplet (${demoLive.join(', ')})`,
          detail: `${cutover(t)}This is the value actually in force on the running service, which is the one that decides who may call the API. A company deployment must name the company origin here and nothing else.`,
          evidence: `/etc/ib-api.env ALLOWED_ORIGINS = ${liveAllowed.join(', ')}`,
          remediation: 'At cutover: rewrite ALLOWED_ORIGINS on the API unit to the company origins and restart the service.',
        }));
      }
    } else {
      findings.push(finding({
        severity: 'info',
        title: 'The live API origin allowlist was not inspected on this run',
        detail: 'This check graded the repo\'s declarations only. Said out loud rather than left as an unexplained clean line: the value actually in force on the box is the one that decides who may call the API, and it was not read on this pass.',
        evidence: liveNote || 'no droplet login available',
        remediation: 'Run this check from a machine with the droplet login in .secrets to grade the live value too.',
      }));
    }

    // ---- c. does anything name the company host at all? --------------------
    if (t.kind === 'company' && t.companyHost) {
      const named = [
        ...declarations.map((d) => hostOf(d.value)),
        ...defaultAllowed.map(hostOf),
        ...((liveAllowed || []).map(hostOf)),
      ].filter(Boolean);
      if (!named.includes(t.companyHost)) {
        findings.push(finding({
          severity: 'high',
          file: 'lib/origin.ts',
          line: defaultAllowedLine,
          title: `Nothing in the configuration names the company host (${t.companyHost})`,
          detail: 'The build is pointed at a company host that neither base URL nor any origin allowlist mentions. isOriginAllowed() has a same-origin branch, so pages served from the same host as the API still work and the gap stays invisible — until the static export is served from a different name than the API, at which point every tool returns 403 and the fastest-looking fix is to widen the allowlist. Name the company origin explicitly instead.',
          evidence: `target ${t.companyHost} (${t.why}); configured hosts: ${[...new Set(named)].join(', ') || '(none)'}`,
          remediation: 'Set ALLOWED_ORIGINS and NEXT_PUBLIC_PRO_URL/NEXT_PUBLIC_FREE_URL to the company origins before the cutover build.',
        }));
      }
    }

    return { findings, checked };
  },
});

// ===========================================================================
// 5. wp_not_on_pro_machine
// ===========================================================================

/**
 * WordPress off the MACHINE, not merely off the vhost.
 *
 * wp_not_on_pro_vhost (check 1) asks the vhost four questions over HTTP and is
 * vhost-scoped by construction: move WordPress to a second ServerName on the
 * same box and it goes green while the owner's requirement is still violated.
 * That is the worse outcome — a green check certifying a violated
 * requirement — and it was reported as a gap for exactly that reason. The
 * three cnast checks that DO see the consequences of machine co-tenancy
 * (webroot-ownership, unit-sandbox, env-file-perms) record it as a standing
 * fact of this droplet at info, not as a state that has to end.
 *
 * Why the machine is the unit that matters here: the API fetches URLs a
 * stranger names, runs as www-data — the same uid as the WordPress PHP
 * workers — shares /tmp, disk, CPU and the kernel with them, and the owner's
 * two named fears are DDoS and server infiltration. A flood aimed at /api
 * takes WordPress down with it; a compromise of either application is a
 * compromise of the other. No vhost boundary changes any of that.
 *
 * Three read-only listings over ssh, batched into one session with marker
 * lines so a truncated answer is a Skip and not a clean box:
 *
 *   ls /etc/apache2/sites-enabled/                what Apache serves
 *   ls -d /var/www/{*,html}/wp-config.php         a WordPress install, by its
 *                                                 one unmistakable file
 *   systemctl is-active mysql mariadb             its database
 *
 * Nothing writes, nothing reloads, nothing scans.
 */
const WP_MACHINE_DB_UNITS = ['mysql', 'mariadb'];
const WP_MACHINE_CMD = [
  "echo '---IB:SITES---'; ls -1 /etc/apache2/sites-enabled/ 2>&1",
  "echo '---IB:WPCONFIG---'; ls -d /var/www/*/wp-config.php /var/www/html/wp-config.php 2>/dev/null",
  `echo '---IB:DB---'; systemctl is-active ${WP_MACHINE_DB_UNITS.join(' ')} 2>/dev/null`,
  "echo '---IB:END---'",
].join('; ');

/** Marker-delimited sections; an empty section stays an empty string. */
function wpMachineSections(out) {
  const sections = {};
  let current = null;
  for (const line of String(out).split('\n')) {
    const m = /^---IB:([A-Z]+)---$/.exec(line.trim());
    if (m) { current = m[1]; sections[current] = []; continue; }
    if (current) sections[current].push(line);
  }
  return Object.fromEntries(Object.entries(sections).map(([k, v]) => [k, v.join('\n').trim()]));
}

const wpNotOnProMachine = check({
  id: 'wp_not_on_pro_machine',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'No WordPress install (wp-config.php) and no MySQL/MariaDB service is co-resident on the MACHINE that runs the API — a vhost split is not the requirement.',

  async run(ctx) {
    const t = deployTarget(ctx);
    const out = String(ctx.ssh(WP_MACHINE_CMD, { timeoutMs: 30_000 }));
    const s = wpMachineSections(out);
    if (!('END' in s) || !('WPCONFIG' in s) || !('DB' in s)) {
      // No end marker: the session died part way through, and a truncated
      // answer reads exactly like a machine with no WordPress on it.
      throw new Skip(`the ssh batch did not complete (missing ${['WPCONFIG', 'DB', 'END'].filter((k) => !(k in s)).join('/')} marker); last 200 chars: ${out.slice(-200).replace(/\n/g, ' ')}`);
    }

    const findings = [];
    let checked = 0;

    const sites = (s.SITES || '').split('\n').map((l) => l.trim()).filter(Boolean);
    checked++;

    const wpConfigs = [...new Set((s.WPCONFIG || '').split('\n').map((l) => l.trim()).filter((l) => /wp-config\.php$/.test(l)))];
    checked++;

    // `systemctl is-active a b` answers one line per unit, in argument order.
    const dbLines = (s.DB || '').split('\n').map((l) => l.trim());
    const db = WP_MACHINE_DB_UNITS.map((unit, i) => ({ unit, state: dbLines[i] || '(no answer)' }));
    const dbActive = db.filter((d) => d.state === 'active');
    checked += db.length;

    const layout = [
      `sites-enabled: ${sites.join(', ') || '(none / unreadable)'}`,
      `wp-config.php: ${wpConfigs.join(', ') || '(none under /var/www)'}`,
      `database units: ${db.map((d) => `${d.unit}=${d.state}`).join(', ')}`,
    ].join('\n  ');

    if (wpConfigs.length) {
      findings.push(finding({
        severity: sev(t, 'medium', 'high'),
        title: `WordPress is installed on the same machine as the API (${wpConfigs.join(', ')})`,
        detail: `${cutover(t)}The API that fetches stranger-named URLs and the team's WordPress share one kernel, one disk, one CPU budget and — on this box — one uid, www-data. A flood aimed at /api takes WordPress down with it, and a compromise of either application is a compromise of the other; those are the owner's two named fears, and no vhost boundary answers either. wp_not_on_pro_vhost going green is NOT this requirement met: a second ServerName on the same box passes that check and fails this one. On the company deployment the API host runs the reverse proxy, ib-api and Redis, and nothing else; WordPress and its database live on a different machine. Nothing in this repo can fix it — it is a server-layout requirement for the cutover, which is why it is written here as one.`,
        evidence: `${layout}${dbActive.length ? `\n  its database is running here too: ${dbActive.map((d) => d.unit).join(', ')}` : ''}`,
        remediation: 'At cutover: build the API host with no PHP application and no MySQL/MariaDB unit on it, put WordPress on its own machine, and re-run this check — it must then find no wp-config.php under /var/www and no active database unit.',
      }));
    } else if (dbActive.length) {
      findings.push(finding({
        severity: sev(t, 'low', 'medium'),
        title: `A database service is active on the API machine (${dbActive.map((d) => d.unit).join(', ')}) with no WordPress install found`,
        detail: `${cutover(t)}The API needs Redis and nothing else. A MySQL/MariaDB unit on the same machine is serving some other application, and whatever it is shares the box with a service that fetches URLs a stranger names. Not the WordPress finding, but the same shape: a co-tenant on the API host.`,
        evidence: layout,
        remediation: 'At cutover: no database unit on the API host; whatever it serves moves with it.',
      }));
    }

    return { findings, checked };
  },
});

/** The runner accepts an array default export and drops anything without an id. */
const CHECKS = [wpNotOnProVhost, proAuditWebrtcStunAllowlist, proVhostNoindexButNoLogin, proHostCutoverNotNipIo, wpNotOnProMachine];
export default CHECKS;
