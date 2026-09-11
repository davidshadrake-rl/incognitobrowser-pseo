/**
 * Pages open inside the Incognito Browser Android app.
 *
 * The app spoofs its WebView's user agent (it's a privacy browser), so the
 * user agent can't be relied on to say where a page is open. The app says so
 * itself: it opens our pages with `?inapp=1`, plus `&pro=1` when the user
 * already has Incognito Pro. bootInApp runs inline at the top of <body>
 * (app/layout.tsx), before the header paints. It keeps the flags in
 * sessionStorage for the rest of the tab, takes them out of the address bar
 * so a link the visitor copies or shares never carries them, and marks <html>:
 *
 *   data-inapp="param"  the app sent ?inapp=1, so it has agreed to handle the
 *                       upgrade and save-image bridge (IN-APP-BRIDGE.md)
 *   data-inapp="ua"     only the user agent names the app: labels change,
 *                       upgrade links stay ordinary Play links
 *   data-ib-pro         the app says this user already has Pro, so upgrade
 *                       asks are hidden. Copy only, never access.
 *
 * app/globals.css swaps labels on those attributes (.ib-web-only,
 * .ib-app-only, .ib-upgrade). components/InAppBridge.tsx hands upgrade clicks
 * to the app, and components/Scorecard.tsx hands it the scorecard image.
 */

export type InAppSource = 'param' | 'ua';

/** Where the app's own upgrade screen opens when it has no JavaScript bridge. */
export const APP_UPGRADE_URL = 'incognitobrowser://upgrade';

/**
 * Serialised into the inline boot script with toString(), so it must stay
 * self-contained: no imports, no outer constants, no syntax a compiler would
 * turn into a helper call (spread, optional chaining, async).
 * tests/in-app.test.ts runs the serialised script, not this function.
 */
export function bootInApp(w: Window): void {
  try {
    const root = w.document.documentElement;
    const url = new URL(w.location.href);
    const q = url.searchParams;
    const yes = (v: string | null) => v === '1' || v === 'true';
    let store: Storage | null = null;
    try { store = w.sessionStorage; } catch { store = null; }
    const get = (k: string) => { try { return store ? store.getItem(k) : null; } catch { return null; } };
    const put = (k: string, on: boolean) => {
      try { if (store) { if (on) store.setItem(k, '1'); else store.removeItem(k); } } catch { /* storage blocked */ }
    };
    let fromApp = get('ib-inapp') === '1';
    let pro = get('ib-pro') === '1';
    if (q.has('inapp')) { fromApp = yes(q.get('inapp')); put('ib-inapp', fromApp); }
    if (q.has('pro')) { pro = yes(q.get('pro')); put('ib-pro', pro); }
    const source = fromApp ? 'param' : /incognito ?browser/i.test(w.navigator.userAgent) ? 'ua' : '';
    if (source) root.setAttribute('data-inapp', source); else root.removeAttribute('data-inapp');
    if (source && pro) root.setAttribute('data-ib-pro', ''); else root.removeAttribute('data-ib-pro');
    if (q.has('inapp') || q.has('pro')) {
      q.delete('inapp');
      q.delete('pro');
      const rest = q.toString();
      w.history.replaceState(w.history.state, '', url.pathname + (rest ? '?' + rest : '') + url.hash);
    }
  } catch {
    /* never affect the page */
  }
}

export const IN_APP_BOOT_SCRIPT = `(${bootInApp.toString()})(window);`;

/** How this page knows it is in the app, or null on the open web (and on the server). */
export function inAppSource(): InAppSource | null {
  if (typeof document === 'undefined') return null;
  const v = document.documentElement.getAttribute('data-inapp');
  return v === 'param' || v === 'ua' ? v : null;
}

/** The app says this user already has Incognito Pro. */
export function inAppPro(): boolean {
  return typeof document !== 'undefined' && document.documentElement.hasAttribute('data-ib-pro');
}

/** What the page tells the app about the upgrade tap: the funnel's handoff fields. */
export interface UpgradeContext {
  /** Where the tap came from: result, header, home, footer… */
  from: string;
  /** The topic (niche slug) the page is about. */
  topic?: string;
  /** The visitor's result severity when the tap follows a check: red | amber | green | info. */
  result?: string;
  /** The tool (engine id) that produced the result. */
  tool?: string;
}

/**
 * The object the app puts on our pages. Preferred: androidx.webkit
 * addWebMessageListener, which injects `postMessage` into our origins only.
 * Also accepted: addJavascriptInterface methods of the same names.
 */
interface AppBridge {
  postMessage?: (message: string) => void;
  openUpgrade?: (json: string) => void;
  saveImage?: (base64: string, filename: string, mime: string) => void;
}

function appBridge(): AppBridge | null {
  if (typeof window === 'undefined') return null;
  const b = (window as unknown as { IncognitoBrowserApp?: AppBridge }).IncognitoBrowserApp;
  return b && typeof b === 'object' ? b : null;
}

/** The fallback URL for app versions without the JavaScript bridge. */
export function appUpgradeUrl(ctx: UpgradeContext): string {
  const q = new URLSearchParams();
  for (const k of ['from', 'topic', 'result', 'tool'] as const) {
    const v = ctx[k];
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return s ? `${APP_UPGRADE_URL}?${s}` : APP_UPGRADE_URL;
}

/**
 * Hand an upgrade tap to the app's own upgrade screen. Returns false when the
 * app can't take it here (the open web, or an app build that only matched on
 * user agent and never agreed to the bridge), so the caller keeps its link.
 */
export function openAppUpgrade(ctx: UpgradeContext): boolean {
  const source = inAppSource();
  if (!source) return false;
  const b = appBridge();
  const page = typeof location !== 'undefined' ? location.pathname : '';
  try {
    if (b && typeof b.postMessage === 'function') {
      b.postMessage(JSON.stringify({ v: 1, action: 'upgrade', page, ...ctx }));
      return true;
    }
    if (b && typeof b.openUpgrade === 'function') {
      b.openUpgrade(JSON.stringify({ v: 1, page, ...ctx }));
      return true;
    }
  } catch {
    /* fall through to the URL */
  }
  if (source === 'param') {
    window.location.href = appUpgradeUrl(ctx);
    return true;
  }
  return false;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** A data: URL for an image the page shows so it can be pressed and held (or screenshotted). */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/**
 * Hand an image to the app to save. The app's download manager takes http(s)
 * links only, so the `blob:` link a normal download uses fails there
 * ("Invalid URL: blob"). Returns false when the app has no bridge for it.
 */
export async function saveImageInApp(blob: Blob, filename: string): Promise<boolean> {
  if (!inAppSource()) return false;
  const b = appBridge();
  if (!b || (typeof b.postMessage !== 'function' && typeof b.saveImage !== 'function')) return false;
  const mime = blob.type || 'image/png';
  try {
    const base64 = await blobToBase64(blob);
    if (typeof b.postMessage === 'function') b.postMessage(JSON.stringify({ v: 1, action: 'saveImage', filename, mime, base64 }));
    else b.saveImage!(base64, filename, mime);
    return true;
  } catch {
    return false;
  }
}
