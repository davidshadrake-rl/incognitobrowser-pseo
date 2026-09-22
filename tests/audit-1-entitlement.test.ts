/**
 * Audit follow-up, group 1 "entitlement": the four things the previous pass
 * left unproven about the paid control.
 *
 * tests/pro-entitlement.test.ts already grades the gate itself. This file does
 * not repeat it. It closes the specific holes the audit named, and each test
 * below says which one and what it would have missed:
 *
 *   E2  "setAttribute('data-ib-pro','') then Export succeeds today."
 *       Proven before with a hand-built FakeElement that already had the
 *       attribute on it. That skips the half that matters — WHO PUT IT THERE.
 *       Here the attribute is produced by the shipped boot script reacting to
 *       a forged bridge object, and the export that follows is run by the real
 *       useUpgradeGate. Nothing in the chain is stood in for.
 *
 *   E2  the second half of that claim — "keep it as a FAILING test until the
 *       gate moves server-side" — is NOT closed here, and this file does not
 *       pretend otherwise. What is closed is the narrower thing that can be
 *       proven: the finding the repo put in place of that failing test really
 *       does fail a run graded at medium. That is measured by running the
 *       runner and reading its exit code, not by reading its source. The part
 *       that is still missing (nothing in the deploy path grades at medium) is
 *       reported as a source change, not asserted away.
 *
 *   E7  "the Upgrade button in the overlay must not navigate to a leftover
 *       staging URL." Every existing test infers the overlay's destination
 *       from the shared constant, or measures that the overlay opened and its
 *       button is clickable. None has ever read the href out of the overlay.
 *       The overlay is a portal, rendered only while open, so the sweeps over
 *       `a[data-upgrade-from]` in the exported HTML never see it either. Here
 *       it is rendered and the href is read.
 *
 *   E8  "a company deploy must FAIL while the demo host is in the bundle."
 *       The audit's gap was "there is no CI, so something still has to run
 *       it". There is no CI — but the gate is not CI, it is scripts/deploy.sh
 *       itself, and the chain that makes that work had never been asserted
 *       anywhere. It is asserted below, link by link.
 *
 * Two house rules this file follows.
 *
 *  1. Every assertion on source text runs on source with the COMMENTS
 *     STRIPPED. A guard matching its own explanatory comment has shipped twice
 *     in this repo; scripts/security/checks/sast-lib.mjs exists for that
 *     reason and is reused here rather than re-implemented.
 *  2. Nothing here imports a module for its side effect and then grades the
 *     thing that side effect produced. The one module executed for effect is
 *     lib/in-app.ts's IN_APP_BOOT_SCRIPT, which is executed as TEXT, in a fake
 *     window, exactly as tests/in-app.test.ts does — it cannot touch anything
 *     this file later asserts on.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

/**
 * components/ui/UpgradeOverlay.tsx renders through createPortal, and
 * react-dom/server throws on a portal ("Portals are not currently supported by
 * the server renderer"). vitest.config.ts runs environment:'node' and this
 * repo has no DOM test environment, so the portal boundary is replaced with
 * the identity function and nothing else is.
 *
 * This is the container, not the subject. What is under test is the href the
 * overlay puts on its button, and every line that computes it —
 * UpgradeOverlay's <UpgradeButtons from="gate">, UpgradeButtons' own
 * `DEMO_UPGRADE_URL || playUrl(...)`, lib/play.ts — is the real code. Mocking
 * any of those would leave the assertion testing the mock.
 */
vi.mock('react-dom', async (orig) => {
  const actual = await orig<Record<string, unknown>>();
  return { ...actual, createPortal: (children: unknown) => children };
});

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

/** The same comment stripper the SAST checks use, with string literals kept. */
const { stripComments } = await import('../scripts/security/checks/sast-lib.mjs' as string) as {
  stripComments: (src: string, opts?: { strings?: boolean }) => string;
};
const code = (p: string) => stripComments(read(p), { strings: false });

/**
 * Shell has no block comments and no regex literals, so "from an unquoted # to
 * end of line" is the whole rule. Quoted `#` is rare in scripts/deploy.sh but
 * the count of quotes before the hash is cheap insurance against eating one.
 */
function stripShellComments(src: string): string {
  return src.split('\n').map((line) => {
    for (let i = 0; i < line.length; i++) {
      if (line[i] !== '#') continue;
      const before = line.slice(0, i);
      const odd = (q: string) => (before.split(q).length - 1) % 2 === 1;
      if (odd('"') || odd("'")) continue;
      return before;
    }
    return line;
  }).join('\n');
}

/* ------------------------------------------------------------------ *
 * fakes: the same shapes tests/in-app.test.ts and
 * tests/pro-entitlement.test.ts already use, so the boot script runs
 * against the environment it was written for.
 * ------------------------------------------------------------------ */

class FakeElement {
  attrs = new Map<string, string>();
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
}

class FakeStorage {
  m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, v); }
  removeItem(k: string) { this.m.delete(k); }
}

/** A plain Chrome on Android: NOT the app, so only the bridge can vouch. */
const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';

/** Load a page at `href` in a fake tab and run the boot script AS IT SHIPS. */
async function boot(href: string, opts: { bridge?: unknown } = {}) {
  const { IN_APP_BOOT_SCRIPT } = await import('@/lib/in-app');
  const root = new FakeElement();
  const w = {
    document: { documentElement: root },
    location: { href },
    sessionStorage: new FakeStorage(),
    IncognitoBrowserApp: opts.bridge,
    navigator: { userAgent: CHROME_UA },
    setTimeout: undefined,
    history: { state: null, replaceState: vi.fn((_s: unknown, _t: string, url: string) => { w.location.href = new URL(url, href).href; }) },
  };
  new Function('window', IN_APP_BOOT_SCRIPT)(w);
  return root;
}

/**
 * Run one check out of scripts/security/checks/pro-entitlement.mjs by id, with
 * a built context, and hand back the check's own metadata as well as its
 * result — the metadata (cadence, needsOptIn) is what decides whether the
 * deploy suite ever runs it, and is graded below in its own right.
 */
async function runCheck(id: string, opts: Record<string, unknown> = {}) {
  const { buildContext } = await import('../scripts/security/lib/context.mjs' as string);
  const mod = await import('../scripts/security/checks/pro-entitlement.mjs' as string);
  const defs = (Array.isArray(mod.default) ? mod.default : [mod.default]) as Array<{
    id: string; cadence: string; needsOptIn?: boolean;
    run: (c: unknown) => Promise<{ findings: Array<Record<string, string>>; checked: number }>;
  }>;
  const def = defs.find((c) => c.id === id);
  if (!def) throw new Error(`no check with id ${id} in scripts/security/checks/pro-entitlement.mjs`);
  return { def, result: await def.run(buildContext(opts)) };
}

/* ================================================================== *
 * E2. The forged claim, the real attribute, the real download.
 * ================================================================== */

describe('E2 — a forged bridge object runs the gated export, end to end', () => {
  /**
   * The previous test set data-ib-pro by hand and then showed the guard let the
   * download through. True, but it proves only the second half of a two-link
   * chain, and the first link is the interesting one: the attribute is not a
   * fact about the visitor, it is the boot script believing a JavaScript object
   * that anything running in our origin can create.
   *
   * So: run the SHIPPED boot script text in a fake tab whose only credential is
   * `window.IncognitoBrowserApp = { postMessage(){} }` — no app user agent, no
   * app at all — take whatever <html> it produces, hand that document to the
   * REAL useUpgradeGate, and see whether the export runs.
   */
  type Gate = {
    guard: <A extends unknown[]>(a: (...x: A) => void) => (...x: A) => void;
    overlay: { props: Record<string, unknown> };
  };

  async function gateOn(root: FakeElement, focused: unknown, body: (g: Gate) => void) {
    vi.resetModules();
    vi.stubGlobal('document', { documentElement: root, activeElement: focused });
    try {
      const { useUpgradeGate } = await import('@/components/useUpgradeGate');
      const { GATE_COPY } = await import('@/lib/card-copy');
      let guard: Gate['guard'] | null = null;
      let overlay: Gate['overlay'] | null = null;
      function Probe() {
        const g = useUpgradeGate({ engine: 'cookie-analyzer', gate: 'cookie-csv-export', ...GATE_COPY['cookie-csv-export'] });
        guard = g.guard as never;
        overlay = g.overlay as never;
        return null;
      }
      renderToStaticMarkup(createElement(Probe));
      expect(guard, 'useUpgradeGate did not return a guard').toBeTypeOf('function');
      body({ guard: guard!, overlay: overlay! });
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('the boot script grants the mark on a bare object, and the guard then downloads', async () => {
    const root = await boot('https://example.test/resources-pro/tools/a/b/?inapp=1&pro=1', {
      bridge: { postMessage() {} },
    });
    // Link one: the shipped script wrote the mark. Nothing in this test wrote
    // it — assert that before drawing any conclusion from what follows.
    expect(root.hasAttribute('data-ib-pro'), 'the boot script did not set the mark, so the rest of this test would be grading nothing').toBe(true);
    expect(root.getAttribute('data-ib-pro')).toBe('');

    // Link two: the real gate, reading that real document.
    const focused = { id: 'export-csv-button' };
    const downloads: string[] = [];
    await gateOn(root, focused, ({ guard, overlay }) => {
      guard((name: string) => { downloads.push(name); })('example.com-cookie-scan.csv');
      expect(downloads, 'a forged bridge object no longer buys the export — if a real check has landed, rewrite this test rather than relaxing it').toEqual(['example.com-cookie-scan.csv']);
      // The overlay branch was NOT taken: it stashes the focused element to
      // return focus to, and only on the gated path.
      expect((overlay.props.returnFocusTo as { current: unknown }).current).not.toBe(focused);
    });
  });

  it('the same tab without the object is gated — so the object is what decided it', async () => {
    // The control. Without this the test above could pass because the guard
    // never gates anybody, which is a different bug wearing the same result.
    const root = await boot('https://example.test/resources-pro/tools/a/b/?inapp=1&pro=1');
    expect(root.hasAttribute('data-ib-pro')).toBe(false);

    const focused = { id: 'export-csv-button' };
    const downloads: string[] = [];
    await gateOn(root, focused, ({ guard, overlay }) => {
      guard(() => { downloads.push('example.com-cookie-scan.csv'); })();
      expect(downloads).toEqual([]);
      expect((overlay.props.returnFocusTo as { current: unknown }).current).toBe(focused);
      expect(overlay.props.gate).toBe('cookie-csv-export');
    });
  });
});

/* ================================================================== *
 * E2 (second half). The finding that stands in for the failing test.
 * ================================================================== */

describe('E2 — the stand-in for the failing test can actually fail something', () => {
  /**
   * tests/pro-entitlement.test.ts:258-271 explains, at length, why the
   * "keep it red" requirement was answered with a permanent MEDIUM finding
   * instead of a red assertion. That reasoning is defensible. What was never
   * checked is whether the substitute has any teeth at all — a finding that
   * no threshold can turn into a non-zero exit is prose with a severity field.
   *
   * So this runs the runner. Not its source: the process, and its exit code.
   * scripts/security/run.mjs --only=<id> loads exactly one check; this one has
   * `requires: []` and never opens a socket, so it is offline and takes about
   * a tenth of a second.
   *
   * NOTE what this does NOT claim. It does not claim anything in the deploy
   * path grades at medium — nothing does, and that is reported as a source
   * change rather than asserted here in a direction that would have to be
   * rewritten the day it is fixed.
   */
  const CHECK = 'pro_gate_not_trusted_as_server_auth';

  function runner(args: string[]) {
    const env = { ...process.env };
    delete env.SECURITY_TARGET;
    return spawnSync(process.execPath, ['scripts/security/run.mjs', ...args], {
      cwd: ROOT, encoding: 'utf-8', env, timeout: 120_000,
    });
  }

  it('graded at medium, the runner exits non-zero and names the finding', () => {
    const r = runner([`--only=${CHECK}`, '--fail-on=medium']);
    expect(r.error, `the runner did not start: ${r.error?.message}`).toBeUndefined();
    const out = `${r.stdout}${r.stderr}`;
    // It ran the check we asked for, over something.
    expect(out).toMatch(new RegExp(`${CHECK}\\s+\\d+ checked`));
    expect(out).toMatch(/data-ib-pro is a UX gate, not authorisation/);
    // And the finding is what turned the run red.
    expect(out).toMatch(/FAIL — 1 finding\(s\) at or above medium/);
    expect(r.status, `exit code was ${r.status}; a finding that cannot make any run exit non-zero is prose with a severity field:\n${out}`).toBe(1);
  });

  it('the documented escape hatch is the one that was just measured', () => {
    // The audit's complaint is that the requirement is met only if someone
    // chooses to run `npm run security:strict`. That is true, and the least
    // this suite can do is guarantee the script still grades at the severity
    // the finding is filed at — an edit to --fail-on=high there would leave
    // the finding unreachable by any command in this repo.
    const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };
    expect(pkg.scripts['security:strict'], 'npm run security:strict is gone — nothing in this repo now grades at medium').toBeTruthy();
    expect(pkg.scripts['security:strict']).toMatch(/--fail-on=medium\b/);
  });
});

/* ================================================================== *
 * E7. The overlay's own href, read rather than inferred.
 * ================================================================== */

describe('E7 — where the Upgrade button inside the gate overlay actually goes', () => {
  /**
   * Everything that has ever graded this destination has graded it somewhere
   * else: the exported HTML (where the overlay does not appear, because it is
   * a portal rendered only while open), the client chunks (where it appears as
   * a shared module, not as this overlay), or the constant itself.
   *
   * Here the overlay is rendered open, for each of the three gates, and the
   * href is pulled out of the markup it produced.
   */
  const GATES = ['cookie-csv-export', 'browser-privacy-rerun', 'metadata-multi-file'] as const;

  async function renderOverlay(gate: (typeof GATES)[number]) {
    vi.resetModules();
    vi.stubGlobal('document', { body: { nodeType: 1 }, activeElement: null });
    try {
      const { UpgradeOverlay } = await import('@/components/ui/UpgradeOverlay');
      const { GATE_COPY } = await import('@/lib/card-copy');
      return renderToStaticMarkup(createElement(UpgradeOverlay, {
        open: true,
        onClose: () => {},
        engine: 'cookie-analyzer',
        niche: 'ad-tracking',
        gate,
        ...GATE_COPY[gate],
      } as never));
    } finally {
      vi.unstubAllGlobals();
    }
  }

  /** Every href in the rendered markup, entity-decoded enough to be a URL. */
  function hrefs(html: string): string[] {
    return [...html.matchAll(/href="([^"]*)"/g)].map((m) =>
      m[1].replace(/&amp;/g, '&').replace(/&#x27;|&apos;/g, "'").replace(/&quot;/g, '"'));
  }

  /** The declared, unexpired non-Play destinations, read the way the checks read them. */
  function declaredHosts(): Map<string, Record<string, string>> {
    const j = JSON.parse(read('scripts/security/data/compliance-exceptions.json')) as {
      upgradeDestinations?: Array<Record<string, string>>;
    };
    const today = new Date().toISOString().slice(0, 10);
    return new Map((j.upgradeDestinations || [])
      .filter((d) => d && d.host && d.owner && d.reason && d.expires && d.expires >= today)
      .map((d) => [String(d.host).toLowerCase(), d]));
  }

  it('the overlay really does render an upgrade anchor — it is not a portal that renders nothing here', async () => {
    // The trap this avoids: `if (!open || typeof document === 'undefined') return null`
    // makes an un-stubbed node run produce an EMPTY string, and every assertion
    // below would then pass over nothing at all.
    const html = await renderOverlay('cookie-csv-export');
    expect(html, 'the overlay rendered nothing — every destination assertion in this describe would be vacuous').not.toBe('');
    expect(html).toMatch(/data-upgrade-gate="cookie-csv-export"/);
    const buttons = [...html.matchAll(/data-upgrade-from="([^"]*)"/g)].map((m) => m[1]);
    expect(buttons, 'the overlay no longer renders exactly one upgrade button').toEqual(['gate']);
  });

  it('its destination is Play, or a host someone signed for and dated — never a leftover', async () => {
    const declared = declaredHosts();
    for (const gate of GATES) {
      const html = await renderOverlay(gate);
      const upgrade = /<a href="([^"]*)"[^>]*data-upgrade-from="gate"/.exec(html);
      expect(upgrade, `${gate}: no upgrade anchor in the overlay`).toBeTruthy();
      const href = upgrade![1].replace(/&amp;/g, '&');
      const host = new URL(href).host.toLowerCase();

      if (host === 'play.google.com') {
        // The ordinary destination: the real listing, with the referrer intact.
        expect(new URL(href).pathname).toBe('/store/apps/details');
        expect(new URL(href).searchParams.get('id')).toBe('com.androidbull.incognito.browser');
        continue;
      }
      // Anything else is only allowed while a person's name and an end date are
      // attached to it. "Leftover" is exactly the case where they are not: a
      // demo nobody renewed, or a switch nobody cleared.
      const entry = declared.get(host);
      expect(entry, `the gate overlay navigates to ${host}, which is not Google Play and is not a declared, unexpired upgrade destination in scripts/security/data/compliance-exceptions.json`).toBeTruthy();
      expect(entry!.owner, `${host} is declared with no owner`).toBeTruthy();
      expect(entry!.expires >= new Date().toISOString().slice(0, 10), `the declaration for ${host} expired on ${entry!.expires} — the overlay is now navigating to a leftover`).toBe(true);
    }
  });

  it('the hand-off links in the overlay carry the same destination, not a stale copy of it', async () => {
    // The overlay's second and third surfaces. components/UpgradeButtons.tsx
    // builds a mailto: body and a Gmail URL out of the SAME `play` value, so a
    // half-revert that fixed the button and left these would put the old host
    // in a link the visitor emails to themselves — percent-encoded, where a
    // plain host grep walks straight past it.
    const html = await renderOverlay('cookie-csv-export');
    const all = hrefs(html);
    const upgrade = /<a href="([^"]*)"[^>]*data-upgrade-from="gate"/.exec(html)![1].replace(/&amp;/g, '&');

    const mailto = all.find((h) => h.startsWith('mailto:'));
    expect(mailto, 'the overlay no longer offers the hand-off — if that was deliberate, drop this assertion with it').toBeTruthy();
    expect(decodeURIComponent(mailto!), 'the emailed hand-off points somewhere the button does not').toContain(upgrade);

    // And nothing else in the overlay points at the upgrade host by another
    // route: the only remaining external links are Play's data-safety page.
    const externals = all.filter((h) => /^https?:/.test(h) && h !== upgrade);
    for (const h of externals) {
      expect(new URL(h).host, `an unexpected external link in the gate overlay: ${h}`).toBe('play.google.com');
    }
  });
});

/* ================================================================== *
 * E8. What actually fails a company deploy, given that there is no CI.
 * ================================================================== */

describe('E8 — the company-deploy gate, link by link', () => {
  /**
   * The audit's gap was a fair question badly answered by the word "CI": there
   * is no .github here, so "must FAIL CI" names a thing that does not exist,
   * and the audit concluded "something still has to run it".
   *
   * Something does. The chain is:
   *
   *   scripts/deploy.sh          runs `npm test` BEFORE it builds or uploads
   *   npm test                   is `vitest run`, which includes
   *   tests/security-suite.test.ts   which runs every every-commit check and
   *                              fails on high or critical
   *   pro_upgrade_url_not_staging_ufile  is an every-commit check, and it
   *                              reports HIGH when the target is a company
   *                              production host
   *   scripts/security/lib/context.mjs   takes that target from SITE_ORIGIN in
   *                              .secrets — the SAME variable deploy.sh
   *                              uploads to
   *
   * The last link is the one that makes it work without anybody remembering to
   * set SECURITY_TARGET: point .secrets at incognitobrowser.io and the suite
   * starts grading as a company deploy on its own. Not one link of that chain
   * was asserted anywhere, so any of them could have been edited away in
   * silence. Each is asserted below.
   */

  it('link 1 — deploy.sh runs the unit suite before it builds or uploads anything', () => {
    const sh = stripShellComments(read('scripts/deploy.sh'));
    const test = sh.indexOf('npm test');
    const build = sh.indexOf('next build');
    const upload = sh.indexOf('rsync');
    expect(test, 'scripts/deploy.sh no longer runs the unit suite — the only company-deploy gate in this repo is gone').toBeGreaterThan(-1);
    expect(build, 'no build step found in scripts/deploy.sh').toBeGreaterThan(-1);
    expect(upload, 'no rsync found in scripts/deploy.sh').toBeGreaterThan(-1);
    expect(test, 'the unit suite runs after the build in scripts/deploy.sh').toBeLessThan(build);
    expect(test, 'the unit suite runs after the upload in scripts/deploy.sh').toBeLessThan(upload);
    // …and it is a hard stop, not advisory.
    expect(sh.slice(test, test + 120)).toMatch(/\|\|\s*\{[^}]*exit 1/);
  });

  it('link 2 — the demo-paywall check is inside the suite that deploy runs', async () => {
    // tests/security-suite.test.ts collects `cadence === 'every-commit' &&
    // !needsOptIn`. A check filed nightly, or behind an opt-in, is a check the
    // deploy never sees.
    const { def } = await runCheck('pro_upgrade_url_not_staging_ufile');
    expect(def.cadence, 'the demo-paywall check left the every-commit cadence, so scripts/deploy.sh no longer runs it').toBe('every-commit');
    expect(def.needsOptIn ?? false, 'the demo-paywall check now needs opt-in, so the deploy suite skips it').toBe(false);

    // And that suite blocks on exactly high and critical. Asserted on the
    // source with comments stripped, because the prose above it says the same
    // words and a guard matching its own comment has shipped here twice.
    const suite = code('tests/security-suite.test.ts');
    expect(suite).toMatch(/f\.severity === 'high' \|\| f\.severity === 'critical'/);
  });

  it('link 3 — pointed at the company host, the check reports HIGH', async () => {
    const before = process.env.SECURITY_TARGET;
    delete process.env.SECURITY_TARGET;
    try {
      const { result } = await runCheck('pro_upgrade_url_not_staging_ufile', {
        origin: 'https://incognitobrowser.io',
      });
      expect(result.checked, 'the check inspected nothing — 0 findings over 0 files proves nothing').toBeGreaterThan(0);

      const switchedOn = /export const DEMO_UPGRADE_URL = '[^']+'/.test(code('components/UpgradeButtons.tsx'));
      const blocking = result.findings.filter((f) => f.severity === 'high' || f.severity === 'critical');
      if (switchedOn) {
        expect(blocking.map((f) => f.title), 'a company-host deploy no longer produces a blocking finding while the demo paywall is in the bundle').toHaveLength(1);
        expect(blocking[0].title).toMatch(/demo paywall host/);
        // Same run, demo host: not blocking. Both verdicts from one check is
        // the whole point of it being target-aware.
        const demo = await runCheck('pro_upgrade_url_not_staging_ufile', {
          origin: 'https://206-189-186-34.nip.io',
        });
        expect(demo.result.findings.filter((f) => f.severity === 'high' || f.severity === 'critical')).toEqual([]);
      } else {
        // The switch has been rolled back. Then there is nothing to find and
        // the check must not invent one — the rollback is documented as a
        // one-line edit and must not be what breaks the deploy.
        expect(blocking).toEqual([]);
      }
    } finally {
      if (before === undefined) delete process.env.SECURITY_TARGET; else process.env.SECURITY_TARGET = before;
    }
  });

  it('link 4 — the origin the suite grades is the SITE_ORIGIN the deploy uploads to', async () => {
    // This is the link that makes the gate automatic. buildContext() with no
    // options is exactly how tests/security-suite.test.ts builds its context,
    // and it reads SITE_ORIGIN out of .secrets — the same variable
    // scripts/deploy.sh insists on before it will run.
    const ctxSrc = code('scripts/security/lib/context.mjs');
    expect(ctxSrc, 'buildContext no longer derives its origin from SITE_ORIGIN — the deploy suite and the deploy now aim at different hosts').toMatch(/opts\.origin \|\| secrets\?\.SITE_ORIGIN \|\|/);

    const sh = stripShellComments(read('scripts/deploy.sh'));
    expect(sh, 'scripts/deploy.sh no longer requires SITE_ORIGIN').toMatch(/SITE_ORIGIN:\?/);

    const { buildContext } = await import('../scripts/security/lib/context.mjs' as string) as {
      buildContext: (o?: Record<string, unknown>) => { origin: string };
    };
    const origin = buildContext({}).origin;
    expect(origin, 'buildContext returned no origin at all').toMatch(/^https?:\/\//);

    const secretsPath = path.join(ROOT, '.secrets');
    if (fs.existsSync(secretsPath)) {
      const declared = /^\s*(?:export\s+)?SITE_ORIGIN\s*=\s*(.*)$/m.exec(fs.readFileSync(secretsPath, 'utf-8'));
      if (declared) {
        expect(origin, 'the security context grades a different origin than the one .secrets deploys to').toBe(declared[1].trim().replace(/^["']|["']$/g, ''));
      }
    }
    // And the gate, closed round the other way. This clone deploys to the
    // droplet, which is legitimately a demo target, so the demo paywall is
    // allowed to be in its bundle. The day .secrets is repointed at the
    // company host while that switch is still set, THIS goes red — before
    // anything is built, and before anything is uploaded.
    if (/export const DEMO_UPGRADE_URL = '[^']+'/.test(code('components/UpgradeButtons.tsx'))) {
      const COMPANY_HOSTS = ['incognitobrowser.io', 'www.incognitobrowser.io'];
      expect(
        COMPANY_HOSTS.includes(new URL(origin).host),
        `this clone is configured to deploy to ${origin}, a company production host, while DEMO_UPGRADE_URL is still set in components/UpgradeButtons.tsx — clear the switch or repoint .secrets`,
      ).toBe(false);
    }
  });
});
