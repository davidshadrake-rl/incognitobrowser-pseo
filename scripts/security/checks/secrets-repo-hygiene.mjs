/**
 * Secret hygiene in the repo itself — the four one-line regressions that would
 * be irreversible here.
 *
 * Why this discipline is narrow: the secret inventory is small and enumerable.
 * ANTHROPIC_API_KEY lives in an untracked .env; DEPLOY_HOST/DEPLOY_USER/
 * DEPLOY_SSH_KEY/SITE_ORIGIN live in an untracked .secrets; and three values
 * exist only on the droplet in /etc/ib-api.env (REDIS_URL, ALTCHA_HMAC_KEY,
 * STATS_TOKEN). None of those is leaked today — that was verified, not assumed.
 *
 * So these checks do not hunt for a leak. They guard the MECHANISMS by which
 * one would happen, because the repo is public and the static export lands in a
 * public web root. ALTCHA_HMAC_KEY is the one that really matters: lib/altcha.ts
 * getSecret() reads it with no fallback, and the proof-of-work that gates
 * /scan-url on an otherwise unauthenticated API is unforgeable only while that
 * value stays private. There is no revoking a string that reached a public repo.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

/** git, with the repo as cwd. Returns stdout even on a non-zero exit, because
 *  "no match" is a legitimate answer from check-ignore and grep. */
function git(repoRoot, args) {
  try {
    return { code: 0, out: execFileSync('git', args, { cwd: repoRoot, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 }) };
  } catch (err) {
    if (err.code === 'ENOENT') throw new Skip('git not found on PATH');
    return { code: typeof err.status === 'number' ? err.status : 1, out: (err.stdout || '') + (err.stderr || '') };
  }
}

function readConfig(repoRoot) {
  const p = join(repoRoot, 'next.config.ts');
  if (!existsSync(p)) throw new Skip('next.config.ts not found — wrong repo root?');
  return { path: p, text: readFileSync(p, 'utf-8') };
}

/** Line number of the first occurrence of `needle`, 1-indexed, for evidence. */
function lineOf(text, needle) {
  const i = text.indexOf(needle);
  return i === -1 ? null : text.slice(0, i).split('\n').length;
}

// ---------------------------------------------------------------------------

const nextConfigEnvAllowlist = check({
  id: 'secret-nextconfig-env-allowlist',
  discipline: 'secrets',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'next.config.ts `env:` inlines its values into the client bundle; every key there must be NEXT_PUBLIC_.',
  /**
   * next.config.ts declares `env: { NEXT_PUBLIC_SCAN_API: ... }`. Next.js
   * substitutes every key in that block into the CLIENT bundle at build time.
   * Adding one line — `STATS_TOKEN: process.env.STATS_TOKEN` — bakes a droplet
   * secret into the JavaScript of ~1,400 statically exported pages, which
   * scripts/deploy.sh then rsyncs into a public web root. Nothing else in this
   * discipline can catch that: we do not hold REDIS_URL, ALTCHA_HMAC_KEY or
   * STATS_TOKEN on this machine, so there is no value to grep for. This check
   * guards the mechanism instead of the value, which is the only way to cover
   * those three.
   *
   * It parses the source text rather than importing the module: next.config.ts
   * is TypeScript, and a plain-node check cannot import it without pulling in a
   * transpiler. Reading the text also means the check still works when the
   * config would throw on load.
   *
   * A parse failure is reported as a finding, not swallowed. A check that
   * cannot find the block it is supposed to grade has stopped grading, and
   * this suite exists because guards in this repo did exactly that quietly.
   */
  async run(ctx) {
    const { path, text } = readConfig(ctx.repoRoot);
    const findings = [];

    // `^[ \t]*env:` anchors on a property at the start of a line, so the many
    // `process.env.X` reads elsewhere in the file cannot match. The closing
    // brace is matched at the same indentation the `env:` line had.
    const block = /^([ \t]*)env:\s*\{\r?\n([\s\S]*?)\r?\n\1\}/m.exec(text);
    const mentionsEnvKey = /^[ \t]*env\s*:/m.test(text);

    if (!block && mentionsEnvKey) {
      return {
        checked: 1,
        findings: [finding({
          severity: 'high',
          title: 'next.config.ts has an `env:` property this check cannot read',
          detail:
            'The config declares an `env` property but not as an inline object literal, so the key allowlist could not be applied. '
            + 'Every key under `env` is inlined into the client bundle of every statically exported page, so an unreadable block means this guard is no longer grading anything.',
          evidence: `next.config.ts line ${lineOf(text, text.match(/^[ \t]*env\s*:/m)[0])}: matched /^[ \\t]*env\\s*:/ but not an inline "env: {" ... "}" block`,
          remediation: 'Keep `env` as an inline object literal in next.config.ts, or update this check to understand the new shape.',
          file: 'next.config.ts',
          line: lineOf(text, text.match(/^[ \t]*env\s*:/m)[0]),
        })],
      };
    }

    if (!block) {
      // No env block at all is the safest possible state: nothing is inlined.
      // Still one real thing inspected, so this is not a vacuous pass.
      return { checked: 1, findings: [] };
    }

    const body = block[2];
    const keys = [];
    for (const m of body.matchAll(/^[ \t]*(?:['"]([^'"]+)['"]|([A-Za-z_$][A-Za-z0-9_$]*))\s*:/gm)) {
      keys.push(m[1] || m[2]);
    }
    const blockLine = lineOf(text, block[0].split('\n')[0]);

    for (const key of keys) {
      if (!key.startsWith('NEXT_PUBLIC_')) {
        findings.push(finding({
          severity: 'high',
          title: `next.config.ts env block inlines a non-public key: ${key}`,
          detail:
            `Next.js substitutes every key in the \`env\` block into the client bundle. \`${key}\` does not carry the NEXT_PUBLIC_ prefix, `
            + 'so whatever it holds would be baked into the JavaScript of every statically exported page and published by scripts/deploy.sh to a public web root. '
            + 'If it is a droplet secret (ALTCHA_HMAC_KEY, STATS_TOKEN, REDIS_URL) that is unrecoverable: the ALTCHA key is what makes the proof-of-work gating /scan-url unforgeable.',
          evidence: `next.config.ts:${blockLine} env block contains key "${key}" (allowed: keys matching /^NEXT_PUBLIC_/)`,
          remediation: 'Remove the key from the `env` block. Server-only values are read with process.env inside route handlers, which never reach the client.',
          file: 'next.config.ts',
          line: blockLine,
        }));
      }
    }

    // The pinned set. A NEW NEXT_PUBLIC_ key is not automatically dangerous,
    // but it is a new value published on 1,400 pages, and that deserves a
    // human look rather than passing because of its prefix.
    const PINNED = ['NEXT_PUBLIC_SCAN_API'];
    const added = keys.filter((k) => k.startsWith('NEXT_PUBLIC_') && !PINNED.includes(k));
    if (added.length) {
      findings.push(finding({
        severity: 'low',
        title: `next.config.ts env block grew: ${added.join(', ')}`,
        detail:
          'A new key appeared in the block that Next.js inlines into the client bundle. The NEXT_PUBLIC_ prefix means it is intended to be public, '
          + 'so this is an advisory, not a leak — but it ships to ~1,400 pages and someone should confirm the value is genuinely public before it does.',
        evidence: `next.config.ts:${blockLine} env keys = [${keys.join(', ')}], pinned = [${PINNED.join(', ')}]`,
        remediation: 'If the new key is intentional and its value is public, add it to PINNED in this check with a one-line note about what it carries.',
        file: 'next.config.ts',
        line: blockLine,
      }));
    }

    return { checked: keys.length, findings };
  },
});

// ---------------------------------------------------------------------------

const gitignoreAndTracking = check({
  id: 'secret-gitignore-and-tracking-enforcement',
  discipline: 'secrets',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['git'],
  describe: '.env and .secrets stay git-ignored, and no credential-shaped file is tracked.',
  /**
   * This repo is PUBLIC. A `git add -f .secrets`, or an edit that drops
   * .gitignore's `.env*` (line 34) or `.secrets` (line 50), commits the droplet
   * SSH login and a live Anthropic key somewhere they can never be taken back
   * from. Revocation is the only remedy and it is always late.
   *
   * Two separate questions, because they fail separately: are the ignore rules
   * still in force (git check-ignore), and is anything credential-shaped
   * already staged or committed (git ls-files). The second catches a file that
   * dodges the patterns entirely — .secrets.local, a deploy.key copied into the
   * tree, an id_ed25519 pasted in during troubleshooting.
   *
   * Deliberately NOT flagged, because this repo legitimately contains them:
   * .secrets.example (the template, no values), anything under data/ (500
   * scanned third-party sites, hashes and all), and public/adtest/ (files that
   * are ad-shaped on purpose, to bait ad blockers). The match is on the file
   * NAME only — never on contents — so editorial copy that names trackers and
   * attack techniques cannot trip it.
   */
  async run(ctx) {
    const findings = [];
    let checked = 0;

    const MUST_BE_IGNORED = ['.env', '.secrets'];
    for (const rel of MUST_BE_IGNORED) {
      checked += 1;
      const r = git(ctx.repoRoot, ['check-ignore', '-q', '--', rel]);
      // check-ignore exits 0 when the path IS ignored, 1 when it is not.
      if (r.code !== 0) {
        const present = existsSync(join(ctx.repoRoot, rel));
        findings.push(finding({
          severity: 'high',
          title: `${rel} is no longer git-ignored`,
          detail:
            `\`git check-ignore ${rel}\` reports the path is not ignored, so a plain \`git add .\` would stage it. `
            + (rel === '.secrets'
              ? 'That file holds the droplet host, user and SSH key path used by scripts/deploy.sh and scripts/deploy-api.sh.'
              : 'That file holds a live ANTHROPIC_API_KEY, read by scripts/generate-content.ts.')
            + ' This repository is public, so a single commit publishes it permanently.',
          evidence: `git check-ignore -q -- ${rel} exited ${r.code} (0 means ignored); file ${present ? 'exists' : 'does not exist'} on disk`,
          remediation: 'Restore the pattern in .gitignore (.env* and .secrets), then confirm with `git check-ignore -v .env .secrets`.',
          file: '.gitignore',
        }));
      }
    }

    const ls = git(ctx.repoRoot, ['ls-files']);
    if (ls.code !== 0) throw new Skip(`git ls-files failed: ${ls.out.trim().slice(0, 120)}`);
    const tracked = ls.out.split('\n').filter(Boolean);
    if (!tracked.length) throw new Skip('git ls-files returned nothing — not a checkout?');

    // Name-shaped only. `.env` and `.env.*` but not `.env.example`; private-key
    // extensions; the usual SSH key filenames.
    const CREDENTIAL_SHAPED = /(^|\/)(\.env(\.[A-Za-z0-9_.-]+)?|\.secrets(\.[A-Za-z0-9_.-]+)?|[^/]+\.(pem|key|p12|pfx|jks|keystore|ppk)|id_(rsa|dsa|ecdsa|ed25519))$/;
    const ALLOWED = new Set(['.secrets.example', '.env.example']);
    for (const f of tracked) {
      checked += 1;
      if (ALLOWED.has(f)) continue;
      if (f.endsWith('.example') || f.endsWith('.sample') || f.endsWith('.template')) continue;
      if (!CREDENTIAL_SHAPED.test(f)) continue;
      findings.push(finding({
        severity: 'high',
        title: `credential-shaped file is tracked in git: ${f}`,
        detail:
          'A file whose name matches the shape of a credential store is committed to a PUBLIC repository. '
          + 'Even if this particular copy is a placeholder, the name means the next person to fill it in publishes the contents. '
          + 'If it ever held a real value, that value is in the history and must be treated as burned.',
        evidence: `git ls-files lists "${f}"; allowlisted names are ${[...ALLOWED].join(', ')} plus any *.example/*.sample/*.template`,
        remediation: `git rm --cached "${f}", add the path to .gitignore, and rotate anything it contained. Check history with \`git log --all -- "${f}"\`.`,
        file: f,
      }));
    }

    return { checked, findings };
  },
});

// ---------------------------------------------------------------------------

const sourcemapGuard = check({
  id: 'secret-sourcemap-guard',
  discipline: 'secrets',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'The static export ships no source maps, and next.config.ts does not turn them on.',
  /**
   * `productionBrowserSourceMaps: true` is a one-line change that publishes the
   * original TypeScript — including any constant someone inlined while
   * debugging — next to the minified bundle in a public web root.
   *
   * The config assertion is the half that matters and it is deliberately FIRST,
   * because the out/ walk cannot be relied on. scripts/deploy.sh does
   * `rm -rf out .next` immediately before `npm test`, so any guard that only
   * inspects out/ during the test run inspects nothing — that is precisely the
   * bug the comment at scripts/deploy.sh:120 records about the page guards,
   * which "skipped silently on every deploy". So: the config check always runs
   * and always counts; the out/ walk is a bonus when a build happens to be on
   * disk, and its absence never makes this check vacuous.
   *
   * Not flagged: the 220 .map files in .next/. They sit under .next/server and
   * .next/build, which scripts/deploy-api.sh rsyncs to /opt/ib-api — a
   * directory Apache never serves. Only .next/static is web-reachable, and it
   * holds none. Flagging them would be the kind of noise that gets a check
   * switched off.
   */
  async run(ctx) {
    const { text } = readConfig(ctx.repoRoot);
    const findings = [];
    let checked = 1; // the config file

    const smap = /^[ \t]*productionBrowserSourceMaps\s*:\s*([^,\n]+)/m.exec(text);
    if (smap && !/^false\b/.test(smap[1].trim())) {
      findings.push(finding({
        severity: 'medium',
        title: 'next.config.ts enables production browser source maps',
        detail:
          'With this on, `next build` emits .map files alongside every client chunk and scripts/deploy.sh rsyncs them into the public web root. '
          + 'Anyone can then read the original TypeScript of the whole site, which turns any value a developer inlined into a published one.',
        evidence: `next.config.ts:${lineOf(text, smap[0])} → ${smap[0].trim()}`,
        remediation: 'Remove the setting, or set it to false.',
        file: 'next.config.ts',
        line: lineOf(text, smap[0]),
      }));
    }

    // The walk, when there is something to walk.
    const outDir = join(ctx.repoRoot, 'out');
    if (existsSync(outDir)) {
      const maps = [];
      const stack = [outDir];
      while (stack.length) {
        const dir = stack.pop();
        let entries = [];
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          const p = join(dir, e.name);
          if (e.isDirectory()) { stack.push(p); continue; }
          if (!e.isFile()) continue;
          checked += 1;
          if (e.name.endsWith('.map')) maps.push(p.slice(ctx.repoRoot.length + 1));
        }
      }
      if (maps.length) {
        findings.push(finding({
          severity: 'medium',
          title: `${maps.length} source map(s) in the static export`,
          detail:
            'out/ is rsynced verbatim into the droplet web root by scripts/deploy.sh, so every .map here becomes a public URL '
            + 'exposing the original source of the site.',
          evidence: `${maps.length} file(s) ending in .map under out/, first: ${maps.slice(0, 3).join(', ')}`,
          remediation: 'Find what emitted them (productionBrowserSourceMaps, a webpack/turbopack devtool override, a copied asset) and stop it, then rebuild.',
          file: maps[0],
        }));
      }
    }

    return { checked, findings };
  },
});

// ---------------------------------------------------------------------------

const prerenderedEnvInterpolation = check({
  id: 'secret-prerendered-env-interpolation',
  discipline: 'secrets',
  cadence: 'every-commit',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'No page, layout or component reads a non-public env var — BUILD_TARGET=static bakes those into published HTML.',
  /**
   * Added after review pointed out that the env-block allowlist covers only
   * half of this mechanism, and the smaller half.
   *
   * BUILD_TARGET=static prerenders every page at build time, with the repo-root
   * .env loaded. A single `{process.env.ALTCHA_HMAC_KEY}` in any page, layout
   * or component is therefore rendered into static HTML and rsynced to a public
   * web root by scripts/deploy.sh — no `env:` block involved, so
   * secret-nextconfig-env-allowlist would never see it, and no local copy of
   * the value, so the known-value grep could never see it either. For the three
   * droplet secrets this is the larger exposure path of the two.
   *
   * Scope is the rendered surface only: app/**\/*.tsx, app/robots.ts,
   * app/sitemap.ts and components/**\/*.tsx. Deliberately NOT scanned:
   *   - app/**\/route.ts — the seven API routes legitimately read STATS_TOKEN,
   *     ALTCHA_HMAC_KEY and REDIS_URL; they run server-side and render nothing.
   *   - lib/ — altcha.ts, origin.ts, rate-limit.ts, dns-leak-store.ts and
   *     tuning.ts are the server-side modules those routes import. Flagging
   *     them would fire on the correct design and get this check muted.
   *   - scripts/ — build-time tooling, never shipped.
   * NODE_ENV is allowed: Next replaces it with a literal "production", it is
   * not a secret, and treating it as one would make this check noise.
   */
  async run(ctx) {
    const roots = ['app', 'components'];
    const files = [];
    for (const r of roots) {
      const base = join(ctx.repoRoot, r);
      if (!existsSync(base)) continue;
      const stack = [base];
      while (stack.length) {
        const dir = stack.pop();
        let entries = [];
        try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const e of entries) {
          const p = join(dir, e.name);
          if (e.isDirectory()) { stack.push(p); continue; }
          if (!e.isFile()) continue;
          const rel = p.slice(ctx.repoRoot.length + 1);
          if (e.name === 'route.ts' || e.name === 'route.tsx') continue;
          if (e.name.endsWith('.tsx') || rel === 'app/robots.ts' || rel === 'app/sitemap.ts') files.push({ p, rel });
        }
      }
    }
    if (!files.length) throw new Skip('no rendered app/ or components/ sources found — wrong repo root?');

    const findings = [];
    const ALLOWED_PREFIX = 'NEXT_PUBLIC_';
    const ALLOWED_EXACT = new Set(['NODE_ENV']);
    for (const { p, rel } of files) {
      const text = readFileSync(p, 'utf-8');
      if (!text.includes('process.env')) continue;
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        for (const m of line.matchAll(/process\.env(?:\.([A-Za-z_$][A-Za-z0-9_$]*)|\[\s*['"]([^'"]+)['"]\s*\])/g)) {
          const name = m[1] || m[2];
          if (name.startsWith(ALLOWED_PREFIX) || ALLOWED_EXACT.has(name)) continue;
          findings.push(finding({
            severity: 'high',
            title: `rendered source reads a non-public env var: ${name}`,
            detail:
              `${rel} is part of the rendered surface, and BUILD_TARGET=static prerenders it at build time with the repo-root .env loaded. `
              + `Whatever ${name} holds is therefore written into static HTML (or the client bundle) and rsynced to the public web root by scripts/deploy.sh. `
              + 'For a droplet secret such as ALTCHA_HMAC_KEY that means publishing the value the proof-of-work on /scan-url depends on.',
            evidence: `${rel}:${i + 1}: ${line.trim().slice(0, 160)}`,
            remediation: 'Move the read into an API route handler under app/*/route.ts, or rename the variable to NEXT_PUBLIC_* only if the value is genuinely public.',
            file: rel,
            line: i + 1,
          }));
        }
      });
    }

    return { checked: files.length, findings };
  },
});

export default [nextConfigEnvAllowlist, gitignoreAndTracking, sourcemapGuard, prerenderedEnvInterpolation];
