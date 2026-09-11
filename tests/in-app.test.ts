/**
 * Inside the Incognito Browser app (lib/in-app.ts, IN-APP-BRIDGE.md).
 *
 * The app spoofs its user agent, so it says it is the app with ?inapp=1.
 * These run the boot script as it ships (the serialised string, not the
 * function), then the upgrade and save-image handoffs against a fake bridge.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { appUpgradeUrl, IN_APP_BOOT_SCRIPT, openAppUpgrade, saveImageInApp } from '@/lib/in-app';

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

/** Load a page at `href` in a fake tab and run the boot script. */
function boot(href: string, opts: { storage?: FakeStorage; ua?: string } = {}) {
  const root = new FakeElement();
  const storage = opts.storage ?? new FakeStorage();
  const w = {
    document: { documentElement: root },
    location: { href },
    sessionStorage: storage,
    navigator: { userAgent: opts.ua ?? CHROME_UA },
    history: { state: null, replaceState: vi.fn((_s: unknown, _t: string, url: string) => { w.location.href = new URL(url, href).href; }) },
  };
  new Function('window', IN_APP_BOOT_SCRIPT)(w);
  return { root, storage, w };
}

describe('the boot script: ?inapp=1 marks the page and the tab', () => {
  it('?inapp=1 marks <html>, remembers it for the tab, and leaves the address bar clean', () => {
    const { root, storage, w } = boot('https://example.test/resources/tools/x/y/?inapp=1&utm_source=a#r');
    expect(root.getAttribute('data-inapp')).toBe('param');
    expect(storage.getItem('ib-inapp')).toBe('1');
    // A link the visitor copies or shares must not carry the flag into another browser.
    expect(w.history.replaceState).toHaveBeenCalledOnce();
    expect(w.location.href).toBe('https://example.test/resources/tools/x/y/?utm_source=a#r');
  });

  it('accepts inapp=true too (the spelling first suggested)', () => {
    expect(boot('https://example.test/?inapp=true').root.getAttribute('data-inapp')).toBe('param');
  });

  it('the next page in the same tab needs no parameter', () => {
    const first = boot('https://example.test/?inapp=1&pro=1');
    const next = boot('https://example.test/guides/', { storage: first.storage });
    expect(next.root.getAttribute('data-inapp')).toBe('param');
    expect(next.root.hasAttribute('data-ib-pro')).toBe(true);
    expect(next.w.history.replaceState).not.toHaveBeenCalled();
  });

  it('inapp=0 turns it off again', () => {
    const first = boot('https://example.test/?inapp=1');
    expect(boot('https://example.test/?inapp=0', { storage: first.storage }).root.hasAttribute('data-inapp')).toBe(false);
    expect(first.storage.getItem('ib-inapp')).toBeNull();
  });

  it('a user agent naming the app still counts, as "ua"', () => {
    const { root } = boot('https://example.test/', { ua: `${CHROME_UA} IncognitoBrowser/5.2` });
    expect(root.getAttribute('data-inapp')).toBe('ua');
  });

  it('pro=1 means nothing on the open web', () => {
    expect(boot('https://example.test/?pro=1').root.hasAttribute('data-ib-pro')).toBe(false);
  });

  it('an ordinary visit is left alone', () => {
    const { root, w } = boot('https://example.test/tools/?utm_source=x');
    expect(root.hasAttribute('data-inapp')).toBe(false);
    expect(w.history.replaceState).not.toHaveBeenCalled();
  });

  it('the layout injects nothing but this static script', () => {
    // The one dangerouslySetInnerHTML in the layout: no props or request data reach it.
    const src = fs.readFileSync(path.join(process.cwd(), 'app', 'layout.tsx'), 'utf-8');
    expect(src.match(/dangerouslySetInnerHTML=\{\{[^}]*\}\}/g)).toEqual(['dangerouslySetInnerHTML={{ __html: IN_APP_BOOT_SCRIPT }}']);
    // Serialised with toString(): it must not lean on a module import or a compiler helper.
    expect(IN_APP_BOOT_SCRIPT).not.toMatch(/\brequire\(|\bimport\b|_object_spread|__vite|__webpack/);
  });

  it('blocked storage still marks this page', () => {
    const root = new FakeElement();
    const w = {
      document: { documentElement: root },
      location: { href: 'https://example.test/?inapp=1' },
      get sessionStorage(): Storage { throw new Error('SecurityError'); },
      navigator: { userAgent: CHROME_UA },
      history: { state: null, replaceState: () => {} },
    };
    new Function('window', IN_APP_BOOT_SCRIPT)(w);
    expect(root.getAttribute('data-inapp')).toBe('param');
  });
});

describe('the upgrade handoff', () => {
  const root = new FakeElement();
  const loc = { href: 'https://example.test/tools/ad-tracking/ad-blocker-test/', pathname: '/tools/ad-tracking/ad-blocker-test/' };
  const win: Record<string, unknown> = { location: loc };
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('window', win);
    vi.stubGlobal('location', loc);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    root.attrs.clear();
    delete win.IncognitoBrowserApp;
    loc.href = 'https://example.test/tools/ad-tracking/ad-blocker-test/';
  });
  const ctx = { from: 'result', topic: 'ad-tracking', result: 'amber', tool: 'ad-blocker-test' };

  it('on the open web, the page keeps its ordinary Play link', () => {
    expect(openAppUpgrade(ctx)).toBe(false);
  });

  it('with the message bridge, the app gets the result context as JSON', () => {
    root.setAttribute('data-inapp', 'param');
    const postMessage = vi.fn();
    win.IncognitoBrowserApp = { postMessage };
    expect(openAppUpgrade(ctx)).toBe(true);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({
      v: 1, action: 'upgrade', page: '/tools/ad-tracking/ad-blocker-test/',
      from: 'result', topic: 'ad-tracking', result: 'amber', tool: 'ad-blocker-test',
    });
  });

  it('with a JavaScript-interface bridge, openUpgrade gets the same context', () => {
    root.setAttribute('data-inapp', 'param');
    const openUpgrade = vi.fn();
    win.IncognitoBrowserApp = { openUpgrade };
    expect(openAppUpgrade(ctx)).toBe(true);
    expect(JSON.parse(openUpgrade.mock.calls[0][0])).toMatchObject({ v: 1, from: 'result', result: 'amber' });
  });

  it('an app that sent ?inapp=1 but has no bridge gets the upgrade URL', () => {
    root.setAttribute('data-inapp', 'param');
    expect(openAppUpgrade(ctx)).toBe(true);
    expect(loc.href).toBe('incognitobrowser://upgrade?from=result&topic=ad-tracking&result=amber&tool=ad-blocker-test');
  });

  it('matched on user agent only, with no bridge: no URL the app never agreed to handle', () => {
    root.setAttribute('data-inapp', 'ua');
    expect(openAppUpgrade(ctx)).toBe(false);
    expect(loc.href).toMatch(/^https:/);
  });

  it('the upgrade URL leaves out what the tap does not know', () => {
    expect(appUpgradeUrl({ from: 'header' })).toBe('incognitobrowser://upgrade?from=header');
  });
});

describe('saving the scorecard inside the app', () => {
  const root = new FakeElement();
  const win: Record<string, unknown> = {};
  beforeEach(() => {
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('window', win);
    // Node has Blob but no FileReader.
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
  });
  afterEach(() => { vi.unstubAllGlobals(); root.attrs.clear(); delete win.IncognitoBrowserApp; });
  const png = new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' });

  it('hands the image to the app as base64, since its downloads refuse blob: links', async () => {
    root.setAttribute('data-inapp', 'param');
    const postMessage = vi.fn();
    win.IncognitoBrowserApp = { postMessage };
    expect(await saveImageInApp(png, 'scorecard.png')).toBe(true);
    expect(JSON.parse(postMessage.mock.calls[0][0])).toEqual({ v: 1, action: 'saveImage', filename: 'scorecard.png', mime: 'image/png', base64: 'iVBORw==' });
  });

  it('with saveImage on a JavaScript interface', async () => {
    root.setAttribute('data-inapp', 'param');
    const saveImage = vi.fn();
    win.IncognitoBrowserApp = { saveImage };
    expect(await saveImageInApp(png, 'scorecard.png')).toBe(true);
    expect(saveImage).toHaveBeenCalledWith('iVBORw==', 'scorecard.png', 'image/png');
  });

  it('with no bridge, reports false so the page shows the image to press and hold', async () => {
    root.setAttribute('data-inapp', 'param');
    expect(await saveImageInApp(png, 'scorecard.png')).toBe(false);
  });
});
