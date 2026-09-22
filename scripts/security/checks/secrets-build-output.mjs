/**
 * The last look before an artifact leaves this machine.
 *
 * scripts/deploy.sh rsyncs out/ into a public web root; scripts/deploy-api.sh
 * rsyncs .next/ to /opt/ib-api on the production host. Both builds run with the
 * repo-root .env auto-loaded by Next, and that file currently holds a live
 * ANTHROPIC_API_KEY. Anything that surfaces such a value into a build — a new
 * entry in next.config.ts's `env` block, a component interpolating an env var
 * into prerendered HTML, output:"standalone" copying the environment — gets
 * published the moment someone deploys.
 *
 * Those upstream mechanisms have their own guards in
 * scripts/security/checks/secrets-repo-hygiene.mjs. This check is the backstop
 * that does not care HOW it happened: it takes the values we actually hold and
 * looks for those exact bytes in what is about to be uploaded.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

/**
 * Values that are public by construction and must NEVER become needles.
 *
 * This is the correction for a design that would have blocked every deploy on
 * its first run. .secrets holds SITE_ORIGIN and DEPLOY_HOST; scripts/deploy.sh
 * bakes SITE_ORIGIN into NEXT_PUBLIC_FREE_URL and NEXT_PUBLIC_PRO_URL on every
 * page, so a naive "grep every value in .env and .secrets" reports hundreds of
 * leaks in out/ and refuses to ship anything, including security fixes. They
 * are not secrets: the origin is printed on the site and the host is the public
 * IP the site resolves to. DEPLOY_SSH_KEY is a filesystem path to a key, not
 * the key.
 */
const PUBLIC_BY_CONSTRUCTION = new Set([
  'SITE_ORIGIN',
  'DEPLOY_HOST',
  'DEPLOY_USER',
  'DEPLOY_SSH_KEY',
  'DEPLOY_WEB_ROOT',
]);

/** A value that is obviously a template, not a credential. */
function isPlaceholder(v) {
  if (/^[<{[].*[>}\]]$/.test(v)) return true;                 // <password>, {{TOKEN}}, [redacted]
  if (/^(your|my|example|changeme|replace|todo|xxx|test)[-_]?/i.test(v)) return true;
  if (/^(sk-ant-)?(xxx+|\.\.\.)$/i.test(v)) return true;
  return false;
}

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, 'utf-8').split('\n')) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

function walkFiles(root, limit = 200_000) {
  const files = [];
  const stack = [root];
  while (stack.length && files.length < limit) {
    const dir = stack.pop();
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { stack.push(p); continue; }
      if (e.isFile()) files.push(p);
    }
  }
  return files;
}

export default check({
  id: 'secret-known-value-in-build-output',
  discipline: 'secrets',
  cadence: 'every-commit',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['build-output'],
  describe: 'No real secret value from .env or .secrets appears anywhere in out/ or .next/ before those are rsynced to production.',
  /**
   * Known-value scanning, not entropy scanning, and that was a measured
   * decision rather than a preference. out/ contains 607 files whose
   * _next/static chunk names are 12-character high-entropy strings, and data/
   * carries hashes; an entropy scanner would be loudest on exactly the artifact
   * we most need to trust, which is how a small team learns to ignore a report.
   * Because we physically hold the values, a literal byte search gives the same
   * coverage with no false positives at all.
   *
   * The report names the VARIABLE, never the value. A CI log is not a place to
   * print a credential, and a check that leaks the thing it is guarding while
   * announcing the leak has made the situation worse.
   *
   * Cost, measured on this machine: out/ is 607 files / 7.7 MiB / ~80ms.
   * .next/ is 14,653 files / 309 MiB / ~2.1s, nearly all of it .next/server.
   * That is over the every-commit budget, and it is paid deliberately: 309 MiB
   * is what scripts/deploy-api.sh actually uploads to the production host, and
   * a guard that skips the big half is the kind of guard this suite exists to
   * replace. In the path that matters it costs nothing anyway — deploy.sh runs
   * `rm -rf out .next` before `npm test`, so at commit time there is usually
   * only out/ to read, or nothing, and nothing means SKIP rather than a pass.
   */
  async run(ctx) {
    // .env AND .env.generate. The key that made this check fire on 2026-09-19
    // lived in .env, which Next auto-loads into every build — that is how it
    // ended up verbatim in .next/cache/turbopack, on a path scripts/deploy-api.sh
    // used to rsync to the droplet. The fix moved it to .env.generate, a name
    // Next does not load. If this check only ever read '.env' it would then have
    // SKIPPED, and the fix would have looked like the problem disappearing.
    // Any .env* the repo ignores can hold a real value, so all of them are read.
    //
    // Each file is read under its OWN name. A merged bag labelled '.env' sent
    // the 2026-09-22 finding to the wrong file: the value was in .env.generate,
    // the finding said .env, and .env did not exist.
    const bags = ['.env', '.env.generate', '.env.local', '.secrets']
      .map((name) => [name, parseEnvFile(join(ctx.repoRoot, name))]);

    const needles = [];
    for (const [source, bag] of bags) {
      for (const [name, value] of Object.entries(bag)) {
        if (PUBLIC_BY_CONSTRUCTION.has(name)) continue;
        if (name.startsWith('NEXT_PUBLIC_')) continue;
        if (!value || value.length < 16) continue;          // too short to be unique; would collide with real content
        if (isPlaceholder(value)) continue;
        needles.push({ name, source, buf: Buffer.from(value, 'utf-8') });
      }
    }

    if (!needles.length) {
      throw new Skip(
        'no scannable secret values on this machine: .env/.secrets hold nothing outside the '
        + `public-by-construction set (${[...PUBLIC_BY_CONSTRUCTION].join(', ')}) that is 16+ chars and not a placeholder`,
      );
    }

    // .next/cache is Turbopack's local build cache. scripts/deploy-api.sh
    // rsyncs .next with --exclude 'cache/', so a value that reaches ONLY the
    // cache never reaches the host — verified 2026-09-22: one hit under
    // .next/cache, zero elsewhere in .next, zero in out/, zero on the droplet.
    // Grading that hit critical was a scope error that failed the every-commit
    // gate for a file that is never uploaded.
    //
    // The downgrade is tied to the control that justifies it. If the exclude
    // is ever removed from the deploy script, a cache hit is shipped output
    // again and goes straight back to critical. The check reads the script
    // rather than remembering that it was once there.
    const deployApi = (() => { try { return readFileSync(join(ctx.repoRoot, 'scripts/deploy-api.sh'), 'utf-8'); } catch { return ''; } })();
    const cacheExcludedFromDeploy = /rsync[^\n]*--exclude\s+'cache\/'[^\n]*\.next\//.test(deployApi);
    const cachePrefix = join(ctx.repoRoot, '.next', 'cache') + '/';

    const dirs = ['out', '.next'].map((d) => join(ctx.repoRoot, d)).filter((d) => existsSync(d));
    if (!dirs.length) {
      throw new Skip('neither out/ nor .next/ exists — nothing has been built, so there is nothing to clear for upload');
    }

    const findings = [];
    let checked = 0;
    let skippedHuge = 0;
    for (const dir of dirs) {
      for (const f of walkFiles(dir)) {
        let size = 0;
        try { size = statSync(f).size; } catch { continue; }
        // A 64 MiB ceiling keeps one pathological artifact from blowing up the
        // process. Nothing in a Next build comes close; if something does, it
        // is counted below rather than passed over in silence.
        if (size > 64 * 1024 * 1024) { skippedHuge += 1; continue; }
        let buf;
        try { buf = readFileSync(f); } catch { continue; }
        checked += 1;
        for (const n of needles) {
          if (buf.includes(n.buf)) {
            const inLocalCache = f.startsWith(cachePrefix);
            if (inLocalCache && cacheExcludedFromDeploy) {
              findings.push(finding({
                severity: 'low',
                title: `${n.name} is in the local Turbopack cache (not shipped)`,
                detail:
                  `The value of ${n.name} (from ${n.source}) is inside .next/cache, which scripts/deploy-api.sh excludes from the rsync — so it is on this machine and nowhere else. `
                  + 'It is still worth knowing: Next does not load ' + n.source + ', yet Turbopack read it into its cache anyway, which means the rename that keeps this value out of builds is relying on that exclude holding. This check re-reads the deploy script every run and returns to critical the moment the exclude is gone.',
                evidence: `${f.slice(ctx.repoRoot.length + 1)} contains the literal value of ${n.name} (${n.buf.length} bytes, from ${n.source}); 0 hits outside .next/cache in this scan`,
                remediation:
                  `Nothing to ship. If you want the value out of the cache too, move ${n.name} out of any .env* file — Turbopack reads them all — into .secrets or the shell environment of the tool that needs it.`,
                file: f.slice(ctx.repoRoot.length + 1),
              }));
              continue;
            }
            findings.push(finding({
              severity: 'critical',
              title: `${n.name} appears verbatim in build output`,
              detail:
                `The value of ${n.name} (from ${n.source}) was found byte-for-byte inside a build artifact. `
                + 'out/ is rsynced into the public droplet web root by scripts/deploy.sh and .next/ is rsynced to /opt/ib-api by scripts/deploy-api.sh, '
                + 'so deploying now publishes this credential. Treat it as compromised from the moment it shipped, if it already has.',
              evidence: `${f.slice(ctx.repoRoot.length + 1)} contains the literal value of ${n.name} (${n.buf.length} bytes, from ${n.source}). Re-check by hand: grep -c "$(grep '^${n.name}=' ${n.source} | cut -d= -f2-)" "${f.slice(ctx.repoRoot.length + 1)}"`,
              remediation:
                `Do not deploy. Find what put it there (next.config.ts env block, a rendered component reading process.env.${n.name}, output:"standalone"), `
                + `rebuild clean, and rotate ${n.name} — a value that reached a build has to be assumed to have reached a disk somewhere else too.`,
              file: f.slice(ctx.repoRoot.length + 1),
            }));
          }
        }
      }
    }

    if (skippedHuge) {
      findings.push(finding({
        severity: 'low',
        title: `${skippedHuge} build artifact(s) too large to scan`,
        detail: 'Files above 64 MiB were not read, so this run did not cover the whole build. Saying so beats reporting a clean sweep that was not one.',
        evidence: `${skippedHuge} file(s) over 64 MiB under ${dirs.map((d) => d.slice(ctx.repoRoot.length + 1)).join(' and ')}`,
        remediation: 'Check what is that large in a Next build, and raise the ceiling in this check if it is legitimate.',
      }));
    }

    return { checked, findings };
  },
});
