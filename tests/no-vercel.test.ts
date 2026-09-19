/**
 * Vercel is gone (owner, 2026-09-18: "we will not be using vercel in any way
 * shape or form on this project. the account will be deleted and closed
 * soon."). The API now runs on the droplet — see API-ON-DROPLET.md.
 *
 * This guard is about live dependencies, not history: source, config, scripts
 * and tests must not name Vercel, because a hostname that is about to stop
 * resolving is a silent outage waiting to happen. It deliberately does NOT
 * police the dated audit write-ups in *.md, which are point-in-time records of
 * what was true when they were written.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(__dirname, '..');
// data/ is excluded on purpose: vercel.com is one of the 500 scanned sites,
// so its report card and funnel legitimately name it as a third-party website.
const DIRS = ['app', 'components', 'lib', 'scripts', 'tests', 'e2e'];
/**
 * Files that name the platform in order to REFUSE it, and so cannot be policed
 * by a rule against naming it.
 *
 * This guard itself, plus scripts/security/checks/ — the security suite's own
 * detectors. Several of them exist specifically to catch a live Vercel
 * reference (cnast-apache-drift reads the deployed Apache config,
 * mast-bridge-origin-allowlist reads the WebView origin allowlist handed to the
 * Android team), and they have to spell the hostname out to match on it.
 *
 * This is an exemption for the DETECTORS, not a hole: those checks grade the
 * live server and the shipped contract, which is more than this file can reach
 * from the source tree. Both found real stale references on 2026-09-19 that
 * this guard had missed for weeks.
 */
const SELF = path.join('tests', 'no-vercel.test.ts');
const SELF_DIRS = [path.join('scripts', 'security', 'checks')];
const isSelf = (f: string) => f === SELF || SELF_DIRS.some((d) => f.startsWith(d + path.sep));
/** A line that exists to BAN the hostname is not a dependency on it. Mark it. */
const ALLOW = 'no-vercel-guard';
// .conf and .htaccess earn their place here the hard way: the live CSP is set
// by scripts/droplet-htaccess.conf, and because that extension was missing this
// guard walked straight past two vercel.app hosts in connect-src and reported
// green for weeks. Anything that can reach the server is in scope, not just
// what the bundler compiles.
const EXTS = new Set(['.ts', '.tsx', '.mjs', '.js', '.sh', '.json', '.css', '.conf', '.htaccess', '.yml', '.yaml']);

function walk(dir: string): string[] {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return walk(rel);
    return EXTS.has(path.extname(e.name)) ? [rel] : [];
  });
}

describe('no Vercel dependency anywhere that runs', () => {
  it('no source, script, config or test names a vercel host', () => {
    const files = [...DIRS.flatMap(walk), 'next.config.ts', 'package.json'];
    const hits = files.flatMap((f) => {
      const full = path.join(ROOT, f);
      if (!fs.existsSync(full) || isSelf(f)) return [];
      return fs.readFileSync(full, 'utf-8').split('\n')
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /vercel/i.test(line) && !line.includes(ALLOW))
        .map(({ line, n }) => `${f}:${n}: ${line.trim().slice(0, 120)}`);
    });
    expect(hits).toEqual([]);
  });

  it('the files that configured Vercel are gone', () => {
    for (const f of ['vercel.json', 'scripts/vercel-ignore.sh', 'scripts/deploy-prod-bitnami.sh']) {
      expect(fs.existsSync(path.join(ROOT, f)), `${f} still exists`).toBe(false);
    }
  });

  it('the API is same-origin: nothing sets a cross-origin default', async () => {
    const cfg = fs.readFileSync(path.join(ROOT, 'next.config.ts'), 'utf-8');
    // NEXT_PUBLIC_SCAN_API defaults to "" so the browser calls this same host,
    // which Apache reverse-proxies to the Node service (API-ON-DROPLET.md).
    expect(cfg).toMatch(/NEXT_PUBLIC_SCAN_API:\s*process\.env\.NEXT_PUBLIC_SCAN_API\s*\?\?\s*""/);
    expect(cfg).toContain('"connect-src \'self\'"');
  });

  it('the CSP the browser actually gets is the tight one', () => {
    // next.config.ts is NOT the header a visitor receives. A static export runs
    // no Next.js server, so headers() never executes; Apache serves the files
    // and scripts/droplet-htaccess.conf supplies the policy. Asserting only the
    // former is how two vercel.app hosts sat in the live connect-src while this
    // suite reported green — grade the artifact that ships.
    const conf = fs.readFileSync(path.join(ROOT, 'scripts/droplet-htaccess.conf'), 'utf-8');
    const csp = /Header always set Content-Security-Policy "([^"]+)"/.exec(conf);
    expect(csp, 'no CSP header in droplet-htaccess.conf').not.toBeNull();
    const connect = /connect-src ([^;]+)/.exec(csp![1]);
    expect(connect, 'no connect-src in the deployed CSP').not.toBeNull();
    expect(connect![1].trim()).toBe("'self'");
  });
});
