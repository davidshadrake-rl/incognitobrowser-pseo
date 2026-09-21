/**
 * WordPress USER ENUMERATION on the vhost that serves /resources-pro.
 *
 * WHAT THIS ADDS THAT wp_not_on_pro_vhost DOES NOT.
 * That check (scripts/security/checks/pro-deploy-host.mjs) probes /wp-login.php,
 * /xmlrpc.php, /wp-json/ and /wp-admin/ and answers one question: "is a PHP
 * application mounted on this hostname?". It stops there. Nothing in the suite
 * asks the NEXT question, which is the standard first move against any
 * WordPress and the one that turns "there is a WordPress here" into "here are
 * its usernames":
 *
 *   /?author=<n>                  the author archive. On a default install this
 *                                 either 301s to /author/<nicename>/ or serves
 *                                 the archive inline with the nicename in the
 *                                 <body class> and in every permalink on it.
 *   /wp-json/wp/v2/users          the REST collection. Unauthenticated on a
 *                                 default install, and it hands back id, display
 *                                 name and slug for every user who has published.
 *   /wp-sitemap-users-1.xml       the author sitemap WordPress 5.5+ generates,
 *                                 one <loc> per author archive.
 *
 * WHY THAT MATTERS HERE SPECIFICALLY. wp_not_on_pro_vhost already reports that
 * /wp-login.php and /xmlrpc.php answer on this hostname. A username is the half
 * of a credential that is not supposed to be guessable, and xmlrpc's
 * system.multicall turns a known username plus a password list into one request
 * per hundred guesses. Enumeration is what makes the login surface next door
 * worth attacking; reported together they are one finding chain, which is why
 * this one names the other in its remediation.
 *
 * THE LOGIN-FORM ORACLE LEG IS NOT TESTED, AND SAYS SO.
 * wp-login.php distinguishes "Unknown username" from "The password you entered
 * for the username X is incorrect", which is a username oracle in the error
 * text. Reaching that text requires POSTing `log` and `pwd` to the live login
 * form of the team's production WordPress — a credential submission and an
 * authentication attempt against someone else's application. This check does
 * not do it, on any target, and emits an explicit info finding recording that
 * the leg was skipped rather than letting a silent absence read as a pass.
 *
 * PRODUCTION SAFETY. SIX single GETs per run, paced 300ms apart,
 * redirect: 'manual', no credentials, no POST, no password, no brute force and
 * no sweep. Three author ids (1-3, not a range scan), one REST collection, one
 * sitemap, and one deliberately-nonexistent sitemap path as a CONTROL. Nothing
 * here touches /api, /scan-url or /challenge, so the API limits (10 scans/min
 * per /24, 30 challenges/min, 20 concurrent) are nowhere in play. These are
 * reads on the team's public front door and are never followed by a write — we
 * are guests in that web root, exactly as dast-wordpress-untouched puts it.
 *
 * WHY THE CONTROL PROBE IS NOT OPTIONAL. /wp-sitemap-users-1.xml answers 301 on
 * this box (to the canonical site URL, a different hostname), and a 301 on its
 * own proves nothing — plenty of servers redirect everything. The control asks
 * for a sitemap path that cannot exist. Observed: the control 404s while the
 * users sitemap 301s, so the difference is the route existing, not a blanket
 * redirect. Without that second data point this check would be asserting from a
 * single status code, which is how pro-deploy-host's first version reported
 * four WordPress findings against a host with no WordPress on it.
 *
 * TARGET-AWARE GRADING. Same three-way rule as pro-deploy-host.mjs
 * (IB_DEPLOY_TARGET, then IB_COMPANY_HOST, then the origin's shape, with an
 * unrecognised host getting the HARDER grade). The logic is duplicated here
 * rather than imported because that file's only export is its array of checks —
 * the runner's `if (d && d.id)` contract means a module exports checks, not
 * helpers, and this file owns nothing there. If a third check needs it, it
 * belongs in lib/ or dast-shared.mjs, not copied a third time.
 *
 * On the demo droplet these findings are about the TEAM'S CO-HOSTED WORDPRESS:
 * real, reported, and graded medium because it is a deliberate shared-box state
 * we do not own and cannot fix from this repo. On a company deployment the same
 * sentence is a live hole in the Pro vhost, which must not serve these paths at
 * all, and is graded high. Nothing is ever silently suppressed.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { pace, httpOnce, h } from './dast-shared.mjs';

// ---------------------------------------------------------------------------
// Which deployment are we grading? (mirrors pro-deploy-host.mjs)
// ---------------------------------------------------------------------------

/** Hosts that are the present PUBLIC DEMO: nip.io names and dashed-IP names. */
const DEMO_HOST_RE = /(?:^|\.)nip\.io(?::\d+)?$|^\d{1,3}-\d{1,3}-\d{1,3}-\d{1,3}\./;

function deployTarget(ctx) {
  let host = '';
  try { host = new URL(ctx.origin).host.toLowerCase(); } catch { host = String(ctx.origin || '').toLowerCase(); }

  const declared = String(process.env.IB_DEPLOY_TARGET || '').trim().toLowerCase();
  if (declared === 'demo' || declared === 'company') {
    return { kind: declared, host, why: `IB_DEPLOY_TARGET=${declared}` };
  }
  const companyHost = String(process.env.IB_COMPANY_HOST || '').trim().toLowerCase() || null;
  if (companyHost) return { kind: 'company', host, why: `IB_COMPANY_HOST=${companyHost}` };
  if (DEMO_HOST_RE.test(host)) return { kind: 'demo', host, why: `target host ${host} is the public demo droplet` };
  return { kind: 'company', host, why: `target host ${host || '(unparsed origin)'} is not the demo droplet, so it is graded as a company deployment` };
}

/** Severity for a property that is the team's problem on the demo and ours on a company box. */
const sev = (t, demo, company) => (t.kind === 'company' ? company : demo);

/** Prefix that makes the demo-target grade legible in the report. */
const cutover = (t) =>
  t.kind === 'company'
    ? 'LIVE ON THIS TARGET. '
    : `CO-TENANT FINDING, graded medium because this run is pointed at the public demo (${t.why}), where the WordPress belongs to the team and sharing the box is a deliberate state rather than a defect in this repo. The same finding is graded high the moment this suite runs against a company host, where the Pro vhost must not serve any of these paths at all. `;

// ---------------------------------------------------------------------------
// Pulling usernames out of a response
// ---------------------------------------------------------------------------

/**
 * A plausible WordPress user_nicename. Deliberately narrow: the point is to
 * report NAMES, and a permissive pattern turns theme slugs and cache-buster
 * tokens into "usernames", which is how a recon check loses its credibility.
 */
const NICENAME_RE = /^[a-z0-9][a-z0-9._-]{0,59}$/i;

/**
 * Tokens that appear in the same positions as a nicename but are not one.
 * `author-1` is the numeric id class WordPress emits next to `author-<nicename>`
 * in <body class>, so digit-only tokens are dropped rather than reported as a
 * user called "1".
 */
const NOT_A_NAME = new Set(['author', 'page', 'feed', 'wp', 'json', 'wp-json', 'embed', 'amp', 'rss', 'atom']);

const plausible = (s) => Boolean(s) && NICENAME_RE.test(s) && !/^\d+$/.test(s) && !NOT_A_NAME.has(s.toLowerCase());

/** Every /author/<nicename>/ occurrence in a string (a Location header or a body). */
function namesFromAuthorPaths(text) {
  const out = [];
  for (const m of String(text || '').matchAll(/\/author\/([^/"'?#\s<>\\]+)\/?/gi)) {
    const name = decodeURIComponent(m[1]).toLowerCase();
    if (plausible(name) && !out.includes(name)) out.push(name);
  }
  return out;
}

/**
 * The nicename WordPress writes into <body class="archive author author-<x> author-<id>">.
 * This is the one that survives a 200 response: on this droplet /?author=1 does
 * NOT redirect, it serves the archive inline, so a check that only looked at
 * Location headers would have found nothing and called it clean.
 */
function namesFromBodyClass(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<body[^>]*\sclass="([^"]*)"/gi)) {
    if (!/\bauthor\b/.test(m[1])) continue;
    for (const tok of m[1].split(/\s+/)) {
      const hit = /^author-(.+)$/.exec(tok);
      if (!hit) continue;
      const name = hit[1].toLowerCase();
      if (plausible(name) && !out.includes(name)) out.push(name);
    }
  }
  return out;
}

/** The REST collection: a JSON array of user objects with id / name / slug. */
function usersFromRestJson(json) {
  if (!Array.isArray(json)) return null;
  const out = [];
  for (const u of json) {
    if (!u || typeof u !== 'object') continue;
    const slug = typeof u.slug === 'string' ? u.slug : null;
    const name = typeof u.name === 'string' ? u.name : null;
    if (slug === null && name === null && u.id === undefined) continue;
    out.push({ id: u.id ?? null, name, slug });
  }
  return out;
}

/** Is this response WordPress at all? Keeps a catch-all 200 from becoming a finding. */
function wpSignals(res) {
  const sig = [];
  const by = h(res, 'x-redirect-by');
  if (/wordpress/i.test(by)) sig.push(`X-Redirect-By: ${by}`);
  const link = h(res, 'link');
  if (/wp-json/i.test(link)) sig.push(`Link: ${link.slice(0, 120)}`);
  const body = (res.text || '').slice(0, 6000);
  if (/wp-content|wp-includes|wp-json|<body[^>]*\bclass="[^"]*\bwp-/i.test(body)) sig.push('body carries wp-* markup');
  return sig;
}

const line = (s) => String(s).replace(/\s+/g, ' ').slice(0, 220);

// ---------------------------------------------------------------------------

export default check({
  id: 'dast-wp-user-enum',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The vhost serving /resources-pro does not enumerate WordPress usernames through /?author=<n>, /wp-json/wp/v2/users or the author sitemap.',

  async run(ctx) {
    const t = deployTarget(ctx);
    const findings = [];
    let checked = 0;
    let answered = 0;

    /** name -> the vectors that exposed it, for the roll-up at the end. */
    const found = new Map();
    const record = (name, via) => {
      const k = String(name).toLowerCase();
      if (!found.has(k)) found.set(k, new Set());
      found.get(k).add(via);
    };

    // ---- 1. /?author=<n> for three ids ------------------------------------
    // Three, not a range: this is reconnaissance, and "does the author archive
    // leak a login name" is answered by the first id that exists. A default
    // install numbers the original admin 1.
    const authorHits = [];
    const authorAnswers = [];
    for (const id of [1, 2, 3]) {
      await pace(300);
      const url = `${ctx.origin}/?author=${id}`;
      const res = await httpOnce(ctx, url, { redirect: 'manual', timeoutMs: 15_000 });
      if (!res.ok) {
        findings.push(finding({
          severity: 'low',
          title: `Could not probe /?author=${id}`,
          detail: 'An unreachable probe is not a pass. This author id was NOT graded on this run.',
          evidence: `GET ${url} → ${res.error}`,
          remediation: 'Re-run when the vhost is reachable.',
        }));
        continue;
      }
      answered++;
      checked++;

      const loc = h(res, 'location');
      const names = [
        ...namesFromAuthorPaths(loc),
        ...namesFromBodyClass(res.text),
        ...namesFromAuthorPaths(res.text),
      ].filter((n, i, a) => a.indexOf(n) === i);

      authorAnswers.push(`GET ${url} → ${res.status}${loc ? `, Location: ${loc}` : ''}, ${(res.text || '').length} bytes`);
      if (!names.length) continue;
      for (const n of names) record(n, `/?author=${id}`);
      authorHits.push({
        id,
        url,
        status: res.status,
        loc,
        names,
        how: loc && namesFromAuthorPaths(loc).length
          ? `301/302 to the author archive (${loc})`
          : `200 serving the author archive inline; nicename read from <body class> and the permalinks on the page`,
      });
    }

    if (authorHits.length) {
      const all = [...new Set(authorHits.flatMap((x) => x.names))];
      findings.push(finding({
        severity: sev(t, 'medium', 'high'),
        title: `/?author=<n> enumerates WordPress login names on the Pro vhost (${all.join(', ')})`,
        detail: `${cutover(t)}The author archive maps a sequential integer to a user_nicename, which on a default install IS the login name. An unauthenticated caller walks 1, 2, 3 and reads the account list off a public site with no rate limit and nothing to log in to. That is the first half of a credential; the second half is guessable, and wp_not_on_pro_vhost already reports that /wp-login.php and /xmlrpc.php answer on this same hostname — system.multicall turns a known username plus a password list into one request per hundred guesses. Enumeration is what makes the login surface next door worth attacking, so these two findings are one chain and should be fixed together.`,
        evidence: authorHits.map((x) => `${x.url} → ${x.status}: ${x.names.join(', ')} (${x.how})`).join('\n  ')
          + (authorAnswers.length > authorHits.length ? `\n  other ids probed, no name extracted: ${authorAnswers.filter((a) => !authorHits.some((x) => a.startsWith(`GET ${x.url} `))).map(line).join(' | ')}` : ''),
        remediation: 'On the team\'s WordPress: block /?author=<n> at the vhost (redirect or 403 any request carrying an `author` query var that is numeric), which is one Apache rule and what every hardening plugin does. At cutover: /resources-pro is its own vhost with no PHP under it, so none of these paths exist to answer — re-run this check against the company host and it must find nothing.',
      }));
    } else if (answered) {
      findings.push(finding({
        severity: 'info',
        title: 'No username was extractable from /?author=1..3',
        detail: 'Recorded rather than left as a silent clean line, because "no finding" here has two very different causes: the author archive is genuinely blocked, or the probe met a catch-all that answers every path with the same page. What was observed is below; if the statuses are 200s with no author markup, read it as the second.',
        evidence: authorAnswers.map(line).join('\n  ') || '(no probe answered)',
        remediation: 'None if the archive is blocked. If these are catch-all 200s, this vector is untested rather than clean.',
      }));
    }

    // ---- 2. /wp-json/wp/v2/users ------------------------------------------
    await pace(300);
    const restUrl = `${ctx.origin}/wp-json/wp/v2/users`;
    const rest = await httpOnce(ctx, restUrl, { redirect: 'manual', timeoutMs: 15_000 });
    if (!rest.ok) {
      findings.push(finding({
        severity: 'low',
        title: 'Could not probe /wp-json/wp/v2/users',
        detail: 'An unreachable probe is not a pass. The REST user collection was NOT graded on this run.',
        evidence: `GET ${restUrl} → ${rest.error}`,
        remediation: 'Re-run when the vhost is reachable.',
      }));
    } else {
      answered++;
      checked++;
      const users = usersFromRestJson(rest.json);
      if (users && users.length) {
        for (const u of users) { if (plausible(u.slug)) record(u.slug, '/wp-json/wp/v2/users'); }
        findings.push(finding({
          severity: sev(t, 'medium', 'high'),
          title: `/wp-json/wp/v2/users returns the WordPress account list unauthenticated (${users.map((u) => u.slug || u.name || `#${u.id}`).join(', ')})`,
          detail: `${cutover(t)}This is the cleanest of the three: no parsing, no guessing at ids, one GET and a JSON array. It returns the numeric user id, the display name and the slug (the user_nicename, which on a default install is the login name) for every user who has published, and it answers with no cookie, no nonce and no Authorization header. WordPress ships this on by default. Combined with the /wp-login.php and /xmlrpc.php surfaces that wp_not_on_pro_vhost already reports on this same hostname, it is a complete target list handed over on request.`,
          evidence: `GET ${restUrl} → ${rest.status}, X-WP-Total: ${h(rest, 'x-wp-total') || '(absent)'}, ${(rest.text || '').length} bytes\n  `
            + users.map((u) => `id=${u.id} slug=${JSON.stringify(u.slug)} name=${JSON.stringify(u.name)}`).join('\n  '),
          remediation: 'On the team\'s WordPress: deny /wp-json/wp/v2/users (and /wp-json/wp/v2/users/<id>) to unauthenticated callers at the vhost, or filter rest_endpoints to drop the collection. At cutover: the Pro vhost serves a static export with no PHP mounted, so this route does not exist — re-run against the company host and it must 404.',
        }));
      } else {
        const sig = wpSignals(rest);
        // A refusal, a not-found, OR a redirect is not an account list.
        //
        // The redirect arm is not a nicety. An oauth2-proxy / OIDC gate — the
        // commonest way a vhost like this gets protected, and precisely what
        // pro_vhost_noindex_but_no_login's remediation asks for — answers 302
        // to the SSO host. Without this arm a correctly gated company box
        // reported "answered, but no account list could be parsed out of it"
        // at medium, i.e. the check went amber exactly when its own fix was
        // applied. That is the trap pro-deploy-host.mjs documents at length in
        // its section 3, and it is how a check trains people to ignore it.
        // Verified against a local blanket-301 fixture before and after.
        const redirected = rest.status >= 300 && rest.status < 400;
        const denied = rest.status === 401 || rest.status === 403 || rest.status === 404 || rest.status === 410 || redirected;
        findings.push(finding({
          severity: denied ? 'info' : sev(t, 'low', 'medium'),
          title: denied
            ? '/wp-json/wp/v2/users did not return an account list'
            : '/wp-json/wp/v2/users answered, but no account list could be parsed out of it',
          detail: denied
            ? `Recorded as an observed property rather than an absent line. The route ${redirected ? `answered ${rest.status} and redirected (not followed: a redirect is an answer, and following it would probe a second name this check was not pointed at)` : 'answered with a refusal or a not-found'}, so no names came back on this run; a regression that re-opens it flips this to the graded finding above.`
            : 'The endpoint returned 2xx with something other than a JSON array of users. That is NOT evidence of a clean site — a catch-all 200, an SPA rewrite or a soft-404 page produces the same shape — so it is reported as an untested vector rather than a pass. A vhost serving a static export has no reason to answer this path at all.',
          evidence: `GET ${restUrl} → ${rest.status}, content-type: ${h(rest, 'content-type') || '(absent)'}, ${(rest.text || '').length} bytes${sig.length ? `; WordPress signals: ${sig.join('; ')}` : '; no WordPress marker in the response'}\n  body head: ${line((rest.text || '').slice(0, 300)) || '(empty)'}`,
          remediation: denied ? 'No action.' : 'Confirm by hand what this route is serving; if it is a catch-all, this vector cannot be graded from outside.',
        }));
      }
    }

    // ---- 3. the author sitemap, with a control ----------------------------
    // The control comes FIRST so a blanket-redirect host is identified before
    // the real path's status is interpreted.
    await pace(300);
    const controlUrl = `${ctx.origin}/wp-sitemap-zz${Date.now().toString(36)}-99.xml`;
    const control = await httpOnce(ctx, controlUrl, { redirect: 'manual', timeoutMs: 15_000 });

    await pace(300);
    const mapUrl = `${ctx.origin}/wp-sitemap-users-1.xml`;
    const map = await httpOnce(ctx, mapUrl, { redirect: 'manual', timeoutMs: 15_000 });

    if (!map.ok) {
      findings.push(finding({
        severity: 'low',
        title: 'Could not probe /wp-sitemap-users-1.xml',
        detail: 'An unreachable probe is not a pass. The author sitemap was NOT graded on this run.',
        evidence: `GET ${mapUrl} → ${map.error}`,
        remediation: 'Re-run when the vhost is reachable.',
      }));
    } else {
      answered++;
      checked++;
      if (control.ok) checked++;

      const mapNames = [...namesFromAuthorPaths(map.text), ...namesFromAuthorPaths(h(map, 'location'))]
        .filter((n, i, a) => a.indexOf(n) === i);
      const controlState = control.ok ? `${control.status}` : `unreachable (${control.error})`;
      // The route "exists" only when it behaves DIFFERENTLY from a path that
      // cannot exist. Observed on this droplet: control 404, real path 301.
      const distinctFromControl = control.ok && control.status === 404 && map.status !== 404;
      const sig = wpSignals(map);

      if (mapNames.length) {
        for (const n of mapNames) record(n, '/wp-sitemap-users-1.xml');
        findings.push(finding({
          severity: sev(t, 'medium', 'high'),
          title: `The WordPress author sitemap lists login names (${mapNames.join(', ')})`,
          detail: `${cutover(t)}WordPress 5.5+ generates /wp-sitemap-users-1.xml and links it from /wp-sitemap.xml, so the author list is not merely reachable, it is advertised to every crawler that reads the sitemap index. Each <loc> is an author archive URL whose path segment is the user_nicename.`,
          evidence: `GET ${mapUrl} → ${map.status}, ${(map.text || '').length} bytes; control GET ${controlUrl} → ${controlState}\n  names: ${mapNames.join(', ')}`,
          remediation: 'On the team\'s WordPress: filter wp_sitemaps_add_provider to drop the "users" provider, or deny /wp-sitemap-users-*.xml at the vhost. At cutover: no PHP under the Pro vhost means no generated sitemap — re-run against the company host and it must 404.',
        }));
      } else if (distinctFromControl) {
        findings.push(finding({
          severity: sev(t, 'medium', 'high'),
          title: 'The WordPress author sitemap route exists on the Pro vhost (names not read on this run)',
          detail: `${cutover(t)}A path that cannot exist 404s here while /wp-sitemap-users-1.xml does not, so the author-sitemap route is live — this is not a host that redirects everything. The names themselves were not read because the response is a redirect OFF this vhost (to the WordPress canonical site URL, a different hostname) and this check does not follow cross-host redirects: following would mean probing a second name, under a certificate that does not match it, which is more reach than a recon check should take without being asked. Treat this as "the author sitemap is published here" — the same exposure as the graded finding above, one hop away.`,
          evidence: `GET ${mapUrl} → ${map.status}${h(map, 'location') ? `, Location: ${h(map, 'location')}` : ''}, ${(map.text || '').length} bytes\n  CONTROL GET ${controlUrl} → ${controlState} (a sitemap path that cannot exist)\n  ${sig.length ? `WordPress signals: ${sig.join('; ')}` : 'no WordPress marker in the response'}`,
          remediation: 'Confirm by requesting the Location target by hand. Then: drop the "users" sitemap provider on the team\'s WordPress, or deny /wp-sitemap-users-*.xml at the vhost. At cutover the Pro vhost must 404 this path.',
        }));
      } else {
        findings.push(finding({
          severity: 'info',
          title: 'The author sitemap did not distinguish itself from a nonexistent sitemap path',
          detail: 'Reported as an observed comparison rather than a clean tick. The real path and a deliberately-impossible one answered the same way, so either the author sitemap is not published here, or this host answers everything alike and the vector cannot be graded from outside.',
          evidence: `GET ${mapUrl} → ${map.status}, ${(map.text || '').length} bytes\n  CONTROL GET ${controlUrl} → ${controlState}\n  ${sig.length ? `WordPress signals: ${sig.join('; ')}` : 'no WordPress marker in the response'}`,
          remediation: 'None if the sitemap is absent. If both were catch-all 200s, this vector is untested rather than clean.',
        }));
      }
    }

    // ---- 4. the login-form username oracle: NOT TESTED --------------------
    // Deliberately loud. A leg that is silently absent reads, to whoever scans
    // this report, exactly like a leg that passed.
    findings.push(finding({
      severity: 'info',
      title: 'The wp-login.php username oracle was NOT tested, and cannot be tested safely from here',
      detail: 'WordPress answers a bad username with "Unknown username" and a good one with "The password you entered for the username X is incorrect", which is a username oracle in the error text and a genuine enumeration vector. Reaching that text requires POSTing `log` and `pwd` to the live login form of the team\'s production WordPress: a credential submission and a failed-authentication event on an application we do not own, written into their logs and counted by whatever lockout plugin is installed. This check does not do it — no POST, no credentials, on any target — so this vector is UNTESTED, not clean. It is written here as a finding so the gap is visible in the report instead of being an absence nobody notices.',
      evidence: `not attempted by design; the three GET-only vectors above found ${found.size} distinct name(s)${found.size ? `: ${[...found.keys()].join(', ')}` : ''}`,
      remediation: 'Test this leg by hand, once, against a staging WordPress with a throwaway account — never against the team\'s production install from an automated nightly run.',
    }));

    if (!answered) {
      throw new Skip(`no user-enumeration probe answered on ${ctx.origin} — nothing was graded, and this is not a pass`);
    }

    // ---- 5. the roll-up ---------------------------------------------------
    // One line a human can act on, instead of reading three findings to learn
    // there is exactly one account called "david".
    if (found.size) {
      checked += found.size;
      findings.push(finding({
        severity: 'info',
        title: `WordPress usernames exposed on this vhost: ${[...found.keys()].join(', ')}`,
        detail: 'The roll-up of every name the GET-only vectors above produced, with which vector produced it. Kept as one line because the fix is per-vector but the exposure is per-name: closing two of three still leaks the same account.',
        evidence: [...found.entries()].map(([n, via]) => `${n} — via ${[...via].join(', ')}`).join('\n  '),
        remediation: 'Close every vector listed against each name; a name reachable by any one of them is still enumerated.',
      }));
    }

    return { findings, checked };
  },
});
