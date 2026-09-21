/**
 * The Android WebView bridge — the one place page JavaScript reaches native code.
 *
 * These run the real exported functions (lib/in-app.ts) against a recording
 * bridge object, which is the only way to see what actually crosses the
 * boundary: `saveImage` ends in a MediaStore write and `upgrade` in the app's
 * purchase screen (IN-APP-BRIDGE.md §2, §3).
 *
 * THE HALF THESE TESTS CANNOT SEE. There is no APK, no Android source and
 * nothing to decompile in this repo, so every assertion below is about the WEB
 * side: what the page sends, and what it will navigate to. Whether the native
 * handler validates what it receives is not observable from here and is never
 * asserted. Where the web side sends something unvalidated, the test says so in
 * its own name rather than quietly passing — see the GAP block, which pins
 * today's behaviour on purpose so a fix has to come past it, and which the
 * security check `pro_bridge_saveImage_filename_and_mime`
 * (scripts/security/checks/pro-bridge-contract.mjs) reports as a finding.
 *
 * Test ids in the describe() titles are the owner's CI names.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { appUpgradeUrl, APP_UPGRADE_URL, openAppUpgrade, saveImageInApp } from '@/lib/in-app';
import { scorecardFilename } from '@/lib/scorecard';

const REPO = process.cwd();
const read = (rel: string) => fs.readFileSync(path.join(REPO, rel), 'utf-8');

/** The origins in the Kotlin setOf(…) the app team copies out of IN-APP-BRIDGE.md §2. */
function bridgeAllowlist(): string[] {
  const setOf = /setOf\(([\s\S]*?)\)/.exec(read('IN-APP-BRIDGE.md'));
  if (!setOf) throw new Error('IN-APP-BRIDGE.md has no setOf( … ) block — the app allowlist is not in the contract any more');
  return [...setOf[1].matchAll(/"([^"]+)"/g)].map((m) => new URL(m[1]).origin);
}

class FakeElement {
  attrs = new Map<string, string>();
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  removeAttribute(k: string) { this.attrs.delete(k); }
  getAttribute(k: string) { return this.attrs.has(k) ? this.attrs.get(k)! : null; }
  hasAttribute(k: string) { return this.attrs.has(k); }
}

const PAGE = '/tools/ad-tracking/ad-blocker-test/';
const WEB_HREF = `https://206-189-186-34.nip.io/resources${PAGE}`;

/** Every message the page put on the bridge, parsed. */
type Msg = Record<string, unknown>;

function setUp() {
  const root = new FakeElement();
  const loc = { href: WEB_HREF, pathname: PAGE };
  const win: Record<string, unknown> = { location: loc };
  vi.stubGlobal('document', { documentElement: root });
  vi.stubGlobal('window', win);
  vi.stubGlobal('location', loc);
  // Node has Blob but no FileReader; saveImageInApp base64-encodes through one.
  vi.stubGlobal('FileReader', class {
    result: string | null = null;
    error: unknown = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(b: Blob) {
      b.arrayBuffer().then((buf) => {
        this.result = `data:${b.type};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.();
      });
    }
  });
  return { root, loc, win };
}

/** A bridge object of the shape any page script could assign. Records everything. */
function recorder() {
  const messages: Msg[] = [];
  const raw: string[] = [];
  const interfaceCalls: unknown[][] = [];
  return {
    messages, raw, interfaceCalls,
    postMessage(s: string) { raw.push(s); messages.push(JSON.parse(s)); },
    saveImage(...args: unknown[]) { interfaceCalls.push(args); },
  };
}

const png = () => new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

describe('pro_bridge_saveImage_filename_and_mime — the two values that reach a native file write', () => {
  let env: ReturnType<typeof setUp>;
  beforeEach(() => { env = setUp(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * GAP, reported by the check of the same name. These three assert what the
   * code DOES today, not what it should do: the web side applies no validation
   * whatsoever to the filename or the MIME type before handing them to the app.
   * They are written as the current behaviour so the suite stays honest about
   * it — when the validation lands, these three fail and get rewritten as
   * refusals, which is the point of pinning them.
   *
   * The native side may or may not reject these. That is not observable here
   * and is not asserted.
   */
  describe('GAP: the web side validates neither value', () => {
    it('a path-traversal filename crosses the bridge unchanged', async () => {
      env.root.setAttribute('data-inapp', 'param');
      const bridge = recorder();
      env.win.IncognitoBrowserApp = bridge;
      expect(await saveImageInApp(png(), '../../Download/evil.html')).toBe(true);
      expect(bridge.messages[0]).toMatchObject({ action: 'saveImage', filename: '../../Download/evil.html' });
      // Nothing stripped the directory segments, and nothing required an image extension.
      expect(String(bridge.messages[0].filename)).toContain('..');
    });

    it('an .apk filename crosses the bridge unchanged', async () => {
      env.root.setAttribute('data-inapp', 'param');
      const bridge = recorder();
      env.win.IncognitoBrowserApp = bridge;
      expect(await saveImageInApp(png(), 'update.apk')).toBe(true);
      expect(bridge.messages[0]).toMatchObject({ filename: 'update.apk' });
    });

    it('the MIME type is whatever the Blob carried — no image/png|jpeg|webp allowlist', async () => {
      env.root.setAttribute('data-inapp', 'param');
      const bridge = recorder();
      env.win.IncognitoBrowserApp = bridge;
      const html = new Blob(['<script>'], { type: 'text/html' });
      expect(await saveImageInApp(html, 'card.png')).toBe(true);
      expect(bridge.messages[0]).toMatchObject({ mime: 'text/html' });
    });

    it('the addJavascriptInterface path is the same: (base64, filename, mime), unchecked', async () => {
      env.root.setAttribute('data-inapp', 'param');
      const bridge = { saveImage: vi.fn() };
      env.win.IncognitoBrowserApp = bridge;
      const jpeg = new Blob([new Uint8Array([255, 216])], { type: 'image/jpeg' });
      expect(await saveImageInApp(jpeg, '../evil.apk')).toBe(true);
      expect(bridge.saveImage).toHaveBeenCalledWith('/9g=', '../evil.apk', 'image/jpeg');
    });
  });

  /**
   * Why the gap is not reachable today: the one production caller
   * (components/Scorecard.tsx, held to that by mast-save-image-caller-allowlist)
   * never builds a name that could carry either shape. That is containment at
   * the CALL SITE, and it is what keeps the finding at medium — it disappears
   * the moment a second caller passes a visitor-supplied name.
   */
  describe('containment: the only caller cannot produce either shape', () => {
    it('scorecardFilename() flattens traversal, extensions and everything else', () => {
      expect(scorecardFilename('../../Download/evil.html')).toBe('privacy-scorecard-download-evil-html.png');
      expect(scorecardFilename('update.apk')).toBe('privacy-scorecard-update-apk.png');
      expect(scorecardFilename('a\\b:c*d?"e<f>g|h')).toMatch(/^privacy-scorecard-[a-z0-9-]*\.png$/);
      // Always an image extension, never a directory separator, always bounded.
      for (const hostile of ['../../etc/passwd', 'x'.repeat(500), '', '..', './.']) {
        const out = scorecardFilename(hostile);
        expect(out.endsWith('.png')).toBe(true);
        expect(out).not.toMatch(/[\\/]/);
        expect(out).not.toContain('..');
        expect(out.length).toBeLessThanOrEqual('privacy-scorecard-'.length + 60 + '.png'.length);
      }
    });

    it('Scorecard.tsx is the caller, and it goes through scorecardFilename', () => {
      const src = read('components/Scorecard.tsx');
      expect(src).toMatch(/saveImageInApp\(b, scorecardFilename\(full\.title\)\)/);
    });
  });

  it('with no bridge the image never leaves the page', async () => {
    env.root.setAttribute('data-inapp', 'param');
    expect(await saveImageInApp(png(), 'scorecard.png')).toBe(false);
  });
});

describe('pro_bridge_unknown_action_ignored — only two actions exist', () => {
  let env: ReturnType<typeof setUp>;
  beforeEach(() => { env = setUp(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('driving both handoffs puts exactly upgrade and saveImage on the wire', async () => {
    env.root.setAttribute('data-inapp', 'param');
    const bridge = recorder();
    env.win.IncognitoBrowserApp = bridge;
    openAppUpgrade({ from: 'result', topic: 'ad-tracking', result: 'amber', tool: 'ad-blocker-test' });
    openAppUpgrade({ from: 'header' });
    await saveImageInApp(png(), 'scorecard.png');
    expect(bridge.messages.map((m) => m.action)).toEqual(['upgrade', 'upgrade', 'saveImage']);
    // And every message is versioned, so the native side can refuse a shape it does not know.
    expect(bridge.messages.every((m) => m.v === 1)).toBe(true);
  });

  it('the dispatch the app implements has those two branches and no catch-all', () => {
    // IN-APP-BRIDGE.md §2 is the code the app team copies. A Kotlin `when` with
    // only named branches ignores an unknown action by construction — which
    // matters because addWebMessageListener injects the bridge into EVERY page
    // on an allowed origin, so anything that gets script onto that host can
    // post arbitrary JSON at it (IN-APP-BRIDGE.md:16 says so).
    const doc = read('IN-APP-BRIDGE.md');
    const when = /when\s*\(\s*msg\.optString\("action"\)\s*\)\s*\{([\s\S]*?)\n\s*\}/.exec(doc);
    expect(when, 'the dispatch snippet has gone from the contract').not.toBeNull();
    const body = when![1];
    expect([...body.matchAll(/"([^"]+)"\s*->/g)].map((m) => m[1])).toEqual(['upgrade', 'saveImage']);
    expect(body).not.toMatch(/(^|\n)\s*else\s*->/);
  });

  it('the page has no code path that emits a third action', () => {
    const src = read('lib/in-app.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
    expect([...src.matchAll(/action:\s*'([^']+)'/g)].map((m) => m[1]).sort()).toEqual(['saveImage', 'upgrade']);
  });
});

describe('the upgrade tap can only ever produce incognitobrowser://upgrade', () => {
  let env: ReturnType<typeof setUp>;
  beforeEach(() => { env = setUp(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('the custom scheme is a constant, and it is the one the contract tells the app to catch', () => {
    expect(APP_UPGRADE_URL).toBe('incognitobrowser://upgrade');
    expect(read('IN-APP-BRIDGE.md')).toContain('incognitobrowser://upgrade?from=result');
  });

  /**
   * The context comes off data-upgrade-* attributes in the DOM
   * (components/InAppBridge.tsx reads them from the tapped link), so these are
   * the values a page could influence. URLSearchParams form-encodes them, which
   * is what stops one from smuggling a second URL into the string the WebView
   * is handed.
   */
  it('hostile context values cannot introduce a second scheme', () => {
    const hostile = {
      from: 'result#intent://evil/#Intent;scheme=http;end',
      topic: 'x&from=header',
      result: 'file:///data/data/com.androidbull.incognito.browser/',
      tool: 'javascript:alert(1)',
      benefit: '../../..',
    };
    const url = appUpgradeUrl(hostile);
    expect(url.startsWith('incognitobrowser://upgrade?')).toBe(true);
    const after = url.slice('incognitobrowser://upgrade?'.length);
    // No un-encoded scheme, fragment or separator survives into the query.
    expect(after).not.toMatch(/intent:|file:|javascript:/);
    expect(after).not.toContain('#');
    expect(after.split('&').map((kv) => kv.split('=')[0]).sort()).toEqual(['benefit', 'from', 'result', 'tool', 'topic']);
  });

  it('a real tap inside the app navigates to that URL and nothing else', () => {
    env.root.setAttribute('data-inapp', 'param');
    expect(openAppUpgrade({ from: 'result#intent://evil', tool: 'javascript:alert(1)' })).toBe(true);
    expect(env.loc.href.startsWith('incognitobrowser://upgrade?')).toBe(true);
    expect(env.loc.href).not.toMatch(/intent:\/\/|file:\/\/|javascript:/);
  });

  it('nothing on the in-app navigation path names another custom scheme', () => {
    // data: is deliberately excluded: blobToDataUrl builds one for the
    // press-and-hold image and blobToBase64 strips one, neither a navigation.
    for (const rel of ['lib/in-app.ts', 'components/InAppBridge.tsx']) {
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      expect(src, `${rel} names a custom scheme other than the app's own`).not.toMatch(/['"`](intent|file|javascript|content|market|android-app):/);
    }
  });

  it('the click handler never navigates to the tapped link itself when it hands the tap over', () => {
    // The upgrade branch calls openAppUpgrade and preventDefault()s; it never
    // reads a.href. So whatever href the button carries — today the demo
    // paywall (components/UpgradeButtons.tsx DEMO_UPGRADE_URL, a live owner
    // decision) — cannot become the in-app navigation target.
    const src = read('components/InAppBridge.tsx');
    expect(src).toMatch(/if \(isUpgradeLink\(a\)\) \{[\s\S]*?openAppUpgrade\(\{/);
    expect(src).toMatch(/if \(handled\) e\.preventDefault\(\);/);
  });
});

describe('the bridge origin allowlist: FREE_BASE_URL and PRO_BASE_URL must move together', () => {
  afterEach(() => { vi.resetModules(); });

  async function tiers(env: Record<string, string | undefined>) {
    vi.resetModules();
    for (const k of ['NEXT_PUBLIC_TIER', 'NEXT_PUBLIC_PRO_URL', 'NEXT_PUBLIC_FREE_URL']) delete process.env[k];
    for (const [k, v] of Object.entries(env)) if (v !== undefined) process.env[k] = v;
    return import('@/lib/tiers');
  }

  it('the two allowlisted origins are the same host today', async () => {
    const { FREE_BASE_URL, PRO_BASE_URL } = await tiers({});
    expect(new URL(FREE_BASE_URL).origin).toBe(new URL(PRO_BASE_URL).origin);
  });

  it('the in-app link rewriter derives its origin set from exactly those two constants', () => {
    const src = read('components/InAppBridge.tsx');
    expect(src).toMatch(/const SISTER_ORIGINS = new Set\(\s*\[FREE_BASE_URL, PRO_BASE_URL\]/);
    // The rewriter appends the app-session flags to links whose origin is in
    // that set. Both halves of the guard matter: same-origin returns early, and
    // anything outside the set returns early.
    expect(src).toMatch(/if \(u\.origin === location\.origin \|\| !SISTER_ORIGINS\.has\(u\.origin\)\) return;/);
    expect(src).toMatch(/u\.searchParams\.set\('inapp', '1'\)/);
    expect(src).toMatch(/if \(inAppPro\(\)\) u\.searchParams\.set\('pro', '1'\)/);
  });

  /**
   * THE COUPLING IS ONE ENVIRONMENT VARIABLE DEEP. lib/tiers.ts reads
   * NEXT_PUBLIC_FREE_URL and NEXT_PUBLIC_PRO_URL independently, so the two
   * origins agreeing in source proves nothing about a company deploy. This
   * demonstrates the drift rather than asserting it away.
   */
  it('setting one of the two environment variables decouples them, and the app allowlist cannot follow', async () => {
    const { FREE_BASE_URL, PRO_BASE_URL } = await tiers({ NEXT_PUBLIC_PRO_URL: 'https://pro.incognitobrowser.io' });
    expect(new URL(FREE_BASE_URL).origin).not.toBe(new URL(PRO_BASE_URL).origin);
    // With two origins, SISTER_ORIGINS holds both and the rewriter's
    // same-origin short-circuit stops firing: every link from one site to the
    // other starts getting ?inapp=1&pro=1 appended inside the app. That is only
    // safe while BOTH origins are ours and BOTH are in the app's allowlist —
    // and the allowlist is a fixed list inside a shipped APK. This asserts the
    // hazard, not a hypothetical: one environment variable produces a Pro site
    // the installed app has no bridge on and no way to learn about.
    const listed = bridgeAllowlist();
    expect(listed).toContain(new URL(FREE_BASE_URL).origin);
    expect(
      listed,
      'if this ever contains the drifted origin, someone added it to the contract — check the app team shipped a release with BOTH origins',
    ).not.toContain(new URL(PRO_BASE_URL).origin);
  });

  it('the deploy builds both URLs from one origin variable', () => {
    // This is the only place the coupling is actually enforced.
    const deploy = read('scripts/deploy.sh');
    const free = /NEXT_PUBLIC_FREE_URL="?\$\{?([A-Z_]+)\}?/.exec(deploy);
    const pro = /NEXT_PUBLIC_PRO_URL="?\$\{?([A-Z_]+)\}?/.exec(deploy);
    expect(free, 'scripts/deploy.sh no longer sets NEXT_PUBLIC_FREE_URL from a variable').not.toBeNull();
    expect(pro, 'scripts/deploy.sh no longer sets NEXT_PUBLIC_PRO_URL from a variable').not.toBeNull();
    expect(pro![1], 'the two base URLs must come from the same origin variable').toBe(free![1]);
  });

  it('every origin in the bridge allowlist is either a tier origin or a declared cutover host', async () => {
    const { FREE_BASE_URL, PRO_BASE_URL } = await tiers({});
    const declared = JSON.parse(read('scripts/security/data/mast-bridge-hosts.json'))
      .extraOrigins.map((e: { origin: string }) => e.origin);
    const allowed = new Set([new URL(FREE_BASE_URL).origin, new URL(PRO_BASE_URL).origin, ...declared]);
    const origins = bridgeAllowlist();
    expect(origins.length).toBeGreaterThan(0);
    for (const o of origins) expect([...allowed], `${o} is in the app's bridge allowlist but is not a tier origin or a declared cutover host`).toContain(o);
    // Both halves of the pair are present, together.
    expect(origins).toContain(new URL(FREE_BASE_URL).origin);
    expect(origins).toContain(new URL(PRO_BASE_URL).origin);
  });
});

describe('a forged window.IncognitoBrowserApp — what the BRIDGE does with it', () => {
  // Scope note: whether a forged object unlocks anything paid is the
  // entitlement question and is not asked here. These assert only what this
  // file hands a page-set object, and what it refuses to do for one.
  let env: ReturnType<typeof setUp>;
  beforeEach(() => { env = setUp(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a forged object with no methods cannot make the page follow the custom scheme', () => {
    env.win.IncognitoBrowserApp = {};   // any page script can do this
    expect(openAppUpgrade({ from: 'result' })).toBe(false);
    // It is now treated as "in the app" for labelling…
    expect(env.root.getAttribute('data-inapp')).toBe('bridge');
    // …but the deep-link fallback is gated on the ?inapp=1 source, so nothing navigated.
    expect(env.loc.href).toBe(WEB_HREF);
  });

  it('a forged object that throws still cannot redirect the page anywhere but the app', () => {
    const boom = { postMessage() { throw new Error('nope'); } };
    env.win.IncognitoBrowserApp = boom;
    // Source "bridge" only: the throw is swallowed and no navigation follows.
    expect(openAppUpgrade({ from: 'result' })).toBe(false);
    expect(env.loc.href).toBe(WEB_HREF);
    // Source "param" (the app really did open this page): the fallback is the
    // app's own URL, built from the constant — never anything the object chose.
    env.root.setAttribute('data-inapp', 'param');
    expect(openAppUpgrade({ from: 'result' })).toBe(true);
    expect(env.loc.href).toBe('incognitobrowser://upgrade?from=result');
  });

  it('what a forged object receives is the documented handoff, and nothing more', () => {
    env.root.setAttribute('data-inapp', 'param');
    const bridge = recorder();
    env.win.IncognitoBrowserApp = bridge;
    openAppUpgrade({ from: 'result', topic: 'ad-tracking', result: 'amber', tool: 'ad-blocker-test', benefit: 'tracker-blocking' });
    // Exactly the IN-APP-BRIDGE.md §2 fields. Every one of them is already in
    // the DOM of the page the script is running on, so forging the object wins
    // nothing a same-origin script did not already have.
    expect(Object.keys(bridge.messages[0]).sort()).toEqual(['action', 'benefit', 'from', 'page', 'result', 'tool', 'topic', 'v']);
    expect(bridge.messages[0].page).toBe(PAGE);
  });

  it('a forged object does receive the scorecard bytes — the known, bounded exposure', async () => {
    // Recorded rather than treated as a defect: the same-origin script that
    // could set this global could also read the canvas itself. Listed as info
    // by pro_bridge_forged_app_object so it is on the record if the payload
    // ever grows beyond an image the page drew.
    env.root.setAttribute('data-inapp', 'param');
    const bridge = recorder();
    env.win.IncognitoBrowserApp = bridge;
    expect(await saveImageInApp(png(), 'scorecard.png')).toBe(true);
    expect(bridge.messages[0].base64).toBe('iVBORw==');
  });

  it('on the open web, with no forged object, the bridge does nothing at all', async () => {
    expect(openAppUpgrade({ from: 'result' })).toBe(false);
    expect(await saveImageInApp(png(), 'scorecard.png')).toBe(false);
    expect(env.loc.href).toBe(WEB_HREF);
    expect(env.root.hasAttribute('data-inapp')).toBe(false);
  });
});
