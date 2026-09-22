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
 *       REFUTED, and the refutation stands: the audit's gap was "there is no
 *       CI, so something still has to run it". There is no CI — but the gate
 *       is not CI, it is scripts/deploy.sh itself, and the chain that makes
 *       that work had never been asserted anywhere. It is asserted below,
 *       link by link. Two of those links (1 and 4) were first asserted as
 *       regexes over source text and a verifier broke both without either
 *       going red — details at the E8 block. They are now asserted by
 *       executing the script and the module they describe.
 *
 *   V3  the self-grant finding in scripts/security/checks/pro-entitlement.mjs
 *       named one way of granting the Pro mark (a forged bridge object before
 *       boot) and not the other (the attribute itself, set from the DevTools
 *       console after load). The report now names both, and that is graded
 *       on the check's OUTPUT, not its source.
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
 *     this file later asserts on. The E8 sandboxes run unmodified COPIES of
 *     scripts/deploy.sh and scripts/security/lib/context.mjs in child
 *     processes, inside temp trees that are deleted afterwards; they touch
 *     nothing in this checkout and contact nothing outside it.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
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
   *                              refuses to run without and builds both
   *                              sites for
   *
   * The last link is the one that makes it work without anybody remembering to
   * set SECURITY_TARGET: point .secrets at incognitobrowser.io and the suite
   * starts grading as a company deploy on its own. Not one link of that chain
   * was asserted anywhere, so any of them could have been edited away in
   * silence. Each is asserted below.
   *
   * Links 1 and 4 were first written as regexes over the SOURCE of deploy.sh
   * and context.mjs, and a verifier broke both without either going red:
   *
   *   link 1 compared String.indexOf positions of 'npm test', 'next build'
   *   and 'rsync'. Text order is not execution order. Wrapping the test line
   *   in `run_tests() { … }` and invoking `run_tests` as the LAST line of the
   *   script left all three positions where they were and the test green,
   *   while the deploy now built and uploaded first and ran the suite after —
   *   precisely the regression the test is named for. An `if`, a `case` or
   *   any function body defeats indexOf the same way.
   *
   *   link 4 matched /opts\.origin \|\| secrets\?\.SITE_ORIGIN \|\|/ in
   *   context.mjs. `const legacyOrigin = opts.origin || secrets?.SITE_ORIGIN
   *   || …; void legacyOrigin; const siteOrigin = opts.origin || '…'` keeps
   *   that text alive as dead code, stops reading SITE_ORIGIN, and the test
   *   stayed green. Its behavioural half compared buildContext({}).origin to
   *   this clone's real .secrets, whose SITE_ORIGIN is byte-identical to the
   *   hard-coded fallback — so it passed with .secrets unread — and in a clone
   *   with no .secrets at all it graded nothing.
   *
   * Both are now measured by EXECUTING the thing they describe. deploy.sh is
   * run, unmodified, from a sandbox whose PATH puts stubs of npm, npx, node,
   * git, ssh and rsync first; each stub appends its own invocation to a log,
   * so the log IS the execution order, and nothing real is built, contacted
   * or uploaded. context.mjs is imported, unmodified, from a sandbox whose
   * .secrets names an origin that exists nowhere else, and the origin it
   * returns is read back. Neither can be satisfied by text that does not run.
   */

  /* ---------------- the deploy sandbox ---------------- */

  /**
   * The login deploy.sh insists on before it does anything. deploy.invalid is
   * RFC 2606 reserved and cannot resolve, and the key does not exist, so even
   * if a stub were somehow skipped the real ssh or rsync would have nowhere to
   * go. Nothing in this sandbox names a real host.
   */
  const SANDBOX_SECRETS: Record<string, string> = {
    DEPLOY_HOST: 'deploy.invalid',
    DEPLOY_USER: 'nobody',
    DEPLOY_SSH_KEY: '/nonexistent/sandbox-deploy-key',
    SITE_ORIGIN: 'https://sandbox.example',
  };

  /**
   * Every external command deploy.sh runs that could build, contact or ship
   * something. Everything else it runs (sed, find, grep, cp, rm, mktemp, date)
   * is real and confined to the sandbox tree.
   */
  const STUBBED = ['npm', 'npx', 'node', 'git', 'ssh', 'rsync'] as const;

  /**
   * One stub for all six, keyed on the name it was invoked as. It records the
   * call, touches nothing real, and does the least each name needs for the
   * real script to carry on past it.
   *
   * ONE file, not six, on purpose: this Mac assesses every freshly written
   * executable on its first exec (measured at ~0.3s each, cached per file,
   * a symlink to an assessed file is free). Six fresh stubs per sandbox made
   * each run cost two seconds; one dispatcher linked under six names costs
   * that once per run of this file. deploy.sh itself is read by the shell,
   * not exec'd, so its per-sandbox copy pays nothing.
   */
  const DISPATCHER = [
    '#!/bin/sh',
    'name="${0##*/}"',
    'printf \'%s\\n\' "$name $*" >> "$DEPLOY_CALL_LOG"',
    'case "$name" in',
    // `npm test` exits as the sandbox says; anything else npm is asked for succeeds.
    '  npm) if [ "$1" = test ]; then exit "${DEPLOY_STUB_NPM_TEST_EXIT:-0}"; fi ;;',
    // `next build` records the origins it was handed, and leaves an out/ for
    // the find/cp/grep steps that follow it in the real script.
    '  npx) if [ "$1" = next ] && [ "$2" = build ]; then',
    '         printf \'%s\\n\' "build-env BASE_PATH=${BASE_PATH:-} NEXT_PUBLIC_TIER=${NEXT_PUBLIC_TIER:-} NEXT_PUBLIC_FREE_URL=${NEXT_PUBLIC_FREE_URL:-} NEXT_PUBLIC_PRO_URL=${NEXT_PUBLIC_PRO_URL:-}" >> "$DEPLOY_CALL_LOG"',
    '         mkdir -p out',
    '       fi ;;',
    '  git) if [ "$1" = rev-parse ]; then echo sandbox0; fi ;;',
    // Whatever it is asked, ssh answers with the managed block the script is
    // about to compare against, so the live-headers check passes on its real
    // path rather than through DEPLOY_SKIP_HTACCESS_CHECK.
    '  ssh) cat "$DEPLOY_SANDBOX_ROOT/scripts/droplet-htaccess.conf" ;;',
    'esac',
    'exit 0',
    '',
  ].join('\n');

  let stubBin: string | null = null;
  function sharedStubBin(): string {
    if (stubBin) return stubBin;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-deploy-stubs-'));
    const dispatcher = path.join(dir, 'dispatch.sh');
    fs.writeFileSync(dispatcher, DISPATCHER, { mode: 0o755 });
    stubBin = path.join(dir, 'bin');
    fs.mkdirSync(stubBin);
    for (const name of STUBBED) fs.symlinkSync(dispatcher, path.join(stubBin, name));
    return stubBin;
  }
  afterAll(() => {
    if (stubBin) fs.rmSync(path.dirname(stubBin), { recursive: true, force: true });
  });

  type DeployRun = { status: number | null; stdout: string; stderr: string; calls: string[] };

  /**
   * Run scripts/deploy.sh AS IT IS IN THE REPO, from a sandbox tree. The
   * script does `cd "$(dirname "$0")/.."`, so a byte-for-byte copy at
   * <sandbox>/scripts/deploy.sh runs against <sandbox>: its `rm -rf out
   * .next`, its .secrets, its out/ are all there and nowhere else.
   */
  function deployRun(opts: { secrets: Record<string, string>; npmTestFails?: boolean }): DeployRun {
    const bin = sharedStubBin();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-deploy-sandbox-'));
    try {
      fs.mkdirSync(path.join(root, 'scripts'));
      const script = path.join(root, 'scripts', 'deploy.sh');
      fs.copyFileSync(path.join(ROOT, 'scripts', 'deploy.sh'), script);
      // The two repo files it reads besides .secrets. The conf carries no
      // __HTTPS_HOST__ placeholder, so `want` is the file verbatim and the ssh
      // stub can answer with the same bytes.
      fs.writeFileSync(path.join(root, 'scripts', 'droplet-htaccess.conf'),
        '# BEGIN pseo-security-headers\nHeader always set X-Sandbox "1"\n# END pseo-security-headers\n');
      fs.writeFileSync(path.join(root, 'scripts', 'site.htaccess'), '# sandbox site.htaccess\n');
      fs.writeFileSync(path.join(root, '.secrets'),
        Object.entries(opts.secrets).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
      const log = path.join(root, 'calls.log');

      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.DEPLOY_SKIP_HTACCESS_CHECK; // the real path, not the escape hatch
      delete env.DEPLOY_WEB_ROOT;
      const r = spawnSync('bash', [script], {
        cwd: root, encoding: 'utf-8', timeout: 60_000,
        env: {
          ...env,
          PATH: `${bin}${path.delimiter}${env.PATH || '/usr/bin:/bin'}`,
          DEPLOY_SANDBOX_ROOT: root,
          DEPLOY_CALL_LOG: log,
          DEPLOY_STUB_NPM_TEST_EXIT: opts.npmTestFails ? '1' : '0',
        },
      });
      if (r.error) throw r.error;
      const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf-8').split('\n').filter(Boolean) : [];
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, calls };
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }

  const first = (calls: string[], re: RegExp) => calls.findIndex((c) => re.test(c));
  const TESTS = /^npm test\b/;
  const BUILD = /^npx next build\b/;
  const UPLOAD = /^rsync\b/;

  it('link 1 — a failing unit suite stops deploy.sh before it builds or uploads anything', () => {
    const run = deployRun({ secrets: SANDBOX_SECRETS, npmTestFails: true });
    expect(first(run.calls, TESTS), `deploy.sh never ran the unit suite — the only company-deploy gate in this repo is gone:\n${run.stdout}${run.stderr}`).toBeGreaterThan(-1);
    expect(run.status, 'the unit suite failed and deploy.sh still exited 0 — the gate is advisory').not.toBe(0);
    expect(run.calls.filter((c) => BUILD.test(c)), `deploy.sh built a site after the unit suite had already failed — the suite runs after the build, or its failure does not stop the script:\n${run.calls.join('\n')}`).toEqual([]);
    expect(run.calls.filter((c) => UPLOAD.test(c)), `deploy.sh uploaded after the unit suite had already failed:\n${run.calls.join('\n')}`).toEqual([]);
  });

  it('link 1 — with the suite passing, the order of execution is tests, then build, then upload, for both sites', () => {
    // The control for the test above: a sandbox in which deploy.sh could not
    // get past `npm test` for some reason of its own would pass "nothing was
    // built after the failure" while proving nothing. So the same sandbox,
    // with the suite passing, has to run the whole script to the end.
    const run = deployRun({ secrets: SANDBOX_SECRETS });
    expect(run.status, `deploy.sh did not complete in the sandbox:\n${run.stdout}${run.stderr}`).toBe(0);
    const tests = first(run.calls, TESTS);
    const build = first(run.calls, BUILD);
    const upload = first(run.calls, UPLOAD);
    expect(tests, 'no `npm test` in the execution log').toBeGreaterThan(-1);
    expect(build, 'no `npx next build` in the execution log').toBeGreaterThan(-1);
    expect(upload, 'no rsync in the execution log').toBeGreaterThan(-1);
    expect(tests, `the unit suite ran after the first build:\n${run.calls.join('\n')}`).toBeLessThan(build);
    expect(build, `the first upload ran before the first build:\n${run.calls.join('\n')}`).toBeLessThan(upload);
    // The whole script, not the first half of it: two tiers, two builds, two uploads.
    expect(run.calls.filter((c) => BUILD.test(c))).toHaveLength(2);
    expect(run.calls.filter((c) => UPLOAD.test(c))).toHaveLength(2);
    // Every remote command was aimed at the login from the sandbox .secrets:
    // the script read OUR file, and nothing here could ever reach a real host.
    const remote = run.calls.filter((c) => /^(ssh|rsync)\b/.test(c));
    expect(remote.length).toBeGreaterThan(0);
    for (const c of remote) expect(c).toContain('nobody@deploy.invalid');
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

  it('link 4 — buildContext() takes its origin from SITE_ORIGIN in .secrets: the value, read back, not the text', () => {
    // This is the link that makes the gate automatic. buildContext() with no
    // options is exactly how tests/security-suite.test.ts builds its context.
    //
    // context.mjs resolves .secrets three directories above itself, so an
    // unmodified copy at the same depth in a sandbox reads the sandbox's
    // .secrets. The probe origin below exists nowhere else — not in the
    // environment, not in any fallback — so if it comes back, it came from
    // that file. Run in a child node process, from the sandbox, so neither
    // vitest's module cache nor this checkout's cwd can feed it anything.
    const PROBE = 'https://link4-probe.example';
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-context-sandbox-'));
    try {
      const lib = path.join(root, 'scripts', 'security', 'lib');
      fs.mkdirSync(lib, { recursive: true });
      for (const f of ['context.mjs', 'harness.mjs']) {
        fs.copyFileSync(path.join(ROOT, 'scripts', 'security', 'lib', f), path.join(lib, f));
      }
      fs.writeFileSync(path.join(root, '.secrets'), `SITE_ORIGIN=${PROBE}\n`);
      fs.writeFileSync(path.join(root, 'probe.mjs'), [
        "import { buildContext } from './scripts/security/lib/context.mjs';",
        'const fromSecrets = buildContext({});',
        "const explicit = buildContext({ origin: 'https://explicit.example' });",
        'console.log(JSON.stringify({',
        '  hasSecrets: fromSecrets.hasSecrets, origin: fromSecrets.origin,',
        '  freeBase: fromSecrets.freeBase, proBase: fromSecrets.proBase, apiBase: fromSecrets.apiBase,',
        '  explicit: explicit.origin,',
        '}));',
        '',
      ].join('\n'));
      const env: NodeJS.ProcessEnv = { ...process.env };
      delete env.SITE_ORIGIN;
      delete env.SECURITY_TARGET;
      const r = spawnSync(process.execPath, [path.join(root, 'probe.mjs')], { cwd: root, encoding: 'utf-8', env, timeout: 30_000 });
      expect(r.status, `the probe did not run:\n${r.stdout}${r.stderr}`).toBe(0);
      const got = JSON.parse(r.stdout.trim().split('\n').pop()!) as Record<string, unknown>;
      expect(got.hasSecrets, 'buildContext() did not find the sandbox .secrets — it no longer reads .secrets from the directory above scripts/').toBe(true);
      expect(got.origin, 'buildContext() no longer derives its origin from SITE_ORIGIN — the deploy suite and the deploy now aim at different hosts').toBe(PROBE);
      expect(got.freeBase).toBe(`${PROBE}/resources`);
      expect(got.proBase).toBe(`${PROBE}/resources-pro`);
      expect(got.apiBase).toBe(`${PROBE}/api`);
      // An explicit origin still wins over the file — that is how link 3 aims
      // the check at the company host from a clone whose .secrets says demo.
      expect(got.explicit).toBe('https://explicit.example');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('link 4 — deploy.sh reads the same SITE_ORIGIN: it will not start without one, and builds both sites for the one it finds', () => {
    // Without it, nothing runs at all — not the live-headers check, not the
    // suite, not a build. A default slipped in (`SITE_ORIGIN="${SITE_ORIGIN:-…}"`)
    // would let a deploy proceed for an origin the security context never saw.
    const without = Object.fromEntries(Object.entries(SANDBOX_SECRETS).filter(([k]) => k !== 'SITE_ORIGIN'));
    const bare = deployRun({ secrets: without });
    expect(bare.status, 'deploy.sh ran with no SITE_ORIGIN in .secrets').not.toBe(0);
    expect(bare.stderr).toMatch(/SITE_ORIGIN/);
    expect(bare.calls, 'deploy.sh executed something before discovering SITE_ORIGIN was missing').toEqual([]);

    // With it, the value from .secrets — and only that value — is what both
    // builds are told the site's origin is, and what the script reports live.
    const PROBE = 'https://link4-probe.example';
    const run = deployRun({ secrets: { ...SANDBOX_SECRETS, SITE_ORIGIN: PROBE } });
    expect(run.status, `deploy.sh did not complete:\n${run.stdout}${run.stderr}`).toBe(0);
    const builds = run.calls
      .filter((c) => c.startsWith('build-env '))
      .map((c) => Object.fromEntries(c.slice('build-env '.length).split(' ').map((kv) => {
        const i = kv.indexOf('=');
        return [kv.slice(0, i), kv.slice(i + 1)];
      })));
    expect(builds, 'expected exactly two `next build` invocations, free and Pro').toHaveLength(2);
    expect(builds.map((b) => b.BASE_PATH).sort()).toEqual(['/resources', '/resources-pro']);
    for (const b of builds) {
      expect(b.NEXT_PUBLIC_FREE_URL, `the ${b.BASE_PATH} build was told a free-site origin that is not the .secrets SITE_ORIGIN`).toBe(`${PROBE}/resources`);
      expect(b.NEXT_PUBLIC_PRO_URL, `the ${b.BASE_PATH} build was told a Pro-site origin that is not the .secrets SITE_ORIGIN`).toBe(`${PROBE}/resources-pro`);
    }
    expect(run.stdout).toContain(`${PROBE}/resources-pro/tools/`);
  });
});

/* ================================================================== *
 * V3. The second way in is on the record, and the severity still moves.
 * ================================================================== */

describe('V3 — the self-grant finding names the console path, and its severity follows the target', () => {
  /**
   * The first pass found that the self-grant finding described one bypass — a
   * script that plants window.IncognitoBrowserApp BEFORE the boot script runs
   * — and left the other unsaid. The mark is a plain attribute on <html>;
   * inAppPro() reads it and nothing about who wrote it; nothing re-checks it
   * after boot. So `document.documentElement.setAttribute('data-ib-pro', '')`
   * in the DevTools console of a page that has already loaded is the same
   * grant with no handshake at all. tests/pro-entitlement.test.ts already
   * runs the real inAppPro() and shouldGate() against exactly that document;
   * what was missing was the report SAYING so, and a finding that names one
   * of two doors reads as if the other is shut.
   *
   * Graded on the check's OUTPUT, by running it — not on its source, where
   * the same words also appear in a comment.
   */
  const CHECK = 'pro_gate_not_trusted_as_server_auth';
  const selfGrant = (r: { findings: Array<Record<string, string>> }) => r.findings.find((f) => /self-grant the Pro mark/.test(f.title));

  /** resolveTarget() reads SECURITY_TARGET before the origin; a stray one would grade the wrong deploy. */
  async function withoutTargetEnv<T>(body: () => Promise<T>): Promise<T> {
    const before = process.env.SECURITY_TARGET;
    delete process.env.SECURITY_TARGET;
    try {
      return await body();
    } finally {
      if (before === undefined) delete process.env.SECURITY_TARGET; else process.env.SECURITY_TARGET = before;
    }
  }

  it('the finding names both doors: the forged bridge before boot, and the console after load', async () => {
    const { result } = await withoutTargetEnv(() => runCheck(CHECK, { origin: 'https://206-189-186-34.nip.io' }));
    const f = selfGrant(result);
    expect(f, 'the self-grant statement is no longer reported').toBeTruthy();
    // Door one, as before.
    expect(f!.detail).toMatch(/window\.IncognitoBrowserApp = \{ postMessage\(\)\{\} \} before the boot script runs/);
    // Door two: the statement, the exact incantation, and when it works.
    expect(f!.detail).toMatch(/DevTools console/);
    expect(f!.detail).toMatch(/document\.documentElement\.setAttribute\('data-ib-pro', ''\)/);
    expect(f!.detail).toMatch(/after the page has loaded/);
    // And the acceptance the existing suite pins now covers both doors.
    expect(f!.detail).toMatch(/both are ACCEPTABLE AS IT STANDS/);
  });

  it('the 2026-09-22 target-aware severity is still there: info for the demo, high for the company host', async () => {
    const demo = await withoutTargetEnv(() => runCheck(CHECK, { origin: 'https://206-189-186-34.nip.io' }));
    const company = await withoutTargetEnv(() => runCheck(CHECK, { origin: 'https://incognitobrowser.io' }));
    expect(selfGrant(demo.result)?.severity).toBe('info');
    expect(selfGrant(company.result)?.severity, 'a company-host run no longer escalates the self-grant statement — it would sail through the deploy suite at cutover').toBe('high');
  });
});
