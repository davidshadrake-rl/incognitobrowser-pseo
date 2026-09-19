/**
 * Shared machinery for the MAST checks. Exports no check of its own — the
 * runner's `if (d && d.id)` filter drops the empty default export.
 *
 * WHY THERE IS A "MOBILE" DISCIPLINE AT ALL IN A STATIC-SITE REPO.
 * There is no APK here, no Android SDK on this machine, and nothing for MobSF
 * or apktool to open. What IS here is the *web half of a native trust
 * boundary*: the Incognito Browser Android app loads these pages in a WebView,
 * injects `window.IncognitoBrowserApp` into an origin allowlist it copies out
 * of IN-APP-BRIDGE.md, and that object exposes openUpgrade() and
 * saveImage(base64, filename, mime) — a page-controlled file written into the
 * user's storage. Every string that crosses that boundary is written here.
 * So the mobile checks grade the things this repo actually controls: which
 * origins the contract hands the app, and whether the inline boot script that
 * reads the app's flags still behaves the way the contract says it does.
 *
 * Two pieces live here because three checks need them:
 *
 *   1. extractBootScript() — pull the inline boot script out of a BUILT page.
 *      It has to work on the shipped artifact, which is SWC-minified
 *      (`(function(a){try{let b=a.document.documentElement,…`) and bears no
 *      resemblance to `bootInApp.toString()` as the test toolchain serialises
 *      it. Any check that byte-compares those two is permanently red, which is
 *      as corrosive as a check that is permanently green.
 *
 *   2. gradeBootBehaviour() — RUN the extracted script against a fake window
 *      and grade what it did. Behaviour, not bytes, for a second reason:
 *      IN_APP_BOOT_SCRIPT is `bootInApp.toString()`, so it bakes in whatever
 *      the compiler emitted. Under some toolchains that string references a
 *      bundler helper (esbuild's `__name`) that does not exist on the page.
 *      bootInApp's own try/catch would swallow the ReferenceError and the
 *      script would silently do nothing on every page of both sites. The
 *      existing guard in tests/in-app.test.ts greps the string for
 *      require/import/__vite/__webpack and misses `__name` entirely.
 *      Executing it catches every member of that family at once.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { finding } from '../lib/harness.mjs';

/**
 * The origins lib/tiers.ts actually serves the two sites from, derived rather
 * than hand-listed. A second hand-maintained copy of the host list is how
 * IN-APP-BRIDGE.md came to name two hosts that had already been removed from
 * the live CSP: moving hosts must not be able to leave a document behind.
 */
export function tierOrigins(repoRoot) {
  const src = readFileSync(join(repoRoot, 'lib', 'tiers.ts'), 'utf-8');
  const origins = new Set();
  for (const name of ['PRO_BASE_URL', 'FREE_BASE_URL']) {
    // The literal on the right of `||` is the default a build without the env
    // var uses, and it is the only value visible from a static read.
    const m = new RegExp(`${name}[^=]*=\\s*[\\s\\S]{0,200}?\\|\\|\\s*'([^']+)'`).exec(src);
    if (m) { try { origins.add(new URL(m[1]).origin); } catch { /* not a URL: another check's problem */ } }
  }
  return origins;
}

/**
 * Every inline <script> in a built page, in document order. Scripts with a
 * `src` are skipped: the boot script is inlined by app/layout.tsx precisely so
 * it runs before first paint, so a version of it in a chunk would itself be
 * the bug.
 */
function inlineScripts(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/**
 * The boot script as it shipped, or null.
 *
 * Matching on the string 'data-inapp' alone is not enough: Next's RSC flight
 * payload (`self.__next_f.push([1,"…"])`) also contains that text, and a
 * reviewer once mistook one for the other while verifying that the script
 * ships. The real one is an IIFE that calls history.replaceState.
 */
export function extractBootScript(html) {
  const candidates = inlineScripts(html).filter(
    (s) => s.includes('data-inapp') && s.includes('replaceState') && /^\s*[(!]/.test(s),
  );
  return candidates.length ? candidates[0].trim() : null;
}

/**
 * Run a boot script in a fake tab and report what it did to <html>, to the
 * address bar and to session storage.
 *
 * node:vm, not `new Function`: for the live probe this is a script fetched
 * over the network, and a plain eval would hand it this process's `process`,
 * `fetch` and module loader. A vm context is not a hard sandbox and is not
 * claimed to be one, but it removes the casual reach, and the context we build
 * contains nothing but the fake window.
 */
export function runBootScript(src, { href, ua, bridge, timers = false } = {}) {
  const attrs = new Map();
  const store = new Map();
  const replaceStateCalls = [];
  const CHROME_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
  const w = {
    document: {
      documentElement: {
        setAttribute: (k, v) => attrs.set(k, v),
        removeAttribute: (k) => attrs.delete(k),
        getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
        hasAttribute: (k) => attrs.has(k),
      },
    },
    location: { href },
    sessionStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    },
    IncognitoBrowserApp: bridge,
    navigator: { userAgent: ua || CHROME_UA },
    history: {
      state: null,
      replaceState: (_s, _t, url) => { replaceStateCalls.push(url); w.location.href = new URL(url, href).href; },
    },
    // Opt-in, so the retry loop bootInApp starts for a late-injecting app build
    // does not leave a timer chain running behind a check.
    setTimeout: timers ? ((fn, ms) => setTimeout(fn, ms)) : undefined,
  };
  // A fresh context has the ECMAScript intrinsics and nothing else. URL is a
  // Node global rather than an intrinsic, and the boot script's first line
  // needs it, so it is handed over explicitly — along with nothing else.
  const ctx = createContext({ window: w, URL });
  let error = null;
  try {
    runInContext(`(function(window){${src}\n})(window)`, ctx, { timeout: 2000, filename: 'boot-script' });
  } catch (err) {
    error = String((err && err.message) || err);
  }
  return {
    error,
    attr: (k) => (attrs.has(k) ? attrs.get(k) : null),
    has: (k) => attrs.has(k),
    href: w.location.href,
    replaceStateCalls,
    storage: store,
  };
}

/**
 * Grade one shipped boot script against the four promises IN-APP-BRIDGE.md
 * makes to the app team and to visitors. Returns { findings, checked }.
 *
 * `where` is the artifact or URL the script came from; it goes into every
 * piece of evidence so a finding can be re-checked by hand with curl.
 */
export function gradeBootBehaviour(src, where, { file = null } = {}) {
  const findings = [];
  let checked = 0;

  // 1. It runs at all. A bundler helper reference (esbuild's `__name`) or a
  //    truncated inline script lands here, and nowhere else: bootInApp's own
  //    catch-all turns an internal throw into silence, so the only way to see
  //    it is to look at what the script DID.
  checked++;
  const plain = runBootScript(src, { href: 'https://check.invalid/resources/tools/x/y/?inapp=1&pro=1&utm_source=x#r' });
  if (plain.error) {
    findings.push(finding({
      severity: 'medium', file,
      title: `The shipped in-app boot script throws before it does anything (${where})`,
      detail: 'The script is inlined at the top of <body> and its body is wrapped in try/catch, so a throw at parse time or a reference to a bundler helper that does not exist on the page produces no console error and no visible symptom — the page simply never learns it is inside the app, and never strips the flags from the address bar.',
      evidence: `${where}: executing the extracted inline script threw ${plain.error}`,
      remediation: 'Check what the compiler emitted for IN_APP_BOOT_SCRIPT (lib/in-app.ts) — bootInApp must stay self-contained, with no syntax the toolchain turns into a helper call.',
    }));
    return { findings, checked };
  }

  // 2. ?inapp=1 marks the page. Without it the in-app labels never swap and
  //    the scorecard falls back to the blob: download the app's download
  //    manager rejects outright ("Invalid URL: blob", IN-APP-BRIDGE.md §3).
  checked++;
  if (plain.attr('data-inapp') !== 'param') {
    findings.push(finding({
      severity: 'medium', file,
      title: `The shipped boot script does not mark a page opened with ?inapp=1 (${where})`,
      detail: 'app/globals.css swaps every in-app label on <html data-inapp>, and components/Scorecard.tsx offers "Save image" on it. Unmarked, an app user sees "Get the Android app" and a download that fails.',
      evidence: `${where}: after ?inapp=1&pro=1&utm_source=x, <html data-inapp> = ${JSON.stringify(plain.attr('data-inapp'))}`,
      remediation: 'Rebuild and redeploy; if a fresh build still does this, the fault is in bootInApp (lib/in-app.ts).',
    }));
  }

  // 3. The flags leave the address bar, and nothing else does. This is the
  //    security half: the app appends ?inapp=1&pro=1, and every link a user
  //    copies or shares out of the app carries whatever is still there.
  checked++;
  const stripped = plain.href;
  if (!plain.replaceStateCalls.length || /[?&](inapp|pro)=/.test(stripped)) {
    findings.push(finding({
      severity: 'medium', file,
      title: `The shipped boot script leaves the app's flags in the address bar (${where})`,
      detail: 'Every link copied or shared out of the app then carries ?inapp=1&pro=1. Whoever receives it gets the in-app labelling on the open web, and — on any build where pro=1 alone is acted on — the upgrade asks hidden and the Pro tool gates open for the rest of their tab.',
      evidence: `${where}: after ?inapp=1&pro=1&utm_source=x the URL is ${stripped} (replaceState called ${plain.replaceStateCalls.length} time(s))`,
      remediation: 'lib/in-app.ts deletes both parameters and calls history.replaceState; confirm the built artifact carries that branch.',
    }));
  } else if (!/utm_source=x/.test(stripped)) {
    findings.push(finding({
      severity: 'low', file,
      title: `The shipped boot script strips more than the app's flags (${where})`,
      detail: 'It removes inapp and pro only. Dropping the rest of the query string silently breaks campaign attribution and any tool page that reads its own parameters.',
      evidence: `${where}: after ?inapp=1&pro=1&utm_source=x the URL is ${stripped} — utm_source is gone`,
      remediation: 'Delete the two keys from the URLSearchParams and re-serialise the rest (lib/in-app.ts).',
    }));
  }

  // 4. `pro=1` on its own grants nothing. Anyone can type it into a link, and
  //    <html data-ib-pro> hides every upgrade band (app/globals.css:173) and
  //    opens all three Pro tool gates (components/useUpgradeGate.tsx). Until
  //    2026-09-18 the parameter alone was enough, so one shared link switched
  //    the funnel off — and the gates on — for whoever clicked it, on the open
  //    web, nowhere near the app. lib/in-app.ts now requires the app's own
  //    bridge object or a user agent that names it. This asserts the shipped
  //    artifact agrees; the source is graded by pentest-gate-inventory.
  checked++;
  if (plain.has('data-ib-pro')) {
    findings.push(finding({
      severity: 'medium', file,
      title: `The shipped boot script acts on ?pro=1 from a bare URL (${where})`,
      detail: 'A plain Chrome user agent and no bridge object: this window is not the app by any measure, and the page still marked the visitor as a Pro subscriber. Any link with ?inapp=1&pro=1 hides every upgrade ask and opens the three Pro tool gates for the rest of that tab. IN-APP-BRIDGE.md:26 and lib/in-app.ts:21 both state the opposite rule.',
      evidence: `${where}: ?inapp=1&pro=1 with userAgent "Chrome/128.0 Mobile Safari" and no window.IncognitoBrowserApp set <html data-ib-pro>`,
      remediation: 'This build predates the confirmation guard in lib/in-app.ts (`if (source && pro && (bridged || named))`). Rebuild and redeploy both sites.',
    }));
  }

  // 5. …and the guard did not overcorrect. A real subscriber, in the app, with
  //    the bridge present, must still get the quiet page they paid for.
  checked++;
  const bridged = runBootScript(src, {
    href: 'https://check.invalid/resources/tools/x/y/?inapp=1&pro=1',
    bridge: { postMessage() {} },
  });
  if (!bridged.error && !bridged.has('data-ib-pro')) {
    findings.push(finding({
      severity: 'low', file,
      title: `The shipped boot script ignores ?pro=1 even with the app's bridge present (${where})`,
      detail: 'A confirmed Pro subscriber inside the app is shown upgrade asks for something they already bought, on every page. Not a vulnerability — the opposite one — but it is the failure mode of over-tightening the guard, and it should not be found by a subscriber.',
      evidence: `${where}: ?inapp=1&pro=1 with window.IncognitoBrowserApp = {postMessage} did not set <html data-ib-pro>`,
      remediation: 'Compare the built script with bootInApp in lib/in-app.ts; the bridge branch is what confirms the app\'s claim.',
    }));
  }

  return { findings, checked };
}
