/**
 * scripts/security/checks/pro-deploy-host.mjs, driven offline.
 *
 * Every check in that file is nightly, so nothing in tests/security-suite.ts
 * ever runs it; and two of the five need a droplet — one over ssh, one over
 * HTTP — so the only way to grade their GRADING is to hand them a context
 * whose `ssh` and `http` answer from a table. Both are plain functions on the
 * context object (scripts/security/lib/context.mjs), which is what makes
 * this possible with no network and no droplet. Nothing in this file opens
 * a socket.
 *
 * Three things are pinned here, each one a gap the 2026-09-22 audit pass
 * proved rather than assumed:
 *
 *   wp_not_on_pro_machine   G4, half two. wp_not_on_pro_vhost asks four
 *                           questions over HTTP and is vhost-scoped by
 *                           construction: move WordPress to a second
 *                           ServerName on the same box and it goes green
 *                           while the owner's requirement — WordPress off
 *                           the MACHINE — is still violated. A green check
 *                           certifying a violated requirement is worse than
 *                           no check. The scenario that proves the new check
 *                           closes that is the one with WordPress on its own
 *                           vhost, on the same machine, graded high.
 *
 *   IB_PROBE_VANTAGE        G1, limitation one. The gate check is an in-band
 *                           prober and cannot see a VPN or an IP allowlist
 *                           from inside the perimeter. It used to grade an
 *                           open answer critical regardless of where it was
 *                           standing, which from a runner on the company
 *                           network is a permanent red — the kind nobody
 *                           reads. Now it reads a declared vantage and every
 *                           cell of the resulting grade matrix is pinned.
 *
 *   authDeclarations()      G1, limitation two. `confHasAuth` was computed
 *                           from one file and interpolated into the evidence
 *                           string, never graded. It now ESCALATES — an open
 *                           company surface with no auth directive anywhere
 *                           in the repo is critical, with one it is high —
 *                           and it never suppresses. Both directions are
 *                           asserted: a directive can lower critical to high,
 *                           and it can never turn a finding off.
 *
 * The G1 scenarios that grade the classifier itself (SSO 302 is a gate, a
 * half-gated deployment still reports, demo is medium) live in
 * tests/audit-6-company.test.ts and are not repeated here.
 *
 * ENVIRONMENT. Every scenario pins IB_DEPLOY_TARGET, IB_COMPANY_HOST and
 * IB_PROBE_VANTAGE for its own run and puts all three back in a finally, so
 * the order of the tests cannot change what any of them sees. Scenarios that
 * need a particular set of config files get a throwaway directory as
 * repoRoot; the walk under it is the same code that walks the real repo.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO = join(__dirname, '..');
const CHECKS_DIR = join(REPO, 'scripts', 'security', 'checks');
const mod = await import(pathToFileURL(join(CHECKS_DIR, 'pro-deploy-host.mjs')).href);

type Finding = { severity: string; title: string; detail: string; evidence: string; remediation: string; file: string | null; line: number | null };
type CheckDef = {
  id: string;
  discipline: string;
  severity: string;
  cadence: string;
  requires: string[];
  safeAgainstProd: boolean;
  needsOptIn: boolean;
  run: (ctx: unknown) => Promise<{ findings: Finding[]; checked: number }>;
};

const checks = mod.default as CheckDef[];
const byId = (id: string) => checks.find((c) => c.id === id);

const machineCheck = byId('wp_not_on_pro_machine');
const gateCheck = byId('pro_vhost_noindex_but_no_login');
const vhostCheck = byId('wp_not_on_pro_vhost');
const authDeclarations = mod.authDeclarations as (root: string) => { scanned: number; declarations: Array<{ file: string; line: number; text: string }> };

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

const ENV_KEYS = ['IB_DEPLOY_TARGET', 'IB_COMPANY_HOST', 'IB_PROBE_VANTAGE'] as const;
type Env = Partial<Record<(typeof ENV_KEYS)[number], string>>;

/** Run `fn` with exactly these env keys set (others deleted), then restore. */
async function withEnv<T>(env: Env, fn: () => Promise<T>): Promise<T> {
  const saved = ENV_KEYS.map((k) => [k, Object.prototype.hasOwnProperty.call(process.env, k), process.env[k]] as const);
  for (const k of ENV_KEYS) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    return await fn();
  } finally {
    for (const [k, had, prev] of saved) {
      if (had) process.env[k] = prev;
      else delete process.env[k];
    }
  }
}

type Stub = { status: number; headers?: Record<string, string>; text?: string };

/**
 * A context whose `ssh` and `http` answer from what the test hands in.
 *
 * `ssh` records every command it was sent, so a scenario can assert the
 * check asked a read-only question and asked it once. An unstubbed URL
 * THROWS: if a check grows a probe, this file has to be told.
 */
function fakeCtx(opts: {
  origin: string;
  repoRoot?: string;
  ssh?: (cmd: string) => string;
  routes?: Record<string, Stub>;
}) {
  const sshCalls: string[] = [];
  const routes = opts.routes || {};
  return {
    sshCalls,
    repoRoot: opts.repoRoot || REPO,
    origin: opts.origin,
    freeBase: `${opts.origin}/resources`,
    proBase: `${opts.origin}/resources-pro`,
    apiBase: `${opts.origin}/api`,
    Skip: SkipCtor,
    ssh: (cmd: string) => {
      sshCalls.push(cmd);
      if (!opts.ssh) throw new Error('this scenario did not expect an ssh call');
      return opts.ssh(cmd);
    },
    http: async (url: string) => {
      const r = routes[url];
      if (!r) throw new Error(`the check probed an unstubbed URL: ${url}`);
      return { ok: true, status: r.status, headers: new Headers(r.headers || {}), text: r.text || '', json: null, url };
    },
  };
}

/** The real Skip class, so `isSkip` propagates exactly as the runner sees it. */
const harness = await import(pathToFileURL(join(REPO, 'scripts', 'security', 'lib', 'harness.mjs')).href);
const SkipCtor = harness.Skip as new (reason: string) => Error & { isSkip: true };

const COMPANY = 'https://privacy-tools.example-corp.internal';
const DEMO = 'https://206-189-186-34.nip.io';

const tempDirs: string[] = [];
/** A throwaway repo root holding exactly these files. */
function repoWith(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ib-pro-deploy-host-'));
  tempDirs.push(root);
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}
afterAll(() => {
  for (const d of tempDirs) rmSync(d, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// wp_not_on_pro_machine
// ---------------------------------------------------------------------------

/** What the ssh batch answers, built from a description of the box. */
function box(opts: { sites: string[]; wpConfigs: string[]; mysql?: string; mariadb?: string; truncate?: boolean }): string {
  const lines = [
    '---IB:SITES---',
    ...opts.sites,
    '---IB:WPCONFIG---',
    ...opts.wpConfigs,
    '---IB:DB---',
    opts.mysql ?? 'inactive',
    opts.mariadb ?? 'inactive',
  ];
  if (!opts.truncate) lines.push('---IB:END---');
  return lines.join('\n') + '\n';
}

/** This droplet, as `ls` and `systemctl` describe it today. */
const DROPLET_TODAY = { sites: ['000-default-le-ssl.conf', '000-default.conf'], wpConfigs: ['/var/www/html/wp-config.php', '/var/www/html/wp-config.php'], mysql: 'active' };

async function runMachine(target: 'company' | 'demo', answer: string | (() => string)) {
  const ctx = fakeCtx({ origin: target === 'demo' ? DEMO : COMPANY, ssh: () => (typeof answer === 'string' ? answer : answer()) });
  const r = await withEnv({ IB_DEPLOY_TARGET: target }, () => machineCheck!.run(ctx));
  return { ...r, ctx };
}

describe('wp_not_on_pro_machine — WordPress off the MACHINE, not merely off the vhost', () => {
  it('exists, is a nightly cnast check that needs ssh, and is declared safe against prod', () => {
    // Looked up by id out of the array default export, so a reorder of CHECKS
    // cannot make this file grade a different check.
    expect(machineCheck, 'wp_not_on_pro_machine is gone from pro-deploy-host.mjs').toBeTruthy();
    expect(machineCheck!.discipline).toBe('cnast');
    expect(machineCheck!.cadence).toBe('nightly');
    expect(machineCheck!.requires).toContain('ssh');
    expect(machineCheck!.safeAgainstProd).toBe(true);
    expect(machineCheck!.needsOptIn).toBe(false);
  });

  it('asks the box three read-only questions, in one session', async () => {
    // The cnast discipline exists because eleven checks each opening a root
    // session to a shared production box is eleven uses of the most
    // privileged credential in the system. This one gets one session and
    // may only list things in it: every `;`-separated segment starts with
    // echo, ls or `systemctl is-active`. A restart, a reload, a write or a
    // scan added to this command fails here before it ever reaches a box.
    const { ctx } = await runMachine('demo', box(DROPLET_TODAY));
    expect(ctx.sshCalls, 'expected exactly one ssh session').toHaveLength(1);
    const segments = ctx.sshCalls[0].split(';').map((s) => s.trim()).filter(Boolean);
    expect(segments.length).toBeGreaterThanOrEqual(6);
    for (const seg of segments) {
      expect(seg, `a non-listing command in the ssh batch: ${seg}`).toMatch(/^(?:echo |ls |systemctl is-active )/);
    }
    expect(ctx.sshCalls[0]).toContain('wp-config.php');
    expect(ctx.sshCalls[0]).toContain('/etc/apache2/sites-enabled/');
  });

  it('this droplet today: WordPress and MySQL beside the API is medium on the demo, and says it is the cutover requirement', async () => {
    const r = await runMachine('demo', box(DROPLET_TODAY));
    expect(r.checked).toBeGreaterThan(0);
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.severity, 'the demo droplet is this way on purpose; graded high every night nobody would read it').toBe('medium');
    expect(f.title).toMatch(/WordPress/);
    expect(f.detail).toContain('DEPLOY REQUIREMENT');
    // Evidence has to be re-checkable by hand: the file that proves it, once
    // (the `ls -d` glob lists /var/www/html/wp-config.php twice — the glob
    // and the explicit path both match it — and the report must not).
    expect(f.evidence).toContain('/var/www/html/wp-config.php');
    expect(f.evidence.split('/var/www/html/wp-config.php').length - 1).toBe(1);
    expect(f.evidence).toContain('mysql=active');
  });

  it('the same box as a COMPANY target is high, and the finding says a vhost split is not the job', async () => {
    const r = await runMachine('company', box(DROPLET_TODAY));
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity, 'WordPress on the company API host is not a medium').toBe('high');
    // The half-fix this check exists to refuse is named in its own text, so
    // whoever reads the report is told which other check going green is NOT
    // this requirement met.
    expect(r.findings[0].detail).toContain('wp_not_on_pro_vhost');
    expect(r.findings[0].detail).toMatch(/same machine|MACHINE|one kernel/);
  });

  it('WordPress moved to its OWN vhost on the same machine is still high — the evasion the vhost check cannot see', async () => {
    // This is the exact configuration that turns wp_not_on_pro_vhost green:
    // a blog.conf ServerName of its own, with the install under
    // /var/www/blog. Every HTTP probe of the Pro vhost 404s. The machine is
    // unchanged, and so is the grade here.
    const r = await runMachine('company', box({ sites: ['pro.conf', 'blog.conf'], wpConfigs: ['/var/www/blog/wp-config.php'], mysql: 'active' }));
    expect(r.findings, 'a second vhost hid WordPress from the machine check').toHaveLength(1);
    expect(r.findings[0].severity).toBe('high');
    expect(r.findings[0].evidence).toContain('/var/www/blog/wp-config.php');
    expect(r.findings[0].evidence).toContain('blog.conf');
  });

  it('a clean company box — no wp-config.php, no database unit — is zero findings over a non-zero inspection', async () => {
    const r = await runMachine('company', box({ sites: ['pro.conf'], wpConfigs: [] }));
    expect(r.findings.map((f) => `[${f.severity}] ${f.title}`)).toEqual([]);
    // And it got there having looked at something. "0 findings over 0 items"
    // is the pass the harness refuses by design.
    expect(r.checked, 'a clean verdict with nothing inspected').toBeGreaterThan(0);
  });

  it('a database unit with no WordPress found is its own, lower finding — a co-tenant, not the WordPress one', async () => {
    const company = await runMachine('company', box({ sites: ['pro.conf'], wpConfigs: [], mariadb: 'active' }));
    expect(company.findings).toHaveLength(1);
    expect(company.findings[0].severity).toBe('medium');
    expect(company.findings[0].title).toMatch(/database/i);
    expect(company.findings[0].title).not.toMatch(/WordPress is installed/);
    expect(company.findings[0].evidence).toContain('mariadb=active');
    const demo = await runMachine('demo', box({ sites: ['pro.conf'], wpConfigs: [], mariadb: 'active' }));
    expect(demo.findings).toHaveLength(1);
    expect(demo.findings[0].severity).toBe('low');
  });

  it('a truncated ssh answer is a SKIP, never a clean box', async () => {
    // A batch that died before the END marker reads exactly like a machine
    // with no WordPress on it — empty WPCONFIG, empty DB — which is the
    // failure the marker exists to catch.
    await expect(runMachine('company', box({ ...DROPLET_TODAY, truncate: true })))
      .rejects.toMatchObject({ isSkip: true });
    // The same, when the answer is nothing at all (a dead session).
    await expect(runMachine('company', '')).rejects.toMatchObject({ isSkip: true });
  });

  it('no droplet login propagates as a SKIP, so a laptop without .secrets cannot report an all-clear', async () => {
    const ctx = fakeCtx({ origin: COMPANY, ssh: () => { throw new SkipCtor('no droplet login in .secrets (DEPLOY_HOST/DEPLOY_USER/DEPLOY_SSH_KEY)'); } });
    await expect(withEnv({ IB_DEPLOY_TARGET: 'company' }, () => machineCheck!.run(ctx))).rejects.toMatchObject({ isSkip: true });
  });
});

describe('wp_not_on_pro_vhost — its remediation no longer reads as the whole job', () => {
  it('names the machine-level requirement and the check that grades it', async () => {
    // Before: "serve the Pro export from a dedicated vhost/document root".
    // Follow that to the letter — WordPress on blog.conf, Pro on pro.conf,
    // one box — and this check goes green while G4 is still violated. The
    // text now says so, and points at wp_not_on_pro_machine.
    const wp = (path: string): Stub => ({ status: 200, headers: {}, text: `<html><body>wp-includes ${path}</body></html>` });
    const routes = Object.fromEntries(['/wp-login.php', '/xmlrpc.php', '/wp-json/', '/wp-admin/'].map((p) => [`${COMPANY}${p}`, wp(p)]));
    const ctx = fakeCtx({ origin: COMPANY, routes });
    const r = await withEnv({ IB_DEPLOY_TARGET: 'company' }, () => vhostCheck!.run(ctx));
    expect(r.findings.length).toBeGreaterThan(0);
    for (const f of r.findings) {
      expect(f.severity).toBe('high');
      expect(f.remediation, 'the vhost remediation reads as if a vhost split were the requirement').toContain('wp_not_on_pro_machine');
      expect(f.remediation).toMatch(/MACHINE/);
    }
  }, 20_000);
});

// ---------------------------------------------------------------------------
// pro_vhost_noindex_but_no_login — vantage and the repo's own declarations
// ---------------------------------------------------------------------------

const routesFor = (origin: string, page: Stub, api: Stub) => ({
  [`${origin}/resources-pro/tools/`]: page,
  [`${origin}/api/ip`]: api,
});
const PAGE_OPEN: Stub = { status: 200, headers: { 'x-robots-tag': 'noindex, nofollow' }, text: '<html>Pro tools</html>' };
const API_OPEN: Stub = { status: 405, headers: { allow: 'POST, OPTIONS' } };
const SSO_REDIRECT: Stub = { status: 302, headers: { location: 'https://sso.example-corp.internal/oauth2/start?rd=%2F' } };
const API_401: Stub = { status: 401, headers: { 'www-authenticate': 'Bearer realm="corp"' } };

/** An open deployment, graded from `repoRoot` with this target and vantage. */
async function runGate(env: Env, opts: { origin?: string; repoRoot: string; page?: Stub; api?: Stub }) {
  const origin = opts.origin || (env.IB_DEPLOY_TARGET === 'demo' ? DEMO : COMPANY);
  const ctx = fakeCtx({ origin, repoRoot: opts.repoRoot, routes: routesFor(origin, opts.page || PAGE_OPEN, opts.api || API_OPEN) });
  return withEnv(env, () => gateCheck!.run(ctx));
}

const NO_CONFIG = () => repoWith({ 'README.md': 'nothing config-shaped here\n' });
const BASIC_AUTH = () => repoWith({ 'scripts/droplet-htaccess.conf': '# managed\nAuthType Basic\nAuthName "Pro"\nAuthUserFile /etc/apache2/.htpasswd\nRequire valid-user\n' });

describe('pro_vhost_noindex_but_no_login — IB_PROBE_VANTAGE decides what an open answer can mean', () => {
  it('with no vantage declared, an open company target is critical and the finding says which declaration it needs', async () => {
    const r = await runGate({ IB_DEPLOY_TARGET: 'company' }, { repoRoot: NO_CONFIG() });
    expect(r.findings).toHaveLength(1);
    const f = r.findings[0];
    expect(f.severity, 'unknown vantage must grade as the strict side').toBe('critical');
    // It must name BOTH declarations and what each would mean, because the
    // whole point of the knob is that the operator can tell which one is
    // true of their runner. A finding that said only "set IB_PROBE_VANTAGE"
    // would be a riddle.
    expect(f.detail).toContain('IB_PROBE_VANTAGE=outside');
    expect(f.detail).toContain('IB_PROBE_VANTAGE=inside');
    expect(f.detail).toMatch(/NOT DECLARED/);
    expect(f.evidence).toContain('IB_PROBE_VANTAGE=(unset');
  }, 20_000);

  it('from a declared OUTSIDE vantage it stays critical: nothing at the perimeter stopped it and nothing in-band did', async () => {
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'outside' }, { repoRoot: NO_CONFIG() });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].title).toContain('no authentication at all');
    expect(r.findings[0].detail).toContain('IB_PROBE_VANTAGE=outside');
    expect(r.findings[0].detail).not.toMatch(/NOT DECLARED/);
    expect(r.findings[0].evidence).toContain('IB_PROBE_VANTAGE=outside');
  }, 20_000);

  it('from a declared INSIDE vantage it is medium, and the TITLE says an in-band prober cannot see a VPN or IP allowlist', async () => {
    // The limitation, made explicit instead of graded as a lie. From a runner
    // on the company network a correctly VPN-gated host answers 200, and the
    // old check called that "no authentication at all" at critical — a
    // permanent red on a correct deployment. The caveat has to be in the
    // title, not buried in the detail, because the title is what the
    // summary line and the report card show.
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'inside' }, { repoRoot: NO_CONFIG() });
    expect(r.findings, 'an open in-band answer from inside is still a finding — never silently dropped').toHaveLength(1);
    const f = r.findings[0];
    expect(f.severity).toBe('medium');
    expect(f.title).toMatch(/FROM INSIDE/);
    expect(f.title).toMatch(/cannot see a VPN or IP allowlist/);
    expect(f.detail).toContain('IB_PROBE_VANTAGE=inside');
    // And it still names both surfaces and refuses the client-side flag as
    // an answer — the downgrade changes the grade, not the requirement.
    expect(f.detail).toContain('/resources-pro');
    expect(f.detail).toContain('/api');
    expect(f.detail).toContain('data-ib-pro');
  }, 20_000);

  it('the vantage is parsed strictly: "Inside " is inside, "internal" is unknown', async () => {
    const loose = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: ' Inside ' }, { repoRoot: NO_CONFIG() });
    expect(loose.findings[0].severity).toBe('medium');
    const wrong = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'internal' }, { repoRoot: NO_CONFIG() });
    expect(wrong.findings[0].severity, 'a value that is not one of the two must not read as inside').toBe('critical');
    expect(wrong.findings[0].detail).toMatch(/NOT DECLARED/);
  }, 20_000);

  it('the demo is medium whatever the vantage says, with the ordinary title — there is nothing to downgrade from', async () => {
    for (const vantage of ['inside', 'outside', undefined]) {
      const r = await runGate({ IB_DEPLOY_TARGET: 'demo', IB_PROBE_VANTAGE: vantage }, { repoRoot: NO_CONFIG() });
      expect(r.findings).toHaveLength(1);
      expect(r.findings[0].severity).toBe('medium');
      expect(r.findings[0].title).toContain('no authentication at all');
      expect(r.findings[0].detail).toContain('DEPLOY REQUIREMENT');
      expect(r.findings[0].detail).not.toMatch(/IB_PROBE_VANTAGE/);
    }
  }, 30_000);

  it('an unreachable company host from OUTSIDE is still a SKIP — consistent with a gate, equally consistent with a typo', async () => {
    // The one configuration in which this prober could in principle see the
    // owner's named control working is "nothing answered from outside". It is
    // deliberately NOT graded as a pass: a wrong --origin or a box that is
    // down produce the same silence, and a check that found the right fact
    // and graded it reassuringly is the failure this project has already had
    // once. The skip says what the silence is consistent with.
    const dead = { ok: false, status: 0, headers: new Headers(), text: '', json: null, error: 'timed out after 15000ms', code: 'ETIMEDOUT' };
    const ctx = { ...fakeCtx({ origin: COMPANY, repoRoot: NO_CONFIG() }), http: async (url: string) => ({ ...dead, url }) };
    const err = await withEnv({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'outside' }, () => gateCheck!.run(ctx)).catch((e) => e);
    expect(err).toMatchObject({ isSkip: true });
    expect(String(err.message)).toMatch(/consistent with a VPN or IP allowlist/);
    expect(String(err.message)).toMatch(/wrong origin/);
  }, 20_000);
});

describe('pro_vhost_noindex_but_no_login — what the repo declares escalates, and never suppresses', () => {
  it('authDeclarations() walks the real repo and reads its config-shaped files', () => {
    // The scan has to be reading SOMETHING for "no directive anywhere in the
    // repo" to mean anything. This repo ships .conf, .htaccess and .sh files
    // under scripts/; a walk that found none of them would make the
    // critical grade below a verdict over zero bytes.
    const real = authDeclarations(REPO);
    expect(real.scanned, 'the config walk found nothing in the real repo').toBeGreaterThanOrEqual(5);
    // Not asserted: whether the real repo declares auth today. The day the
    // cutover conf lands, that flips — and this test must not be the thing
    // that goes red when the remediation is applied.
  });

  it('the walk skips node_modules, build output and the git directory', () => {
    // A stray vendored .conf with an AuthType in it must not read as "the
    // repo declares auth" and soften a company grade.
    const root = repoWith({
      'node_modules/some-pkg/apache.conf': 'AuthType Basic\n',
      '.next/cache/x.conf': 'AuthType Basic\n',
      'out/.htaccess': 'AuthType Basic\n',
      'scripts/site.htaccess': '# no auth here\nRedirectMatch 404 /\\.\n',
    });
    const r = authDeclarations(root);
    expect(r.scanned).toBe(1);
    expect(r.declarations).toEqual([]);
  });

  it('with NO auth directive anywhere, an open company target is critical and the finding says nothing shipped would close the door', async () => {
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'outside' }, { repoRoot: NO_CONFIG() });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].detail).toMatch(/No AuthType .* directive is declared in ANY/);
    expect(r.findings[0].evidence).toContain('NO access-control directive declared');
  }, 20_000);

  it('with an auth directive in scripts/droplet-htaccess.conf, the same open target is high — something exists to deploy, and it is not in force', async () => {
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'outside' }, { repoRoot: BASIC_AUTH() });
    expect(r.findings, 'a directive in a file must never turn the finding OFF').toHaveLength(1);
    expect(r.findings[0].severity).toBe('high');
    expect(r.findings[0].detail).toContain('scripts/droplet-htaccess.conf:2 AuthType Basic');
    expect(r.findings[0].detail).toMatch(/not in force/);
    expect(r.findings[0].evidence).toContain('access-control directive(s)');
  }, 20_000);

  it('"anywhere in the repo" means anywhere: a directive in a differently named .conf is found too', async () => {
    // The old version read exactly one file and wrote "no access control
    // declared anywhere in the repo" into the evidence on the strength of
    // that one grep. A cutover vhost checked in under deploy/ was invisible
    // to it.
    const root = repoWith({ 'deploy/company/pro-vhost.conf': '<Location />\n  Require valid-user\n</Location>\n' });
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'outside' }, { repoRoot: root });
    expect(r.findings[0].severity).toBe('high');
    expect(r.findings[0].detail).toContain('deploy/company/pro-vhost.conf:2 Require valid-user');
  }, 20_000);

  it('`Require all denied` and `Require all granted` are not auth: a deny on a dotfile path does not soften the grade', async () => {
    // The body cap in API-ON-DROPLET.md is a `Require all denied` inside an
    // <If>; the dotfile deny in site.htaccess is the same shape. Neither
    // authenticates anyone, and the earlier regex excluded only `all
    // granted`, so a deny-all would have bought a high where a critical was
    // due.
    const root = repoWith({ 'scripts/droplet-htaccess.conf': '<If "%{HTTP:Content-Length} -gt 1048576">\n  Require all denied\n</If>\n<Directory />\n  Require all granted\n</Directory>\n' });
    expect(authDeclarations(root).declarations).toEqual([]);
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'outside' }, { repoRoot: root });
    expect(r.findings[0].severity).toBe('critical');
  }, 20_000);

  it('inside vantage wins over the escalator: open from inside is medium with or without a directive', async () => {
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'inside' }, { repoRoot: BASIC_AUTH() });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('medium');
    expect(r.findings[0].title).toMatch(/FROM INSIDE/);
  }, 20_000);

  it('the escalator is not a suppressor in the other direction either: a gated deployment stays at zero findings whatever the repo declares', async () => {
    const r = await runGate({ IB_DEPLOY_TARGET: 'company', IB_PROBE_VANTAGE: 'outside' }, { repoRoot: BASIC_AUTH(), page: SSO_REDIRECT, api: API_401 });
    expect(r.findings.map((f) => `[${f.severity}] ${f.title}`)).toEqual([]);
    expect(r.checked).toBeGreaterThan(0);
  }, 20_000);

  it('the files the scan read count toward `checked`, so the grade is visibly over something', async () => {
    const none = await runGate({ IB_DEPLOY_TARGET: 'company' }, { repoRoot: NO_CONFIG() });
    const one = await runGate({ IB_DEPLOY_TARGET: 'company' }, { repoRoot: BASIC_AUTH() });
    expect(one.checked).toBe(none.checked + 1);
  }, 20_000);
});
