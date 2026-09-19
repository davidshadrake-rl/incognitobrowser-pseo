/**
 * No config file, dotfile, backup or source map is reachable over HTTP.
 *
 * Three concrete ways this repo can put one inside the DocumentRoot:
 *
 *  (a) scripts/deploy.sh does `cp scripts/site.htaccess out/.htaccess` and
 *      rsyncs out/ wholesale, so a config file ships INSIDE each site root by
 *      design. Only Apache's stock `^\.ht` deny keeps it private. Anything
 *      else that ends up in out/ — a .env someone copied in while debugging, a
 *      .git directory, a .DS_Store — is covered by nothing but the deny rules
 *      in scripts/site.htaccess and the managed block, and rsync --delete
 *      copies whatever is there. "We didn't put one there" is not a control.
 *  (b) scripts/droplet-server-config.sh writes `.htaccess.bak.<epoch>` into
 *      the web root every time it runs.
 *  (c) Turning on productionBrowserSourceMaps would publish readable source
 *      for the whole client bundle. The current build emits no .map files, so
 *      this half asserts the absence stays true, and probes any map it finds.
 *
 * The probe list is the fixed set PLUS every dotfile the local build actually
 * contains, which is the part that has teeth: it tests the deny rule against a
 * file that is genuinely deployed, rather than against a path that 404s for
 * the boring reason. /.well-known/ is exempt everywhere — ACME writes the
 * certificate-renewal challenge there, and a renewal that fails takes the site
 * dark behind its own two-year HSTS.
 *
 * version.txt is an intentional 200 and is asserted as such, so a future
 * reader never mistakes it for a leak, and so a deploy that stops shipping it
 * shows up here.
 *
 * HEAD, not GET, for the probes: the 404 page on this host is ~36 KB, and
 * fetching thirty of them nightly to read a status code is rude to a 2-vCPU
 * box that also serves the team's WordPress. A body is only fetched when a
 * probe comes back 200 and evidence is needed.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { pace, httpOnce } from './dast-shared.mjs';

const SENSITIVE = [
  '.env', '.env.local', '.env.production', '.secrets',
  'package.json', 'package-lock.json',
  '.git/config', '.git/HEAD',
  '.DS_Store',
  '.htaccess.bak', 'out.zip', 'backup.tar.gz',
];

/** Root-level paths worth asking about, kept short: the web root is shared. */
const ROOT_PATHS = ['/.env', '/.secrets', '/.htaccess.bak', '/.git/config'];

/**
 * Dotfiles that are KNOWN to ship inside each site folder. These are the ones
 * with teeth: a 404 on /resources/.env proves only that nobody has left a .env
 * there yet, while a file that is genuinely on disk tests the deny rule
 * itself. They are listed here rather than derived from out/ because
 * .build-marker.json is written by scripts/write-build-marker.mjs during a
 * deploy, so a local `npm run build` does not produce it and the derived walk
 * would silently drop the one probe that matters.
 *
 * scripts/site.htaccess says of .build-marker.json, in its own words, that it
 * "is denied along with the rest, and that breaks nothing". This asserts that.
 */
const DEPLOYED_DOTFILES = ['.htaccess', '.build-marker.json'];

function dotfilesIn(root) {
  const found = [];
  const walk = (dir, rel, depth) => {
    if (depth > 3 || found.length >= 12) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (found.length >= 12) return;
      if (e === '.well-known') continue; // ACME. Must keep answering.
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (e.startsWith('.')) {
        if (st.isFile()) found.push(`${rel}${e}`);
        continue;
      }
      if (st.isDirectory() && !rel.startsWith('/_next/')) walk(full, `${rel}${e}/`, depth + 1);
    }
  };
  walk(root, '/', 0);
  return found;
}

function mapsIn(root) {
  const found = [];
  const walk = (dir, rel, depth) => {
    if (depth > 6 || found.length >= 5) return;
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (found.length >= 5) return;
      const full = join(dir, e);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full, `${rel}${e}/`, depth + 1);
      else if (e.endsWith('.map')) found.push(`${rel}${e}`);
    }
  };
  walk(root, '/', 0);
  return found;
}

export default check({
  id: 'dast-exposed-files',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network', 'build-output'],
  describe: 'Dotfiles, config, backups and source maps under the two site roots and the shared web root are not served.',

  async run(ctx) {
    const out = join(ctx.repoRoot, 'out');
    const buildDotfiles = existsSync(out) ? dotfilesIn(out) : [];
    const buildMaps = existsSync(out) ? mapsIn(out) : [];
    if (!existsSync(out)) {
      // Still worth running against the fixed list — but say so, because the
      // half with teeth (a file we know is deployed) did not run.
      // Not a Skip: the fixed list alone is a real probe.
    }

    const findings = [];
    let checked = 0;

    const probe = async (url) => {
      await pace();
      checked++;
      const head = await httpOnce(ctx, url, { method: 'HEAD', redirect: 'manual' });
      return head;
    };

    const siteTargets = [];
    for (const root of ['/resources', '/resources-pro']) {
      for (const p of [...SENSITIVE, ...DEPLOYED_DOTFILES]) siteTargets.push(`${root}/${p}`);
      for (const p of buildDotfiles) siteTargets.push(`${root}${p}`);
      for (const p of buildMaps) siteTargets.push(`${root}${p}`);
    }

    for (const path of [...new Set(siteTargets)]) {
      const url = ctx.origin + path;
      const res = await probe(url);
      if (!res.ok) {
        findings.push(finding({
          severity: 'low',
          title: `Could not reach ${path}`,
          detail: 'An unreachable probe is not a pass.',
          evidence: `HEAD ${url} → ${res.error}`,
          remediation: 'Re-run when the droplet is reachable.',
        }));
        continue;
      }
      if (res.status !== 200) continue;

      const body = await httpOnce(ctx, url, { redirect: 'manual' });
      const isDotfile = /(^|\/)\./.test(path.replace(/^\/resources(-pro)?/, ''));
      findings.push(finding({
        severity: path.endsWith('.map') ? 'medium' : isDotfile ? 'medium' : 'high',
        title: `${path} is served`,
        detail: isDotfile
          ? 'The dotfile deny is not in force for this path. scripts/site.htaccess ships `RedirectMatch 403 "(^|/)\\.(?!well-known/)"` inside every site folder and the managed block carries the same deny as a rewrite — one of them is not applying. That rule is the only thing standing between a stray .env or .git in out/ and the internet, and rsync --delete ships whatever is in out/.'
          : 'A file that should never be reachable from the DocumentRoot is being served.',
        evidence: `HEAD ${url} → 200, content-type ${res.headers.get('content-type') || '(none)'}, ${res.headers.get('content-length') || '?'} bytes\n  body starts: ${body.text.replace(/\s+/g, ' ').slice(0, 160)}`,
        remediation: isDotfile
          ? 'Work out why the deny is not applying (AllowOverride on /var/www/html, or the managed block being stale), then re-run scripts/droplet-server-config.sh and redeploy so scripts/site.htaccess lands in both site roots. Verify with: curl -sk -o /dev/null -w "%{http_code}" ' + ctx.origin + path + ' → expect 403.'
          : 'Remove the file from out/ and from the server, and confirm the deny rules cover its shape.',
        file: 'scripts/site.htaccess',
      }));
    }

    for (const path of ROOT_PATHS) {
      const url = ctx.origin + path;
      const res = await probe(url);
      if (!res.ok || res.status !== 200) continue;
      findings.push(finding({
        severity: 'high',
        title: `${path} is served from the shared web root`,
        detail: 'The web root is shared with the team\'s WordPress. A readable config or key file there is the whole box, not just our two folders.',
        evidence: `HEAD ${url} → 200, ${res.headers.get('content-length') || '?'} bytes, content-type ${res.headers.get('content-type') || '(none)'}`,
        remediation: 'Remove it from /var/www/html and add a deny for its shape.',
      }));
    }

    // version.txt is a deliberate 200 — the one file that tells an outsider
    // what is live. Asserted so it never reads as a leak, and so a deploy that
    // stops shipping it is visible.
    for (const root of ['/resources', '/resources-pro']) {
      const url = `${ctx.origin}${root}/version.txt`;
      const res = await probe(url);
      if (res.ok && res.status === 200) continue;
      findings.push(finding({
        severity: 'low',
        title: `${root}/version.txt is not being served`,
        detail: 'It is the intentional 200 that says what build is live, and DEPLOYMENT.md treats it as the answer to "what is deployed". Its absence means a deploy did not complete, or the deny rules have grown too wide.',
        evidence: `HEAD ${url} → ${res.ok ? res.status : res.error}`,
        remediation: 'Re-run npm run deploy and check scripts/write-build-marker.mjs still writes it.',
      }));
    }

    if (buildMaps.length) {
      findings.push(finding({
        severity: 'medium',
        title: `The local build contains ${buildMaps.length} source map(s)`,
        detail: 'Source maps publish readable source for the client bundle. The build emitted none when this check was written; something turned productionBrowserSourceMaps on, or a dependency shipped its own.',
        evidence: `out/: ${buildMaps.join(', ')}`,
        remediation: 'Leave productionBrowserSourceMaps off, and exclude *.map from the rsync if a dependency insists on emitting them.',
        file: 'next.config.ts',
      }));
    }

    if (!existsSync(out)) {
      findings.push(finding({
        severity: 'info',
        title: 'No out/ build present — only the fixed path list was probed',
        detail: 'The half of this check with teeth tests the deny rule against a dotfile that is genuinely deployed. Without a build there was nothing to derive.',
        evidence: `${out} does not exist`,
        remediation: 'Run npm run build before the nightly, or accept reduced coverage.',
      }));
    }

    return { findings, checked };
  },
});
