/**
 * The Content-Security-Policy is the runtime half of "this site loads nothing
 * from anyone else" — and nothing in the repo guards it.
 *
 * Five commits ago, ffa99bc fixed a live CSP that still named two origins from
 * a hosting platform the project had left. That was not cosmetic: once that
 * account closes, those subdomains are free for anyone to register, so the
 * policy was naming an attacker-claimable origin as a permitted fetch
 * destination — a ready-made exfiltration channel for any future injection.
 * It survived because the guard that was supposed to catch it walked
 * .ts/.tsx/.mjs/.js/.sh/.json/.css and never opened a .conf file.
 *
 * What replaced it is thinner than it looks. scripts/security-smoke.mjs:91
 * asserts `/default-src|script-src/.test(csp)` — that a CSP exists. Adding
 * fonts.googleapis.com to style-src, or an analytics host to connect-src,
 * passes that assertion without a murmur. So the regression that was just
 * fixed can come straight back.
 *
 * Two checks, because they fail in different ways and one cannot cover the
 * other:
 *
 *   cmp-csp-committed-no-foreign-origin (offline, every commit) reads
 *   scripts/droplet-htaccess.conf and refuses a foreign origin in the policy
 *   AT ALL. This is the one that would have caught ffa99bc, and it is the
 *   reason the live comparison below is not circular: without it, widening the
 *   .conf and re-running droplet-server-config.sh would make live and
 *   committed agree on something worse.
 *
 *   cmp-live-csp-matches-committed (nightly) reads the header the browser
 *   actually receives, on both tiers, and compares it directive by directive
 *   with the committed one. scripts/deploy.sh does check the live .htaccess
 *   block before it ships — but only on a deploy, and DEPLOY_SKIP_HTACCESS_
 *   CHECK=1 turns that off. The header can also be changed by anyone editing
 *   the SHARED $WEB_ROOT/.htaccess, which is the team's WordPress .htaccess as
 *   well. Nothing else watches it between deploys.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

const CONF = 'scripts/droplet-htaccess.conf';

/** The Content-Security-Policy value the repo says the droplet should serve. */
function committedCsp(repoRoot) {
  const p = join(repoRoot, CONF);
  if (!existsSync(p)) throw new Skip(`${CONF} not found — this is the file that actually sets the live headers (a static export runs no Next.js server, so next.config.ts headers() never execute)`);
  const text = readFileSync(p, 'utf-8');
  const hits = [...text.matchAll(/^\s*Header\s+always\s+set\s+Content-Security-Policy\s+"([^"]+)"/gim)].map((m) => m[1].trim());
  if (!hits.length) throw new Skip(`${CONF} sets no Content-Security-Policy — either the managed block has been gutted or this check is reading the wrong file; both are worth a human looking`);
  return hits;
}

/** "a 'self'; b c" -> Map{a: ["'self'"], b: ["c"]} */
function directives(csp) {
  const out = new Map();
  for (const part of csp.split(';')) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) continue;
    out.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return out;
}

/** Keyword and scheme sources name no third party; anything else is a host. */
const KEYWORD = /^'(?:self|none|unsafe-inline|unsafe-eval|unsafe-hashes|strict-dynamic|report-sample|wasm-unsafe-eval|nonce-[^']+|sha(?:256|384|512)-[^']+)'$/i;
// data: and blob: reach no server at all — a font or an image inlined into
// the page is not a third-party load, and treating `font-src 'self' data:` as
// a finding is exactly the kind of noise that gets a check switched off. Only
// schemes that can open a connection matter here.
const LOCAL_SCHEME = /^(?:data|blob|filesystem|mediastream):$/i;
const NETWORK_SCHEME = /^(?:https|http|ws|wss):$/i;

const committed = check({
  id: 'cmp-csp-committed-no-foreign-origin',
  discipline: 'compliance',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The CSP in scripts/droplet-htaccess.conf names no third-party origin in any fetch directive — the check that would have caught the two dead platform hosts that sat in connect-src for three weeks.',
  async run(ctx) {
    const policies = committedCsp(ctx.repoRoot);
    const findings = [];
    let checked = 0;

    for (const csp of policies) {
      const d = directives(csp);
      checked += d.size;

      // img-src is the documented exception: it carries `https:` so that the
      // metadata and screenshot tools can preview an image the visitor chose.
      // That is a real hole — it is the one directive that would not stop a
      // third-party tracking pixel — which is why the build-time check
      // (cmp-no-third-party-subresources) is load-bearing for <img> rather
      // than belt-and-braces. A NAMED third-party host in img-src is still a
      // finding; a scheme source there is the known, accepted state.
      for (const [name, sources] of d) {
        if (!/-src$|^form-action$|^base-uri$|^frame-ancestors$/.test(name)) continue;
        for (const s of sources) {
          if (KEYWORD.test(s) || LOCAL_SCHEME.test(s)) continue;
          if (NETWORK_SCHEME.test(s)) {
            if (name === 'img-src') continue;
            findings.push(finding({
              severity: 'high',
              title: `CSP ${name} allows a whole scheme: ${s}`,
              detail: `A scheme source in ${name} permits every host on that scheme. On this site the point of the policy is that nothing but our own origin is reachable; img-src carries https: deliberately and is the documented exception, but ${name} is not.`,
              evidence: `${CONF}: ${name} ${sources.join(' ')}`,
              remediation: `Narrow ${name} back to 'self' (plus the hashes or nonces it genuinely needs).`,
              file: CONF,
            }));
            continue;
          }
          findings.push(finding({
            severity: 'high',
            title: `CSP ${name} names a third-party origin: ${s}`,
            detail: `The committed policy lists ${s} as a permitted ${name} source. Two things follow. It is a fetch destination for any future injection on these pages — and the last time this happened the hosts belonged to an account the project was closing, so the domains would have become registerable by anyone while the policy still blessed them. It is also a consent question: a site that can load from a third party is not a site with no consent obligation.`,
            evidence: `${CONF}: ${name} ${sources.join(' ')}`,
            remediation: `Remove ${s}. If a third-party load is genuinely wanted, it needs a decision about consent and about what it does to the product's own claims — not a directive edit.`,
            file: CONF,
          }));
        }
      }

      // A policy missing its load-bearing directives is as good as absent, and
      // security-smoke.mjs would still call it present.
      for (const required of ['default-src', 'script-src', 'connect-src', 'frame-ancestors', 'object-src', 'base-uri']) {
        if (d.has(required)) continue;
        findings.push(finding({
          severity: 'high',
          title: `CSP has no ${required}`,
          detail: `${required} is one of the directives this site's policy rests on. scripts/security-smoke.mjs only asserts that a CSP exists, so a policy that has lost a directive still passes the live smoke test.`,
          evidence: `${CONF}: ${csp}`,
          remediation: `Restore ${required} in the managed block and re-run ./scripts/droplet-server-config.sh.`,
          file: CONF,
        }));
      }
    }
    return { findings, checked };
  },
});

const live = check({
  id: 'cmp-live-csp-matches-committed',
  discipline: 'compliance',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The CSP the browser actually receives, on both tiers, matches scripts/droplet-htaccess.conf directive for directive — not merely "a CSP is present", which is all the live smoke test asserts.',
  async run(ctx) {
    const want = directives(committedCsp(ctx.repoRoot)[0]);
    const findings = [];
    let checked = 0;

    for (const [tier, url] of [['free', `${ctx.freeBase}/tools/`], ['pro', `${ctx.proBase}/tools/`]]) {
      const res = await ctx.http(url, { timeoutMs: 20_000, redirect: 'follow' });
      if (!res.ok || res.status !== 200) {
        // One tier unreachable is not a pass for that tier. Say which.
        findings.push(finding({
          severity: 'medium',
          title: `Could not read the ${tier} tier to check its CSP`,
          detail: 'A header that cannot be read has not been verified. Reporting this rather than quietly grading one tier is the whole point of the suite.',
          evidence: `GET ${url} -> ${res.ok ? `HTTP ${res.status}` : `no response (${res.error})`}`,
          remediation: 'Check the site is up, then re-run.',
        }));
        continue;
      }
      checked += 1;
      const header = res.headers.get('content-security-policy');
      if (!header) {
        findings.push(finding({
          severity: 'high',
          title: `The ${tier} tier is served with no Content-Security-Policy`,
          detail: 'The managed block in the shared $WEB_ROOT/.htaccess sets this header. Its absence means the block is gone or no longer applies to this path — and the sites are being served with the runtime control removed.',
          evidence: `GET ${url} -> 200, no Content-Security-Policy header\nexpected: ${[...want].map(([k, v]) => [k, ...v].join(' ')).join('; ')}`,
          remediation: 'Re-apply it: ./scripts/droplet-server-config.sh',
        }));
        continue;
      }
      const got = directives(header);
      const diffs = [];
      for (const [name, sources] of want) {
        if (!got.has(name)) { diffs.push(`MISSING live: ${name} ${sources.join(' ')}`); continue; }
        const a = [...sources].sort().join(' ');
        const b = [...got.get(name)].sort().join(' ');
        if (a !== b) diffs.push(`${name}: repo "${sources.join(' ')}" vs live "${got.get(name).join(' ')}"`);
      }
      for (const [name, sources] of got) {
        if (!want.has(name)) diffs.push(`EXTRA live: ${name} ${sources.join(' ')}`);
      }
      if (diffs.length) {
        findings.push(finding({
          severity: 'high',
          title: `The live CSP on the ${tier} tier does not match ${CONF}`,
          detail: `The header the browser receives has drifted from the reviewed one. Drift is not theoretical here: the live policy went on allowing two departed third-party origins for three weeks after the repo stopped naming them, because editing the .conf changes nothing until someone runs droplet-server-config.sh. scripts/deploy.sh checks this, but only on a deploy and only when DEPLOY_SKIP_HTACCESS_CHECK is unset — and that .htaccess is shared with the team's WordPress, so someone else can edit it.`,
          evidence: `GET ${url}\nlive: ${header}\nrepo: ${[...want].map(([k, v]) => [k, ...v].join(' ')).join('; ')}\n\n${diffs.join('\n')}`,
          remediation: 'Decide which one is right. If the repo is: ./scripts/droplet-server-config.sh. If live is: commit the change to scripts/droplet-htaccess.conf so the next person sees it.',
          file: CONF,
        }));
      }
    }
    if (!checked && !findings.length) throw new Skip('neither tier answered, and nothing was graded');
    return { findings, checked };
  },
});

export default [committed, live];
