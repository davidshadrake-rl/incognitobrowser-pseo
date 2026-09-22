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
 *   data-inapp="bridge" no parameter, but the app put its JavaScript bridge on
 *                       the page, which only its own WebView can do: as good
 *                       as the parameter, and it survives a link opened from
 *                       outside the app's own tiles
 *   data-inapp="ua"     only the user agent names the app: labels change,
 *                       upgrade links stay ordinary Play links
 *   data-ib-pro         the app says this user already has Pro, so upgrade
 *                       asks are hidden. Copy only, never access.
 *
 * data-ib-pro is the one mark a URL alone cannot set. `?inapp=1&pro=1` used to
 * be enough, and because app/globals.css hides every `.ib-upgrade` band on it
 * and components/useUpgradeGate.tsx skips all three gates on it, any link with
 * those two parameters switched the whole upgrade funnel off for the rest of
 * that tab — a shared or crafted link was a self-inflicted funnel outage, on
 * the open web, where nobody is in the app at all. The claim is still read
 * from the URL and kept for the tab, but it is only acted on once something
 * the app alone can produce agrees: its bridge object, which its WebView puts
 * on our origins only, or a user agent that names it. Nothing paid is behind
 * these gates, so this is about not trusting a query parameter for something
 * security-shaped, and about keeping the funnel up.
 *
 * app/globals.css swaps labels on those attributes (.ib-web-only,
 * .ib-app-only, .ib-upgrade). components/InAppBridge.tsx hands upgrade clicks
 * to the app, and components/Scorecard.tsx hands it the scorecard image.
 */

export type InAppSource = 'param' | 'bridge' | 'ua';

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
    const onBridge = () => {
      const b = (w as unknown as { IncognitoBrowserApp?: unknown }).IncognitoBrowserApp;
      return typeof b === 'object' && b !== null;
    };
    let fromApp = get('ib-inapp') === '1';
    let pro = get('ib-pro') === '1';
    if (q.has('inapp')) { fromApp = yes(q.get('inapp')); put('ib-inapp', fromApp); }
    if (q.has('pro')) { pro = yes(q.get('pro')); put('ib-pro', pro); }
    const bridged = onBridge();
    const named = /incognito ?browser/i.test(w.navigator.userAgent);
    const source = fromApp ? 'param' : bridged ? 'bridge' : named ? 'ua' : '';
    if (source) root.setAttribute('data-inapp', source); else root.removeAttribute('data-inapp');
    // The app alone can put its bridge on our origins, and a link cannot
    // choose the user agent either. `?pro=1` is text in a URL, so on its own
    // it now marks nothing: without this, one shared link hid every upgrade
    // ask and opened all three gates for the whole tab on the open web.
    if (source && pro && (bridged || named)) root.setAttribute('data-ib-pro', ''); else root.removeAttribute('data-ib-pro');
    if (q.has('inapp') || q.has('pro')) {
      q.delete('inapp');
      q.delete('pro');
      const rest = q.toString();
      w.history.replaceState(w.history.state, '', url.pathname + (rest ? '?' + rest : '') + url.hash);
    }
    // An app build that injects its bridge after this script runs is the one
    // case where `?inapp=1` really is all we have (IN-APP-BRIDGE.md, section
    // 1). Look again for a second, so a subscriber on such a build does not
    // sit reading a page of upgrade asks for something they already bought.
    // Outside the app nothing ever appears, so this grace costs nothing.
    if (pro && fromApp && !bridged && !named && typeof w.setTimeout === 'function') {
      let tries = 0;
      const again = () => {
        if (onBridge()) { root.setAttribute('data-ib-pro', ''); return; }
        tries = tries + 1;
        if (tries < 10) w.setTimeout(again, 100);
      };
      w.setTimeout(again, 100);
    }
  } catch {
    /* never affect the page */
  }
}

export const IN_APP_BOOT_SCRIPT = `(${bootInApp.toString()})(window);`;

/**
 * The app's `pro=1` claim, kept for the tab by the boot script, applied only
 * now that the bridge has confirmed we really are in the app. This is where a
 * build that injects its bridge late catches up if the boot script's own
 * one-second grace already gave up.
 */
function confirmStoredPro(): void {
  const root = document.documentElement;
  if (root.hasAttribute('data-ib-pro')) return;
  try {
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem('ib-pro') === '1') {
      root.setAttribute('data-ib-pro', '');
    }
  } catch {
    /* storage blocked */
  }
}

/**
 * How this page knows it is in the app, or null on the open web (and on the
 * server). The boot script settles it before the first paint; this also
 * catches a bridge injected after that (androidx.webkit adds its object when
 * a document is created, but an older app build may inject later), and marks
 * <html> so the label CSS follows. Finding the bridge is also what confirms
 * the app's `pro=1`: the boot script keeps that claim but does not act on it
 * while nothing but a URL parameter vouches for it.
 */
export function inAppSource(): InAppSource | null {
  if (typeof document === 'undefined') return null;
  const v = document.documentElement.getAttribute('data-inapp');
  if (appBridge()) {
    confirmStoredPro();
    if (v === 'param') return 'param';
    document.documentElement.setAttribute('data-inapp', 'bridge');
    return 'bridge';
  }
  if (v === 'param' || v === 'bridge' || v === 'ua') return v;
  return null;
}

/**
 * The app says this user already has Incognito Pro, and the app itself has
 * been confirmed — the boot script only marks <html data-ib-pro> when the
 * bridge or the user agent backs the claim up, never on `?pro=1` alone.
 */
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
  /** The Pro benefit the page offered: tracker-blocking | hides-ad-boxes | photo-cleaning. For the upgrade screen's words only, never access. */
  benefit?: string;
}

/** The only benefit values passed on (lib/card-copy.ts Benefit). */
export const UPGRADE_BENEFITS = new Set(['tracker-blocking', 'hides-ad-boxes', 'photo-cleaning']);

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
  for (const k of ['from', 'topic', 'result', 'tool', 'benefit'] as const) {
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
  // Only an app build that sent ?inapp=1 has agreed to handle this URL. A
  // build detected by its bridge would have taken one of the calls above; one
  // detected by user agent alone keeps its ordinary Play link.
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

/** The only things the bridge will ask the app to write. */
const ALLOWED_IMAGE_MIME: Record<string, RegExp> = {
  'image/png': /\.png$/i,
  'image/jpeg': /\.jpe?g$/i,
  'image/webp': /\.webp$/i,
};

/**
 * The filename the app is allowed to receive, or null to refuse.
 *
 * Everything past the bridge is a MediaStore write by native code, and until
 * 2026-09-22 both values crossed unchecked: a traversal path as the name, and
 * whatever type the Blob carried — a text/html Blob crossed as text/html — as
 * the MIME. tests/pro-bridge.test.ts pinned that as the current behaviour so
 * it could not be forgotten; those tests are refusals now.
 *
 * Refuse, never repair. A name that had to be rewritten to be safe was not
 * produced by the one caller this module has (components/Scorecard.tsx, held
 * to that by mast-save-image-caller-allowlist), so it came from somewhere
 * that should not be handing names to the app at all.
 */
export function safeImageFilename(filename: string, mime: string): string | null {
  const ext = ALLOWED_IMAGE_MIME[mime];
  if (!ext) return null;
  const base = filename.split(/[\\/]/).pop() ?? '';
  if (!base || base.length > 120) return null;
  if (base.includes('..') || base.startsWith('.')) return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(base)) return null;
  if (!ext.test(base)) return null;
  return base;
}

/**
 * Hand an image to the app to save. The app's download manager takes http(s)
 * links only, so the `blob:` link a normal download uses fails there
 * ("Invalid URL: blob"). Returns false when the app has no bridge for it, and
 * false — sending nothing — when either value fails safeImageFilename().
 */
export async function saveImageInApp(blob: Blob, filename: string): Promise<boolean> {
  if (!inAppSource()) return false;
  const b = appBridge();
  if (!b || (typeof b.postMessage !== 'function' && typeof b.saveImage !== 'function')) return false;
  const mime = blob.type || 'image/png';
  const name = safeImageFilename(filename, mime);
  if (!name) return false;
  try {
    const base64 = await blobToBase64(blob);
    if (typeof b.postMessage === 'function') b.postMessage(JSON.stringify({ v: 1, action: 'saveImage', filename: name, mime, base64 }));
    else b.saveImage!(base64, name, mime);
    return true;
  } catch {
    return false;
  }
}
