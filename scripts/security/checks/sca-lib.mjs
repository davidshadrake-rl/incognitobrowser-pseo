/**
 * Shared plumbing for the sca-* checks. THIS FILE EXPORTS NO CHECK.
 *
 * The runner imports every .mjs in this directory and keeps whatever has a
 * `default` export with an `id`; this module has neither, so it loads and is
 * ignored. It lives here rather than in lib/ because lib/ belongs to the
 * harness and the sca checks own only scripts/security/checks/sca-*.
 *
 * Everything in here is a file read or a JSON parse. Nothing touches the
 * network, so the every-commit checks that depend on it stay offline.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

export const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

/** Directories whose compiled output is what actually ships (static HTML + the ib-api routes). */
export const RUNTIME_DIRS = ['app', 'lib', 'components'];

export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

/**
 * Strip comments before pattern-matching source.
 *
 * This is not cosmetic. Two of the suppression premises would be permanently
 * false without it: next.config.ts:28 contains the prose "nonce-based CSP
 * would be the next-level hardening", and lib/altcha.ts:35 contains the word
 * "nonce" inside a paragraph explaining a past bug. A premise assertion that
 * fired on those would be wrong on day one, and a check that is wrong on day
 * one gets commented out in week two and takes the real assertions with it.
 *
 * Deliberately simple: block comments, whole-line // and * comments, and a
 * trailing // that is preceded by whitespace and is not part of a URL scheme.
 * It is not a JS parser and does not need to be — it only has to stop prose
 * from being read as code.
 */
export function stripComments(src) {
  let out = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
  out = out
    .split('\n')
    .map((line) => {
      const t = line.trimStart();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('#')) return '';
      return line.replace(/(\s)\/\/(?!\/)(?![^\s]*:\/\/).*$/, '$1');
    })
    .join('\n');
  return out;
}

/** Every source file under the given repo-relative directories, recursively. */
export function sourceFiles(repoRoot, dirs = RUNTIME_DIRS) {
  const out = [];
  const walk = (abs, rel) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const a = join(abs, e.name);
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) walk(a, r);
      else if (SOURCE_EXT.has(extname(e.name)) || extname(e.name) === '.css') out.push({ abs: a, rel: r });
    }
  };
  for (const d of dirs) walk(join(repoRoot, d), d);
  return out;
}

/** Files under a directory matching a predicate, recursively. Used for built output. */
export function walkFiles(root, predicate, limit = 100_000) {
  const out = [];
  const walk = (abs) => {
    if (out.length >= limit) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const a = join(abs, e.name);
      if (e.isDirectory()) walk(a);
      else if (predicate(a)) out.push(a);
      if (out.length >= limit) return;
    }
  };
  if (existsSync(root) && statSync(root).isDirectory()) walk(root);
  return out;
}

/**
 * The production dependency closure, straight out of package-lock.json.
 *
 * `npm ls --omit=dev` would answer the same question, but it shells out and
 * needs node_modules to be installed; the every-commit checks have to work on
 * a fresh clone in milliseconds. npm marks dev-only entries with `dev: true`
 * and entries reachable from both trees with `devOptional: true`, so the
 * complement of those two is exactly what `npm ci --omit=dev` installs —
 * which is what scripts/deploy-api.sh puts on the droplet.
 *
 * Optional entries (sharp, fsevents, the @img/* platform binaries) ARE in the
 * prod closure and are kept. They install by default; "optional" only means
 * npm tolerates their failure.
 */
export function prodClosure(lock) {
  const out = new Map();
  for (const [path, entry] of Object.entries(lock.packages || {})) {
    if (!path) continue;
    if (entry.dev || entry.devOptional) continue;
    const name = entry.name || path.slice(path.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.set(path, { path, name, ...entry });
  }
  return out;
}

/** Package names (not paths) in the production closure. */
export function prodClosureNames(lock) {
  return new Set([...prodClosure(lock).values()].map((e) => e.name));
}

/**
 * Is `pkg` imported from anything under the runtime directories?
 *
 * Matches `from 'pkg'`, `require('pkg')`, `import('pkg')` and the CSS form
 * `@import "pkg/..."` — @fontsource is pulled in by app/globals.css and by
 * nothing else, and a JS-only matcher would call it dead and be wrong.
 */
export function importedFrom(repoRoot, pkg, dirs = RUNTIME_DIRS) {
  const esc = pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `(?:from|import|require)\\s*\\(?\\s*["'\`]${esc}(?:/[^"'\`]*)?["'\`]|@import\\s+["']${esc}(?:/[^"']*)?["']`,
  );
  const hits = [];
  for (const f of sourceFiles(repoRoot, dirs)) {
    const src = stripComments(readFileSync(f.abs, 'utf-8'));
    if (!re.test(src)) continue;
    const line = src.split('\n').findIndex((l) => re.test(l)) + 1;
    hits.push(`${f.rel}${line ? `:${line}` : ''}`);
    if (hits.length >= 5) break;
  }
  return hits;
}

/**
 * Evaluate one suppression premise. Returns { holds, evidence }.
 *
 * Every suppression in scripts/security/data/sca-suppressions.json rests on a
 * fact about this codebase, and each fact is checked here rather than trusted.
 * The failure this is built against: the Origin allowlist is the sort of thing
 * someone would naturally reimplement as a Next proxy/middleware file, and the
 * moment that lands, six waived Middleware/Proxy-bypass advisories are live
 * again with nothing anywhere saying so.
 */
export function evaluatePremise(key, ctx, { lock, pkg } = {}) {
  const root = ctx.repoRoot;
  const read = (rel) => (existsSync(join(root, rel)) ? stripComments(readFileSync(join(root, rel), 'utf-8')) : null);

  switch (key) {
    case 'no-proxy-or-middleware': {
      // Next 16 RENAMED middleware to proxy — node_modules/next/dist/docs/01-app/
      // 03-api-reference/03-file-conventions/proxy.md opens with "the `middleware`
      // file convention is deprecated and has been renamed to `proxy`". A check
      // that looked only for middleware.ts would sail straight past the file
      // people in this version of Next would actually write. Both names, both
      // the root and src/, plus the pageExtensions variant the same doc
      // describes (proxy.page.ts).
      const found = [];
      for (const dir of ['', 'app', 'src']) {
        const abs = dir ? join(root, dir) : root;
        let entries = [];
        try { entries = readdirSync(abs); } catch { /* directory absent is a pass */ }
        for (const name of entries) {
          if (/^(middleware|proxy)(\.page)?\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) found.push(dir ? `${dir}/${name}` : name);
        }
      }
      return { holds: found.length === 0, evidence: found.length ? `found ${found.join(', ')}` : 'no middleware.* or proxy.* at the repo root, app/ or src/' };
    }

    case 'no-server-actions': {
      // The directive form only. Editorial copy on this site discusses server
      // technology constantly; matching the bare phrase anywhere would light up
      // on prose. This wants a real "use server" directive at the top of a file
      // or a function body.
      const hits = [];
      for (const f of sourceFiles(root)) {
        const src = stripComments(readFileSync(f.abs, 'utf-8'));
        const m = /(^|\n)\s*(['"])use server\2\s*;?/.exec(src);
        if (m) hits.push(`${f.rel}:${src.slice(0, m.index).split('\n').length}`);
      }
      return { holds: hits.length === 0, evidence: hits.length ? `'use server' directive in ${hits.join(', ')}` : `no 'use server' directive in ${sourceFiles(root).length} files under app/, lib/, components/` };
    }

    case 'images-unoptimized': {
      const cfg = read('next.config.ts');
      if (cfg === null) return { holds: false, evidence: 'next.config.ts is missing — the premise cannot be confirmed' };
      const on = /images\s*:\s*\{[^}]*\bunoptimized\s*:\s*true/s.test(cfg);
      const off = /\bunoptimized\s*:\s*false/.test(cfg);
      return { holds: on && !off, evidence: on && !off ? 'next.config.ts: images: { unoptimized: true }' : `next.config.ts images.unoptimized is ${off ? 'explicitly false' : 'not set to true'}` };
    }

    case 'no-rewrites-or-i18n': {
      const cfg = read('next.config.ts');
      if (cfg === null) return { holds: false, evidence: 'next.config.ts is missing — the premise cannot be confirmed' };
      const m = /\b(rewrites|i18n|cacheComponents)\b\s*[:(]/.exec(cfg);
      return { holds: !m, evidence: m ? `next.config.ts declares ${m[1]}` : 'next.config.ts declares no rewrites, i18n or cacheComponents' };
    }

    case 'no-csp-nonce': {
      // The static sites get their CSP from Apache, not from Next (headers()
      // returns [] when isStatic). So the .conf files are part of this premise,
      // not an afterthought — the last time a guard in this repo skipped the
      // .conf that sets the live CSP, two dead third-party origins sat in
      // connect-src for weeks.
      const files = ['next.config.ts', 'scripts/droplet-htaccess.conf', 'scripts/site.htaccess', 'app/layout.tsx'];
      const hits = [];
      let looked = 0;
      for (const rel of [...files, ...sourceFiles(root, ['lib']).map((f) => f.rel)]) {
        const src = read(rel);
        if (src === null) continue;
        looked += 1;
        const m = /\bnonce\s*[-=:{]/i.exec(src);
        if (m) hits.push(`${rel}:${src.slice(0, m.index).split('\n').length}`);
      }
      return { holds: hits.length === 0, evidence: hits.length ? `CSP nonce referenced in ${hits.join(', ')}` : `no nonce in any CSP source (${looked} files, comments stripped)` };
    }

    case 'no-before-interactive': {
      const hits = [];
      for (const f of sourceFiles(root)) {
        const src = stripComments(readFileSync(f.abs, 'utf-8'));
        if (/beforeInteractive/.test(src)) hits.push(f.rel);
      }
      return { holds: hits.length === 0, evidence: hits.length ? `next/script strategy="beforeInteractive" in ${hits.join(', ')}` : 'no beforeInteractive script strategy anywhere under app/, lib/, components/' };
    }

    case 'linux-host': {
      const deploy = read('scripts/deploy-api.sh');
      if (deploy === null) return { holds: false, evidence: 'scripts/deploy-api.sh is missing — cannot confirm the deploy target is a systemd host' };
      const systemd = /systemctl/.test(deploy);
      return { holds: systemd, evidence: systemd ? 'scripts/deploy-api.sh drives the service with systemctl, i.e. a Linux host (API-ON-DROPLET.md: ExecStart=/usr/bin/node node_modules/.bin/next start)' : 'scripts/deploy-api.sh no longer uses systemctl — confirm the deploy target is still Linux' };
    }

    case 'no-websocket-upgrades': {
      // The advisory is about apps that handle WebSocket upgrades on a CUSTOM
      // server. ib-api is `next start` behind Apache with no upgrade proxying
      // and no ws library in the tree. Two independent facts, both checkable.
      const custom = ['server.js', 'server.ts', 'server.mjs'].filter((f) => existsSync(join(root, f)));
      const wsPkgs = lock ? [...prodClosureNames(lock)].filter((n) => n === 'ws' || n.startsWith('socket.io') || n.startsWith('engine.io')) : [];
      const holds = custom.length === 0 && wsPkgs.length === 0;
      return { holds, evidence: holds ? 'no custom server file at the repo root and no ws/socket.io/engine.io in the production closure' : `custom server: ${custom.join(', ') || 'none'}; websocket packages: ${wsPkgs.join(', ') || 'none'}` };
    }

    case 'build-time-only': {
      // "It only runs on a laptop during the build." Two ways that stops being
      // true: someone adds it to package.json dependencies as a direct runtime
      // dep, or someone imports it from code that ships.
      if (!pkg) return { holds: false, evidence: 'build-time-only premise used without a package name' };
      const manifest = readJson(join(root, 'package.json'));
      const direct = Object.keys(manifest.dependencies || {}).includes(pkg);
      const hits = importedFrom(root, pkg);
      const holds = !direct && hits.length === 0;
      return { holds, evidence: holds ? `${pkg} is transitive-only and imported from nothing under app/, lib/, components/` : `${pkg} is ${direct ? 'a direct entry in package.json dependencies' : ''}${direct && hits.length ? ' and ' : ''}${hits.length ? `imported at ${hits.join(', ')}` : ''}` };
    }

    default:
      return { holds: false, evidence: `unknown premise key "${key}" — nothing asserts it, so the suppression it backs is unverified` };
  }
}

/** Run an npm subcommand and parse its JSON. npm exits non-zero when it finds things; that is data, not failure. */
export function npmJson(args, { cwd, timeoutMs = 120_000 }) {
  let raw;
  try {
    raw = execFileSync('npm', args, { cwd, encoding: 'utf-8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    raw = err.stdout || '';
    if (!raw) throw new Error(`npm ${args.join(' ')} produced no output: ${String(err.stderr || err.message).slice(0, 300)}`);
  }
  return JSON.parse(raw);
}

/**
 * Flatten `npm audit --json` into one row per advisory.
 *
 * The package-level `severity` npm prints is the worst of a package's
 * advisories, which is how "next" reads as a single critical when in fact it
 * carries 25 separate advisories at five different severities. Suppressions
 * are per-GHSA, so the per-advisory severity is the one that matters.
 */
export function flattenAudit(audit) {
  const rows = new Map();
  for (const [pkgName, v] of Object.entries(audit.vulnerabilities || {})) {
    for (const via of v.via || []) {
      if (typeof via !== 'object' || !via.url) continue;
      const ghsa = (via.url.match(/GHSA-[a-z0-9-]+/i) || [via.url])[0];
      if (rows.has(ghsa)) continue;
      rows.set(ghsa, {
        ghsa,
        package: via.name || pkgName,
        reportedUnder: pkgName,
        severity: via.severity || v.severity,
        title: via.title || '(no title)',
        url: via.url,
        range: via.range || '',
        fixAvailable: v.fixAvailable,
      });
    }
  }
  return [...rows.values()];
}

/** npm's severity words mapped onto the suite's. */
export function mapSeverity(s) {
  return { critical: 'critical', high: 'high', moderate: 'medium', low: 'low', info: 'info' }[s] || 'low';
}
