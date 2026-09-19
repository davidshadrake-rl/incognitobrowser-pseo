/**
 * What the live web roots actually serve when you ask for a dotfile.
 *
 * The droplet's DocumentRoot is /var/www/html, shared with the team's
 * WordPress. scripts/deploy.sh only rsyncs the two site folders under it, with
 * --delete scoped to those folders, so anything that lands in the shared root
 * by other means — a .env scp'd there during debugging, a `git clone` leaving a
 * .git/ directory, an editor swap file — stays there and is served.
 *
 * scripts/droplet-htaccess.conf now carries a rewrite that 403s dotfiles under
 * /resources and /resources-pro (with a /.well-known/ exemption, because ACME
 * writes the certificate-renewal challenge there and a failed renewal takes the
 * site dark behind its own two-year HSTS). That rule is scoped to those two
 * folders on purpose — the shared root's dotfiles are the other application's
 * business. Which means the shared root has no blanket protection beyond
 * Ubuntu's stock `.ht*` deny, and this is the tripwire for the day something
 * appears there.
 *
 * It is a verification, not an attack: a dozen plain GETs for paths that should
 * not exist. No proof-of-work, no scans, no Redis writes, no rate-limit budget.
 */
import { check, finding, Skip } from '../lib/harness.mjs';

export default check({
  id: 'secret-published-dotfile-probe',
  discipline: 'secrets',
  cadence: 'nightly',
  severity: 'high',
  // Marked opt-in on review's call. The probe's own cost is twelve GETs against
  // static paths and a HEAD for a source map — genuinely gentle. But the live
  // box is 2 vCPU also serving WordPress and MySQL, and "it is only twelve
  // requests" is how a nightly job becomes a standing load nobody remembers
  // adding. The runner announces withheld checks by id, so this is visible
  // rather than quietly dropped; run it with
  //   node scripts/security/run.mjs --only=secret-published-dotfile-probe
  needsOptIn: true,
  safeAgainstProd: true,
  requires: ['network'],
  describe: 'The live site serves no .env, .secrets, .git/ or source map from either web root or the shared WordPress root.',
  async run(ctx) {
    const origin = ctx.origin.replace(/\/$/, '');

    // Fixed list. No directory walking, no guessing at filenames — a fixed list
    // cannot accidentally turn into a scan of somebody else's application.
    const targets = [
      // The shared WordPress root, which no deploy manages.
      { path: '/.env', why: 'an env file in the shared DocumentRoot' },
      { path: '/.secrets', why: 'the droplet login file in the shared DocumentRoot' },
      { path: '/.git/config', why: 'a git checkout left in the web root — config names the remote' },
      { path: '/.git/HEAD', why: 'a git checkout left in the web root' },
      { path: '/wp-config.php.bak', why: 'an editor or upgrade backup of the WordPress DB credentials' },
      // The free site.
      { path: '/resources/.env', why: 'an env file inside the free site export' },
      { path: '/resources/.secrets', why: 'the droplet login file inside the free site export' },
      { path: '/resources/.git/config', why: 'a git checkout inside the free site export' },
      { path: '/resources/.htaccess', why: 'the per-site .htaccess, which should be denied not served' },
      // The Pro site.
      { path: '/resources-pro/.env', why: 'an env file inside the Pro site export' },
      { path: '/resources-pro/.secrets', why: 'the droplet login file inside the Pro site export' },
      { path: '/resources-pro/.git/config', why: 'a git checkout inside the Pro site export' },
    ];

    // Reachability first. A site that is down must not read as twelve passes.
    const probe = await ctx.http(`${origin}/resources/`, { method: 'GET', timeoutMs: 15_000 });
    if (!probe.ok) throw new Skip(`${origin}/resources/ unreachable: ${probe.error}`);

    const findings = [];
    let checked = 0;

    for (const t of targets) {
      const url = `${origin}${t.path}`;
      const res = await ctx.http(url, { method: 'GET', timeoutMs: 15_000 });
      if (!res.ok) {
        // A transport failure is not a pass and not a finding — it means this
        // path went ungraded, and the count must not pretend otherwise.
        findings.push(finding({
          severity: 'info',
          title: `could not probe ${t.path}`,
          detail: 'The request failed at the transport layer, so this path was not graded by this run.',
          evidence: `GET ${url} → ${res.error}`,
          remediation: 'Re-run when the network path to the droplet is healthy.',
        }));
        continue;
      }
      checked += 1;
      if (res.status !== 200) continue;

      findings.push(finding({
        severity: 'high',
        title: `live site serves ${t.path}`,
        detail:
          `${t.why}. A 200 here means the file exists in a public web root and its contents are on the internet. `
          + 'On this box that root is shared with WordPress and MySQL, and the API has no auth layer, so anything resembling a credential found here should be treated as already used.',
        evidence: `GET ${url} → ${res.status}, ${res.text.length} bytes, content-type ${res.headers.get('content-type') || '(none)'}; first bytes: ${JSON.stringify(res.text.slice(0, 120))}`,
        remediation:
          'Remove the file from the web root. Then extend the dotfile deny in scripts/droplet-htaccess.conf beyond /resources and /resources-pro, '
          + 'keeping the /.well-known/ exemption, and apply it with scripts/droplet-server-config.sh — editing the .conf alone changes nothing on the server.',
      }));
    }

    // Source maps, from the live bundle rather than from a guess. Take the free
    // site's homepage, read the first _next chunk it actually references, and
    // ask for that chunk's .map. If one is served, the site's TypeScript is
    // public — including anything a developer inlined while debugging.
    const home = await ctx.http(`${origin}/resources/`, { method: 'GET', timeoutMs: 15_000 });
    if (home.ok && home.status === 200) {
      const m = /["'](\/resources\/_next\/static\/[^"']+\.js)["']/.exec(home.text);
      if (m) {
        const mapUrl = `${origin}${m[1]}.map`;
        const res = await ctx.http(mapUrl, { method: 'GET', timeoutMs: 15_000 });
        if (res.ok) {
          checked += 1;
          if (res.status === 200) {
            findings.push(finding({
              severity: 'high',
              title: 'live site serves a JavaScript source map',
              detail:
                'A .map next to a shipped chunk publishes the original TypeScript of the site. Whoever enabled it did not intend to, '
                + 'and it turns every constant a developer inlined into a published one.',
              evidence: `GET ${mapUrl} → ${res.status}, ${res.text.length} bytes`,
              remediation: 'Confirm productionBrowserSourceMaps is not set in next.config.ts, rebuild, and redeploy — the rsync uses --delete so the stale maps will go.',
            }));
          }
        }
      }
    }

    if (!checked) throw new Skip('no target could be probed — every request failed at the transport layer');
    return { checked, findings };
  },
});
