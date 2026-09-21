/**
 * The paid control, tested as the thing it actually is.
 *
 * The free site has no such control, so nothing here existed before. On the
 * PRO deployment the entire mechanism is one attribute on <html>:
 *
 *   lib/in-app.ts bootInApp()      sets data-ib-pro only when
 *                                  `source && pro && (bridged || named)`
 *   lib/in-app.ts inAppPro()       reads it, and nothing else
 *   components/useUpgradeGate.tsx  shouldGate() === !inAppPro()
 *   guard(action)                  runs `action` for a subscriber; everyone
 *                                  else gets components/ui/UpgradeOverlay.tsx
 *
 * Three actions sit behind it (lib/card-copy.ts GATE_COPY): cookie-csv-export,
 * browser-privacy-rerun, metadata-multi-file. Scanning, pasting, a single
 * photo and the FIRST audit are free by design and the overlay copy says so —
 * nothing here treats them as paid.
 *
 * Two deliberate choices about how these are written:
 *
 *  1. The guard is exercised, not mocked. vitest.config.ts runs
 *     environment:'node' and there is no React testing library here, so the
 *     hook is rendered with react-dom/server and its real `guard` is invoked
 *     afterwards. The thing under test is the REAL shouldGate()/inAppPro()
 *     pair reading a stubbed <html> — the same way tests/in-app.test.ts and
 *     tests/use-upgrade-gate.test.ts already stub `document`. Stubbing
 *     shouldGate itself would leave the assertion testing the stub.
 *
 *  2. Where a claim is about the SHAPE of the product rather than a value it
 *     computes (no entitlement check on the API; the demo CTA switch), the
 *     test runs the matching security check from
 *     scripts/security/checks/pro-entitlement.mjs and asserts what it
 *     reports. That keeps the finding in the every-commit report — the
 *     finding IS the deliverable for those two — and makes deleting the check
 *     a red test rather than a quiet loss of coverage.
 */
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GATE_COPY } from '@/lib/card-copy';
import { IN_APP_BOOT_SCRIPT } from '@/lib/in-app';

const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf-8');

/* ------------------------------------------------------------------ *
 * fakes: the same shapes tests/in-app.test.ts already uses
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

const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const APP_UA = `${CHROME_UA} IncognitoBrowser/5.2`;

/** Load a page at `href` in a fake tab and run the boot script AS IT SHIPS. */
function boot(href: string, opts: { storage?: FakeStorage; ua?: string; bridge?: unknown } = {}) {
  const root = new FakeElement();
  const storage = opts.storage ?? new FakeStorage();
  const w = {
    document: { documentElement: root },
    location: { href },
    sessionStorage: storage,
    IncognitoBrowserApp: opts.bridge,
    navigator: { userAgent: opts.ua ?? CHROME_UA },
    setTimeout: undefined,
    history: { state: null, replaceState: vi.fn((_s: unknown, _t: string, url: string) => { w.location.href = new URL(url, href).href; }) },
  };
  new Function('window', IN_APP_BOOT_SCRIPT)(w);
  return { root, storage, w };
}

/** Brace-match a function body starting at the first `{` at or after `from`. */
function bodyFrom(src: string, from: number): string {
  const open = src.indexOf('{', from);
  if (open < 0) return '';
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  return src.slice(open);
}

/** Run one check out of scripts/security/checks/pro-entitlement.mjs by id. */
async function runCheck(id: string, opts: Record<string, unknown> = {}) {
  const { buildContext } = await import('../scripts/security/lib/context.mjs' as string);
  const mod = await import('../scripts/security/checks/pro-entitlement.mjs' as string);
  const def = (mod.default as Array<{ id: string; run: (c: unknown) => Promise<{ findings: Array<Record<string, string>>; checked: number }> }>)
    .find((c) => c.id === id);
  if (!def) throw new Error(`no check with id ${id} in scripts/security/checks/pro-entitlement.mjs`);
  return def.run(buildContext(opts));
}

/* ================================================================== *
 * 1. pro_gate_csv_blocked_without_ib_pro
 * ================================================================== */

describe('pro_gate_csv_blocked_without_ib_pro', () => {
  /**
   * Render the REAL useUpgradeGate, capture its real `guard`, then call it.
   *
   * react-dom/server gives us the hook without a DOM: useState's setter is a
   * no-op once the render has returned, which is fine — the two things worth
   * asserting are whether the wrapped action ran, and whether the overlay
   * branch was taken. The overlay branch is observable because guard() writes
   * `document.activeElement` into the ref the hook hands to UpgradeOverlay,
   * and that ref object is right there on the returned element's props.
   */
  type Gate = {
    guard: <A extends unknown[]>(a: (...x: A) => void) => (...x: A) => void;
    overlay: { props: Record<string, unknown> };
    focused: unknown;
  };

  /**
   * The stub has to stay in place while `guard` RUNS, not only while the hook
   * renders: shouldGate() reads `document` at call time, and so does the
   * overlay branch. So the body runs inside the stub rather than after it.
   */
  async function withGate(ibPro: boolean, body: (g: Gate) => void) {
    const root = new FakeElement();
    if (ibPro) root.setAttribute('data-ib-pro', '');
    const focused = { id: 'export-csv-button' };
    vi.resetModules();
    vi.stubGlobal('document', { documentElement: root, activeElement: focused });
    try {
      const { useUpgradeGate } = await import('../components/useUpgradeGate');
      let guard: Gate['guard'] | null = null;
      let overlay: Gate['overlay'] | null = null;
      function Probe() {
        const g = useUpgradeGate({ engine: 'cookie-analyzer', gate: 'cookie-csv-export', ...GATE_COPY['cookie-csv-export'] });
        guard = g.guard as never;
        overlay = g.overlay as never;
        return g.overlay;
      }
      renderToStaticMarkup(createElement(Probe));
      expect(guard, 'useUpgradeGate did not return a guard').toBeTypeOf('function');
      body({ guard: guard!, overlay: overlay!, focused });
    } finally {
      vi.unstubAllGlobals();
    }
  }

  it('without data-ib-pro: Export CSV opens the overlay and downloads nothing', async () => {
    await withGate(false, ({ guard, overlay, focused }) => {
      const downloads: string[] = [];
      // Stands in for downloadCsv(urlResult) — the real call site passes
      // exactly this shape (asserted against the source two tests below).
      guard(() => { downloads.push('example.com-cookie-scan.csv'); })();

      expect(downloads).toEqual([]);
      // The overlay branch ran: the guard stashed the focused element to
      // return focus to, which only happens on the gated path.
      expect((overlay.props.returnFocusTo as { current: unknown }).current).toBe(focused);
      // And the ask it opens is the right one, in the owner's words.
      expect(overlay.props.gate).toBe('cookie-csv-export');
      expect(overlay.props.headline).toBe(GATE_COPY['cookie-csv-export'].headline);
      // The copy is explicit that the scan itself stays free — this gate is
      // the download alone, and the wording must keep saying so.
      expect(String(overlay.props.free)).toMatch(/free/i);
    });
  });

  it('with data-ib-pro: the download happens, untouched', async () => {
    await withGate(true, ({ guard, overlay, focused }) => {
      const downloads: string[] = [];
      guard((name: string) => { downloads.push(name); })('example.com-cookie-scan.csv');

      expect(downloads).toEqual(['example.com-cookie-scan.csv']);
      // The gated path was never taken, so nothing was stashed for focus return.
      expect((overlay.props.returnFocusTo as { current: unknown }).current).not.toBe(focused);
    });
  });

  it('the decision is the real inAppPro(), not a stand-in: an empty attribute value still counts', async () => {
    // <html data-ib-pro> is set with an EMPTY value (setAttribute(k, '')), so
    // anything reading it truthily rather than with hasAttribute() would treat
    // a subscriber as a free visitor. That is not hypothetical: it is the one
    // way this attribute is ever written (lib/in-app.ts bootInApp).
    const root = new FakeElement();
    root.setAttribute('data-ib-pro', '');
    expect(root.getAttribute('data-ib-pro')).toBe('');
    vi.resetModules();
    vi.stubGlobal('document', { documentElement: root });
    try {
      const { shouldGate } = await import('../components/useUpgradeGate');
      const { inAppPro } = await import('../lib/in-app');
      expect(inAppPro()).toBe(true);
      expect(shouldGate()).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('the real Export CSV button is wired through the guard, not straight to downloadCsv', async () => {
    // The unit tests above prove the guard's behaviour. This is the other
    // half: that the product's one CSV button actually goes through it.
    const src = read('components/tools/CookieAnalyzerTool.tsx');
    expect(src).toMatch(/const\s*\{\s*guard:\s*guardExport,\s*overlay:\s*exportGate\s*\}\s*=\s*useUpgradeGate\(/);
    expect(src).toMatch(/onClick=\{guardExport\(\(\) => downloadCsv\(urlResult\)\)\}/);
    // EVERY call of downloadCsv goes through the guard — a second, unguarded
    // one (a keyboard shortcut, a "download again" link) is the realistic way
    // this gate gets bypassed without anybody meaning to.
    const decl = [...src.matchAll(/\b(?:const|function)\s+downloadCsv\b/g)].length;
    expect(decl).toBe(1);
    const unguarded = [...src.matchAll(/\bdownloadCsv\s*\(/g)]
      .filter((m) => !/\bguardExport\s*\(/.test(src.slice(Math.max(0, m.index - 120), m.index)))
      .map((m) => `line ${src.slice(0, m.index).split('\n').length}`);
    expect(unguarded, 'a call to downloadCsv() that does not go through guardExport').toEqual([]);
    // And the overlay the guard opens is actually rendered.
    expect(src).toMatch(/\{exportGate\}/);
  });

  it('the gated download stays client-side — a gate over a server call would be access control by DOM attribute', async () => {
    // What makes a copy-only gate tolerable: the subscriber gets a
    // reformatting of the scan already on their screen, and the server is
    // never asked anything that a free visitor could not ask it.
    // (The CSV's own contents are graded by tests/cookie-analyzer.test.ts —
    // this is only about what the GATE is in front of.)
    const src = read('components/tools/CookieAnalyzerTool.tsx');
    const serverCall = /\bfetch\s*\(|SCAN_API_BASE|navigator\.sendBeacon\s*\(|['"`]\/api\//;
    const body = bodyFrom(src, src.indexOf('const downloadCsv'));
    expect(body).not.toMatch(serverCall);
    // …and so does everything it delegates to.
    for (const name of [...body.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1])) {
      const at = src.search(new RegExp(`\\bexport\\s+function\\s+${name}\\b`));
      if (at < 0) continue;
      expect(bodyFrom(src, at), `${name}(), called from the gated download, reaches the server`).not.toMatch(serverCall);
    }
  });

  it('the security check agrees the wiring is intact', async () => {
    const r = await runCheck('pro_gate_csv_blocked_without_ib_pro');
    expect(r.checked).toBeGreaterThan(0);
    expect(r.findings.map((f) => `[${f.severity}] ${f.title}`)).toEqual([]);
  });
});

/* ================================================================== *
 * 2. pro_gate_not_trusted_as_server_auth   — fails as documented
 * ================================================================== */

describe('pro_gate_not_trusted_as_server_auth', () => {
  /**
   * THIS IS THE ONE THAT IS SUPPOSED TO GO RED, and it goes red in the place
   * that matters: the security report, every run, at medium.
   *
   * It is NOT written as a failing vitest assertion, because the fix it would
   * demand is real server-side authentication, which this product has nowhere
   * — so a red test here would be a test nobody can make green, and those get
   * deleted or skipped within a week. Instead the boundary is asserted as a
   * fact about the code (there is no entitlement check), and the finding that
   * states the consequence is asserted to be PRESENT. Add a genuine
   * server-side check and both the finding and this test's expectation flip
   * together — it is keyed on the absence, not on a comment.
   */
  it('/api/scan-url performs no entitlement check of any kind', () => {
    const src = read('app/scan-url/route.ts');
    for (const marker of [/data-ib-pro/, /\binAppPro\b/, /\bIS_PRO_DEPLOYMENT\b/, /\bisPro\b/, /\brequirePro\b/, /\bentitlement/i, /\bsubscription\b/i, /x-ib-pro/i]) {
      expect(src, `app/scan-url/route.ts unexpectedly matches ${marker} — if a real server-side entitlement check has landed, this whole describe block needs rewriting, not relaxing`).not.toMatch(marker);
    }
    // What it DOES check is anti-abuse, paid identically by everyone. The
    // Authorization header here is the Altcha proof-of-work solution, not a
    // credential: counting it as authorisation is the mistake this test exists
    // to prevent.
    expect(src).toMatch(/parseAltchaAuthHeader\(request\.headers\.get\('authorization'\)\)/);
    expect(src).toMatch(/\brateLimit\(/);
  });

  it('nothing on the server can even see the Pro mark — it is a DOM attribute, and no route reads one', () => {
    // A scripted client sends no attribute, because there is no attribute to
    // send: data-ib-pro exists only in the browser's own document. That is the
    // boundary, stated as code.
    const routes = fs.readdirSync(path.join(ROOT, 'app'), { recursive: true, encoding: 'utf-8' })
      .filter((p) => p.endsWith('route.ts'));
    expect(routes.length).toBeGreaterThan(0);
    for (const r of routes) {
      const src = read(path.join('app', r));
      expect(src, `app/${r} reads an in-app / Pro signal server-side`).not.toMatch(/data-ib-pro|\binAppPro\b|ib-inapp|\bib-pro\b/);
    }
  });

  it('the MEDIUM finding that says so is in the every-commit report', async () => {
    const r = await runCheck('pro_gate_not_trusted_as_server_auth');
    expect(r.checked).toBeGreaterThan(0);
    const f = r.findings.find((x) => x.severity === 'medium' && /UX gate, not authorisation/.test(x.title));
    expect(f, 'the deployment requirement is no longer reported — it would be forgotten at cutover, which is the whole reason it is a finding').toBeTruthy();
    // The two things the report has to actually SAY, verbatim enough to survive
    // an edit that guts the meaning.
    expect(f!.detail).toMatch(/entirely client-side/);
    expect(f!.detail).toMatch(/SSO or network ACLs/);
    expect(f!.detail).toMatch(/\/resources-pro AND/);
    expect(f!.detail).toMatch(/in front of \/api/);
    // Evidence, not opinion: it names the file and what it found there.
    expect(f!.evidence).toMatch(/app\/scan-url\/route\.ts: 0 matches/);
    expect(f!.file).toBe('app/scan-url/route.ts');
  });
});

/* ================================================================== *
 * 3-6. what sets the Pro mark, and what it is worth
 * ================================================================== */

describe('what can set data-ib-pro', () => {
  it('3. ?pro=1 alone sets nothing — no in-app flag, no bridge, no matching user agent', () => {
    expect(boot('https://example.test/tools/x/?pro=1').root.hasAttribute('data-ib-pro')).toBe(false);
    expect(boot('https://example.test/tools/x/?pro=1').root.hasAttribute('data-inapp')).toBe(false);
    // Nor with the in-app flag beside it: a URL is text anyone can type, and
    // until 2026-09-19 these two parameters alone opened all three gates and
    // hid every upgrade band for the rest of the tab, on the open web.
    const { root, storage } = boot('https://example.test/tools/x/?inapp=1&pro=1');
    expect(root.hasAttribute('data-ib-pro')).toBe(false);
    expect(root.getAttribute('data-inapp')).toBe('param');
    // The claim is remembered for the tab in case the app's bridge turns up
    // late — but remembering is not granting.
    expect(storage.getItem('ib-pro')).toBe('1');
    expect(boot('https://example.test/guides/', { storage }).root.hasAttribute('data-ib-pro')).toBe(false);
  });

  it('4. ?inapp=1&pro=1 with an app user agent sets it, and the address bar is cleaned', () => {
    const { root, w } = boot('https://example.test/resources-pro/tools/a/b/?inapp=1&pro=1&utm_source=app#top', { ua: APP_UA });
    expect(root.hasAttribute('data-ib-pro')).toBe(true);
    expect(root.getAttribute('data-inapp')).toBe('param');
    // history.replaceState, once, dropping ONLY the two in-app flags: a link
    // the visitor copies out of the app must not carry Pro into another
    // browser, and must not lose the campaign parameters either.
    expect(w.history.replaceState).toHaveBeenCalledOnce();
    expect(w.location.href).toBe('https://example.test/resources-pro/tools/a/b/?utm_source=app#top');
    expect(w.location.href).not.toMatch(/inapp|pro=/);
    // The regex is /incognito ?browser/i — case-insensitive, space optional.
    for (const ua of [`${CHROME_UA} IncognitoBrowser/5.2`, `${CHROME_UA} Incognito Browser 5.2`, `${CHROME_UA} incognitobrowser`]) {
      expect(boot('https://example.test/?inapp=1&pro=1', { ua }).root.hasAttribute('data-ib-pro')).toBe(true);
    }
    // A user agent that merely says "incognito" is not the app.
    expect(boot('https://example.test/?inapp=1&pro=1', { ua: `${CHROME_UA} IncognitoMode/1.0` }).root.hasAttribute('data-ib-pro')).toBe(false);
  });

  it('5. forged sessionStorage alone grants nothing, and there is no server feature for it to unlock', () => {
    // A visitor who opens devtools and writes the flags the app writes.
    const forged = new FakeStorage();
    forged.setItem('ib-inapp', '1');
    forged.setItem('ib-pro', '1');
    const { root } = boot('https://example.test/resources-pro/tools/a/b/', { storage: forged });
    expect(root.hasAttribute('data-ib-pro')).toBe(false);
    // The tab still labels itself in-app (that is copy only) — but the paid
    // mark needs the bridge or the user agent, which storage cannot fake.
    expect(root.getAttribute('data-inapp')).toBe('param');
    // Navigating on does not launder it either.
    expect(boot('https://example.test/guides/', { storage: forged }).root.hasAttribute('data-ib-pro')).toBe(false);

    // And the second half of the claim: even a visitor who DID set the
    // attribute unlocks no server feature, because there is no server feature
    // keyed to it. Locked in so it stays true.
    const routes = fs.readdirSync(path.join(ROOT, 'app'), { recursive: true, encoding: 'utf-8' })
      .filter((p) => p.endsWith('route.ts'));
    for (const r of routes) {
      expect(read(path.join('app', r)), `app/${r} now keys behaviour off the client's Pro claim`).not.toMatch(/ib-pro|ib-inapp|inAppPro|data-inapp/);
    }
  });

  it('6. a page script CAN self-grant with window.IncognitoBrowserApp — stated, and acceptable only because the mark grants nothing', () => {
    // The honest answer, tested rather than assumed. bootInApp accepts any
    // object at window.IncognitoBrowserApp; on the open web anything that can
    // run script in our origin can put one there before our inline script
    // runs, and be a "subscriber" for the rest of the tab.
    const selfGranted = boot('https://example.test/resources-pro/tools/a/b/?inapp=1&pro=1', { bridge: { postMessage() {} } });
    expect(selfGranted.root.hasAttribute('data-ib-pro')).toBe(true);
    // An empty object counts too — there is no handshake, just a type test.
    expect(boot('https://example.test/?inapp=1&pro=1', { bridge: {} }).root.hasAttribute('data-ib-pro')).toBe(true);
    // Non-objects do not, which is the whole of the current check.
    expect(boot('https://example.test/?inapp=1&pro=1', { bridge: 'yes' }).root.hasAttribute('data-ib-pro')).toBe(false);

    // WHY THAT IS ACCEPTABLE, as an assertion rather than a comment: every
    // gated action is client-side reformatting of what the visitor already
    // has. Self-granting buys nothing and costs the server nothing. If any of
    // these three ever reaches our API, this stops being acceptable and the
    // decision has to move to the server — a stricter handshake would still
    // be a claim made by the client.
    expect(Object.keys(GATE_COPY).sort()).toEqual(['browser-privacy-rerun', 'cookie-csv-export', 'metadata-multi-file']);
    const csv = read('components/tools/CookieAnalyzerTool.tsx');
    const audit = read('components/tools/BrowserPrivacyTool.tsx');
    const meta = read('components/tools/MetadataViewerTool.tsx');
    const serverCall = /\bfetch\s*\(|SCAN_API_BASE|navigator\.sendBeacon\s*\(|['"`]\/api\//;
    expect(bodyFrom(csv, csv.indexOf('const downloadCsv'))).not.toMatch(serverCall);
    expect(bodyFrom(audit, audit.indexOf('const runAudit'))).not.toMatch(serverCall);
    expect(meta).not.toMatch(serverCall); // the metadata reader never touches the network at all
    // The re-run gate is the SECOND audit only; the first one is free, and the
    // call site has to keep saying that.
    expect(audit).toMatch(/onClick=\{runAt > 0 \? guardRerun\(runAudit\) : runAudit\}/);

    // And the report carries the statement, so it is a decision on the record
    // rather than a thing three people happen to know.
    return runCheck('pro_gate_not_trusted_as_server_auth').then((r) => {
      const f = r.findings.find((x) => /self-grant the Pro mark/.test(x.title));
      expect(f, 'the self-grant statement is no longer reported').toBeTruthy();
      expect(f!.severity).toBe('info');
      expect(f!.detail).toMatch(/ACCEPTABLE AS IT STANDS/);
      expect(f!.detail).toMatch(/stops being acceptable/);
    });
  });
});

/* ================================================================== *
 * 7. pro_upgrade_url_not_staging_ufile   — target-aware
 * ================================================================== */

describe('pro_upgrade_url_not_staging_ufile', () => {
  /**
   * DEMO_UPGRADE_URL's VALUE is not asserted anywhere here, deliberately.
   * tests/tiers.test.ts explains why at length: a test that pins it made the
   * documented one-line rollback fail the suite and block the deploy. What is
   * asserted is that the check reaches the right verdict for the right
   * target.
   */
  it('a company / production target fails while the demo host is in the bundle', async () => {
    const before = process.env.SECURITY_TARGET;
    process.env.SECURITY_TARGET = 'company';
    try {
      const r = await runCheck('pro_upgrade_url_not_staging_ufile');
      expect(r.checked).toBeGreaterThan(0);
      const demoSrc = read('components/UpgradeButtons.tsx');
      const switchedOn = /export const DEMO_UPGRADE_URL = '[^']+'/.test(demoSrc);
      const high = r.findings.filter((f) => f.severity === 'high' && /demo paywall host/.test(f.title));
      if (switchedOn) {
        expect(high.length, 'a company deploy must fail while the demo paywall host is in the bundle').toBe(1);
        expect(high[0].evidence).toMatch(/staging\.ufile\.io/);
        expect(high[0].evidence).toMatch(/SECURITY_TARGET=company/);
        expect(high[0].remediation).toMatch(/DEMO_UPGRADE_URL/);
      } else {
        // The switch has been rolled back: then there is nothing to find, and
        // the check must not invent one. Both positions are legitimate.
        expect(high).toEqual([]);
      }
    } finally {
      if (before === undefined) delete process.env.SECURITY_TARGET; else process.env.SECURITY_TARGET = before;
    }
  });

  it('the declared, unexpired demo stays green for the demo target — and is still reported', async () => {
    const before = process.env.SECURITY_TARGET;
    process.env.SECURITY_TARGET = 'demo';
    try {
      const r = await runCheck('pro_upgrade_url_not_staging_ufile');
      // Green: nothing blocking. A live owner decision must not be fought by
      // a check that has no way to know it was made.
      expect(r.findings.filter((f) => f.severity === 'high' || f.severity === 'critical')).toEqual([]);
      const demoSrc = read('components/UpgradeButtons.tsx');
      if (/export const DEMO_UPGRADE_URL = '[^']+'/.test(demoSrc)) {
        // Not silent, either: the decision, its owner and its clock are in the
        // report every single run.
        const info = r.findings.find((f) => f.severity === 'info' && /declared demo paywall/.test(f.title));
        expect(info, 'a declared exception must still be reported, or the suite is hiding a live decision').toBeTruthy();
        expect(info!.evidence).toMatch(/owner=owner/);
        expect(info!.evidence).toMatch(/expires \d{4}-\d{2}-\d{2} \(-?\d+ day\(s\) left\)/);
      }
    } finally {
      if (before === undefined) delete process.env.SECURITY_TARGET; else process.env.SECURITY_TARGET = before;
    }
  });

  it('the exception has an owner, a reason and an end date that has not passed', () => {
    // The forgiveness above is worth exactly as much as this entry. An expired
    // entry fails like a missing one — a demo that cannot expire is not a
    // demo, it is the product.
    const j = JSON.parse(read('scripts/security/data/compliance-exceptions.json'));
    const e = (j.upgradeDestinations as Array<Record<string, string>>).find((d) => d.host === 'staging.ufile.io');
    expect(e, 'staging.ufile.io is no longer declared — the check will now go red on every target').toBeTruthy();
    expect(e!.owner).toBeTruthy();
    expect(e!.reason.length).toBeGreaterThan(40);
    expect(e!.expires).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(e!.expires >= new Date().toISOString().slice(0, 10), `the demo exception expired on ${e!.expires}`).toBe(true);
  });

  it('an unrecognised SECURITY_TARGET is graded as a company deploy, not guessed as a demo', async () => {
    const before = process.env.SECURITY_TARGET;
    process.env.SECURITY_TARGET = 'whatever-this-is';
    try {
      const r = await runCheck('pro_upgrade_url_not_staging_ufile');
      const hit = r.findings.find((f) => /demo paywall host/.test(f.title) || /declared demo paywall/.test(f.title));
      if (hit) expect(hit.severity).toBe('high');
    } finally {
      if (before === undefined) delete process.env.SECURITY_TARGET; else process.env.SECURITY_TARGET = before;
    }
  });

  it('the production host decides on its own when SECURITY_TARGET is unset', async () => {
    const before = process.env.SECURITY_TARGET;
    delete process.env.SECURITY_TARGET;
    try {
      const prod = await runCheck('pro_upgrade_url_not_staging_ufile', { origin: 'https://incognitobrowser.io' });
      const demo = await runCheck('pro_upgrade_url_not_staging_ufile', { origin: 'https://206-189-186-34.nip.io' });
      const sev = (r: { findings: Array<Record<string, string>> }) =>
        r.findings.filter((f) => /demo paywall/.test(f.title)).map((f) => f.severity);
      if (/export const DEMO_UPGRADE_URL = '[^']+'/.test(read('components/UpgradeButtons.tsx'))) {
        expect(sev(prod)).toEqual(['high']);
        expect(sev(demo)).toEqual(['info']);
      }
    } finally {
      if (before !== undefined) process.env.SECURITY_TARGET = before;
    }
  });

  it('the Play package and the single custom scheme are still ours', async () => {
    const { PLAY_PACKAGE, playUrl } = await import('@/lib/play');
    const { APP_UPGRADE_URL, appUpgradeUrl } = await import('@/lib/in-app');
    expect(PLAY_PACKAGE).toBe('com.androidbull.incognito.browser');
    expect(playUrl({ medium: 'gate', campaign: 'cookie-analyzer' }))
      .toMatch(/^https:\/\/play\.google\.com\/store\/apps\/details\?id=com\.androidbull\.incognito\.browser&/);
    expect(APP_UPGRADE_URL).toBe('incognitobrowser://upgrade');
    expect(appUpgradeUrl({ from: 'gate', benefit: 'tracker-blocking' })).toBe('incognitobrowser://upgrade?from=gate&benefit=tracker-blocking');
    // No second custom scheme anywhere in lib/, components/ or app/ — the
    // check reports any that is actually navigated to.
    const r = await runCheck('pro_upgrade_url_not_staging_ufile');
    expect(r.findings.filter((f) => /custom scheme/.test(f.title) || /Play link names/.test(f.title) || /Play package/.test(f.title))).toEqual([]);
  });
});
