/**
 * The Pro-paywall audit's own FRAMING lines, checked against the repo.
 *
 * This file guards nothing the product does at runtime. It guards the
 * sentences an audit uses to say WHAT IT LOOKED AT — the page enumerations and
 * the trigger condition for the Pro mark. Those sentences are what a scoping
 * decision is later taken from: what to put behind SSO, what to block at a
 * company edge, which pages to re-test after a change. A gating finding that
 * is exactly right about the mechanism and one page short about the blast
 * radius is worse than no finding, because it reads as complete.
 *
 * Four of the five framing lines were short or loose, and each one is pinned
 * below by the fact that refutes it:
 *
 *   F2  "cookie-analyzer lives on cookie-tracker-scanner plus cookie-management
 *        / GDPR / CCPA" — four pages named, FIVE exist. Also: the gated Export
 *        CSV button lives only in the URL-scan branch, so "This Page" and
 *        "Paste" have no gated action at all.
 *   F3  "/resources-pro/tools/[*]/browser-privacy-audit/" — that slug covers 5
 *        of the ELEVEN pages running the identical engine.
 *   F4  "/resources-pro/tools/[*]/image-metadata-checker/" — 2 of THREE; and
 *        "gated" overstates a guard whose payload WAS the empty arrow
 *        `() => {}`. Fixed 2026-09-22: everyone who picks several photos now
 *        gets an inline notice, a visitor without Pro gets the overlay on top,
 *        and still nothing is withheld — file one is read either way.
 *   F8  "?inapp=1&pro=1 plus bridge or UA" — `?inapp=1` is not required, and
 *        neither parameter need be on the current URL at all.
 *
 * Three house rules this file follows on purpose:
 *
 *  1. Nothing here is derived from a generator or a fixture. The page lists
 *     are typed out as literals and compared against data/tools/[**].json read
 *     straight off disk with fs. A fixture comparison in this repo once passed
 *     unconditionally because importing the module regenerated the fixture it
 *     was being compared to; e2e/fixtures/tool-pages.json is the generated
 *     copy of this same fact and is deliberately NOT what these assertions
 *     read. When a skin is added, the literal below must be edited by hand —
 *     that edit is the point, because the audit prose has to be edited with it.
 *
 *  2. Every assertion on source text runs on a COMMENT-STRIPPED copy. A guard
 *     that matched its own explanatory comment has shipped twice here: the
 *     comment above a control says what the control does, so a regex over raw
 *     source passes just as happily when the code underneath is gone.
 *
 *  3. The fake window's setTimeout is real and driven by hand. The first
 *     version of boot() passed `setTimeout: undefined`, and lib/in-app.ts
 *     gates its late-bridge grace loop on `typeof w.setTimeout ===
 *     'function'`, so the one branch that can set the Pro mark AFTER load
 *     never ran in any test here. The F8 negative control — a crafted
 *     `?inapp=1&pro=1` link in an ordinary browser marks nothing — was blind
 *     to that branch: the verifier (2026-09-22) replaced the loop body with
 *     an unconditional setAttribute and all twenty tests stayed green. The
 *     control now drives the loop to exhaustion and looks again.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IN_APP_BOOT_SCRIPT } from '@/lib/in-app';
import { PRO_ENGINES, tierOfEngine } from '@/lib/tiers';
import { GATE_COPY } from '@/lib/card-copy';

const ROOT = join(__dirname, '..');
const raw = (p: string) => readFileSync(join(ROOT, p), 'utf-8');

/**
 * Strip comments, leaving string and regex literals intact.
 *
 * A naive /\/\/.*$/ eats the `//` in a URL inside a string, and a naive block
 * strip eats half of `/^data:[^,]*,/`. Both of those failures make a test go
 * GREEN (less text to contradict the pattern), which is the direction that
 * matters. So this is a small scanner that knows the three literal forms it
 * has to walk past: quotes, template literals and regexes.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  // A `/` starts a regex only where a value is expected; after an identifier,
  // a `)` or a number it is division. This is the usual heuristic and it is
  // enough for the four files below.
  const regexAllowedAfter = /[(,=:[!&|?{};+\-*%~^<>\n]\s*$/;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      out += c;
      i++;
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        i++;
      }
      out += src[i] ?? '';
      i++;
      continue;
    }
    if (c === '/' && regexAllowedAfter.test(out)) {
      out += c;
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        else if (src[i] === '/' && !inClass) break;
        else if (src[i] === '\n') break;
        out += src[i];
        i++;
      }
      out += src[i] ?? '';
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const code = (p: string) => stripComments(raw(p));

describe('stripComments: the helper the rest of this file leans on', () => {
  // Written before it is used, because a stripper that over-strips makes every
  // assertion below pass for the wrong reason.
  it('removes comments and keeps strings, URLs and regex literals', () => {
    expect(stripComments('const a = 1; // gone\nconst b = 2;')).toBe('const a = 1; \nconst b = 2;');
    expect(stripComments('/* gone */const a = 1;')).toBe('const a = 1;');
    expect(stripComments("const u = 'https://example.test/x';")).toContain('https://example.test/x');
    expect(stripComments('const r = /^data:[^,]*,/;')).toContain('/^data:[^,]*,/');
    expect(stripComments('const r = /incognito ?browser/i.test(ua);')).toContain('/incognito ?browser/i');
  });

  it('leaves the words of a comment out of the text an assertion reads', () => {
    // The exact failure mode this file exists to avoid: the comment says the
    // guard is there, so the pattern matches even with the guard deleted.
    const withGuard = 'onClick={guardExport(() => downloadCsv(r))}';
    const commentOnly = '// onClick={guardExport(() => downloadCsv(r))}\nonClick={downloadCsv}';
    expect(stripComments(withGuard)).toContain('guardExport');
    expect(stripComments(commentOnly)).not.toContain('guardExport');
  });
});

/** Every tool page on disk, as `<niche>/<slug>` keyed by the engine it runs. */
function toolPagesByEngine(): Map<string, string[]> {
  const byEngine = new Map<string, string[]>();
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!name.endsWith('.json')) continue;
      const data = JSON.parse(readFileSync(full, 'utf-8'));
      if (!data.toolEngine) continue;
      // niche/slug come from the file's own fields, and the path is checked
      // against them below — a page whose fields disagree with where it sits
      // would otherwise be counted under a route that does not exist.
      const rel = full.slice(join(ROOT, 'data', 'tools').length + 1).replace(/\.json$/, '');
      expect(rel, 'a tool page whose niche/slug fields disagree with its path').toBe(`${data.niche}/${data.slug}`);
      const list = byEngine.get(data.toolEngine) ?? [];
      list.push(rel);
      byEngine.set(data.toolEngine, list);
    }
  };
  walk(join(ROOT, 'data', 'tools'));
  for (const [k, v] of byEngine) byEngine.set(k, v.sort());
  return byEngine;
}

/**
 * The three gated engines' full page lists, typed out by hand.
 *
 * These are the numbers the audit prose has to agree with. The audit named 4,
 * 5 and 2 of them respectively.
 */
const COOKIE_ANALYZER_PAGES = [
  'ad-tracking/cookie-tracker-scanner',
  'ccpa/cookie-privacy-scanner',
  'cookie-management/cookie-analyzer',
  'gdpr/cookie-compliance-scanner',
  'privacy-policies/cookie-tracker-analyzer', // the fifth skin the finding missed
];

const BROWSER_PRIVACY_PAGES = [
  'ai-privacy/browser-privacy-audit',
  'browser-extensions/browser-security-audit',
  'browser-privacy/browser-privacy-audit',
  'device-fingerprinting/fingerprint-checker',
  'incognito-mode/browser-privacy-audit',
  'isp-tracking/browser-leak-test',
  'private-search/browser-privacy-audit',
  'public-wifi/browser-security-check',
  'tor-privacy/browser-fingerprint-test',
  'vpn-privacy/browser-leak-test',
  'workplace-privacy/browser-privacy-audit',
];

const METADATA_VIEWER_PAGES = [
  'dating-privacy/image-metadata-checker',
  'drone-surveillance/image-metadata-checker',
  'facial-recognition/image-metadata-stripper', // outside the audit's slug glob
];

describe('F2/F3/F4: how many Pro pages each gated engine actually runs on', () => {
  const byEngine = toolPagesByEngine();

  it('cookie-analyzer runs on FIVE pages, not the four the finding named', () => {
    expect(byEngine.get('cookie-analyzer')).toEqual(COOKIE_ANALYZER_PAGES);
    // The named-four list in the finding was cookie-tracker-scanner plus the
    // cookie-management / GDPR / CCPA skins. privacy-policies is the fifth and
    // is a live page in its own right, not an alias of any of them.
    expect(COOKIE_ANALYZER_PAGES).toContain('privacy-policies/cookie-tracker-analyzer');
    expect(byEngine.get('cookie-analyzer')!.length).toBe(5);
  });

  it('browser-privacy runs on ELEVEN pages, and the audit\'s slug covers five of them', () => {
    expect(byEngine.get('browser-privacy')).toEqual(BROWSER_PRIVACY_PAGES);
    // `/resources-pro/tools/*/browser-privacy-audit/` is the pattern the
    // finding gave. Six pages run the identical component under a different
    // slug, so anything scoped by that glob — a WAF rule, an SSO path list, a
    // re-test checklist — silently misses half the surface.
    const matchesAuditGlob = (p: string) => p.endsWith('/browser-privacy-audit');
    const covered = BROWSER_PRIVACY_PAGES.filter(matchesAuditGlob);
    const missed = BROWSER_PRIVACY_PAGES.filter((p) => !matchesAuditGlob(p));
    expect(covered.length).toBe(5);
    expect(missed).toEqual([
      'browser-extensions/browser-security-audit',
      'device-fingerprinting/fingerprint-checker',
      'isp-tracking/browser-leak-test',
      'public-wifi/browser-security-check',
      'tor-privacy/browser-fingerprint-test',
      'vpn-privacy/browser-leak-test',
    ]);
  });

  it('metadata-viewer runs on THREE pages, one of which the audit\'s slug misses', () => {
    expect(byEngine.get('metadata-viewer')).toEqual(METADATA_VIEWER_PAGES);
    const missed = METADATA_VIEWER_PAGES.filter((p) => !p.endsWith('/image-metadata-checker'));
    expect(missed).toEqual(['facial-recognition/image-metadata-stripper']);
  });

  it('every skin of a gated engine is the same component, so the page count IS the blast radius', () => {
    // This is why the enumeration matters rather than being pedantry. The gate
    // is declared once, inside the engine component; the niche page is a shell
    // around it. Add a skin and it is gated identically on day one, which is
    // exactly why a page list written out by hand in an audit goes stale
    // without anything failing.
    const registry = code('components/tools/registry.tsx');
    expect(registry).toMatch(/['"]cookie-analyzer['"]:\s*CookieAnalyzerTool/);
    expect(registry).toMatch(/['"]browser-privacy['"]:\s*BrowserPrivacyTool/);
    expect(registry).toMatch(/['"]metadata-viewer['"]:\s*MetadataViewerTool/);
    // And the tier is a property of the engine, never of the page, so all 19
    // pages above are on the Pro deployment under /resources-pro/tools/.
    for (const engine of ['cookie-analyzer', 'browser-privacy', 'metadata-viewer']) {
      expect(PRO_ENGINES.has(engine), `${engine} is meant to be a Pro engine`).toBe(true);
      expect(tierOfEngine(engine)).toBe('pro');
    }
    // Summed from disk, not from the three literals above: 5 + 11 + 3 over
    // constants declared in this file could never fail, and an assertion
    // that cannot fail is the thing this file exists to avoid.
    const onDisk = ['cookie-analyzer', 'browser-privacy', 'metadata-viewer']
      .reduce((n, engine) => n + (byEngine.get(engine)?.length ?? 0), 0);
    expect(onDisk).toBe(19);
  });
});

describe('F2: the CSV gate is the URL branch only — the other two modes gate nothing', () => {
  const src = code('components/tools/CookieAnalyzerTool.tsx');

  it('the tool declares exactly one gate, and it is the CSV export', () => {
    const gates = [...src.matchAll(/useUpgradeGate\(\{/g)].length;
    expect(gates, 'a second gate would change what this tool withholds').toBe(1);
    expect(src).toMatch(/gate:\s*'cookie-csv-export'/);
  });

  it('the guarded button sits inside the URL-result branch, not the shared page body', () => {
    // The finding said "CSV export is the gated part" without saying WHERE the
    // button is. It is rendered only under `{urlResult && urlReport && ...}`.
    // Anyone reading the finding as "this tool has a paid action" and testing
    // it in "This Page" or "Paste" mode finds no button and no overlay, and
    // reasonably concludes the gate is broken.
    const urlBranch = src.indexOf('{urlResult && urlReport &&');
    const listBranch = src.indexOf("{scanned && mode !== 'url' && listReport &&");
    const guarded = src.indexOf('guardExport(() => downloadCsv(urlResult))');
    expect(urlBranch).toBeGreaterThan(-1);
    expect(listBranch).toBeGreaterThan(-1);
    expect(guarded).toBeGreaterThan(urlBranch);
    expect(guarded).toBeLessThan(listBranch);
  });

  it('"This Page" and "Paste" reach their handlers with no guard in the way', () => {
    // Stated positively so the test fails in both directions: if someone wraps
    // one of these in a guard, the free path this audit line describes is gone
    // and this goes red; if someone deletes the guard on export, the test
    // above goes red.
    expect(src).toContain('<button onClick={scanBrowserCookies}');
    expect(src).toContain('<button onClick={analyzePastedCookies}');
    const guardUses = [...src.matchAll(/guardExport\s*\(/g)];
    expect(guardUses.length, 'guardExport is used exactly once, on Export CSV').toBe(1);
  });
});

describe('F4: the metadata "gate" withholds nothing and unlocks nothing — and now says so to everyone', () => {
  const src = code('components/tools/MetadataViewerTool.tsx');
  const handleFile = src.slice(src.indexOf('const handleFile'), src.indexOf('const stripMetadata'));
  /** The gated call as a bare statement: no block of its own, nothing else in it. */
  const GATE_LINE = /if\s*\(picked\.length\s*>\s*1\)\s*noteBatchAttempt\(\);/;

  it('everyone who picks several photos gets the inline notice; a visitor without Pro gets the overlay on top', () => {
    // useUpgradeGate's guard has two branches: a confirmed subscriber runs
    // the wrapped action, everyone else is shown the overlay INSTEAD. Until
    // 2026-09-22 the action was `() => {}` and nothing was said inline, so a
    // subscriber who picked ten photos got one read and complete silence,
    // while a free visitor at least got the overlay's explanation. The notice
    // is now a plain statement in handleFile — for everyone, before the gate,
    // with nothing between `if (!file) return;` and it that could make it
    // conditional — and the guard wraps that same notice rather than nothing.
    // Nothing crosses the paywall here either way: Pro's batch cleaning is in
    // the Android app.
    expect(src).toMatch(/const \[batchNotice, setBatchNotice\] = useState\(false\);/);
    expect(src).toMatch(/const showBatchNotice = \(\) => setBatchNotice\(true\);/);
    expect(src).toMatch(/const noteBatchAttempt = guardBatch\(showBatchNotice\);/);
    expect(src).not.toMatch(/guardBatch\(\(\)\s*=>\s*\{\s*\}\)/);
    expect(handleFile).toMatch(/if \(!file\) return;\s*setBatchNotice\(picked\.length > 1\);/);
    expect(handleFile.search(/setBatchNotice\(picked\.length > 1\);/)).toBeLessThan(handleFile.search(GATE_LINE));
    // And it renders, in words that say where the whole folder goes.
    const rendered = /\{batchNotice && \(([\s\S]*?)\)\}/.exec(src);
    expect(rendered, 'no {batchNotice && (…)} block in the JSX').not.toBeNull();
    expect(rendered![1]).toMatch(/one photo at a time here/i);
    expect(rendered![1]).toMatch(/whole folders[^<]*in the app/i);
  });

  it('file one is read whatever the gate decides: nothing between the note and the read can stop it', () => {
    // The first version of this assertion blocked one shape,
    // `if (picked.length > 1) { … return }`. A separate
    // `if (picked.length > 1) return;` on the next line walked straight past
    // it (verifier, 2026-09-22) — and past tests/pro-client-only.test.ts too,
    // which reads only the branch's own consequent. So this reads the whole
    // stretch from the gated call to the read, and allows one early exit in
    // it: the size cap, whose condition is the file's size and nothing else.
    expect(handleFile).toMatch(/const\s+file\s*=\s*picked\?\.\[0\];/);
    const gate = GATE_LINE.exec(handleFile);
    expect(gate, 'the gated call is no longer the bare statement it was').not.toBeNull();
    const read = handleFile.indexOf('readImageMetadata(');
    expect(read).toBeGreaterThan(gate!.index);
    const between = handleFile.slice(gate!.index + gate![0].length, read);
    const sizeCap = /if \(file\.size > [\d\s*]+\) \{\s*alert\([^;]*\);\s*return;\s*\}/;
    expect(between).toMatch(sizeCap);
    expect(between.replace(sizeCap, '')).not.toMatch(/\b(?:return|throw)\b/);
    // Nothing after the note looks at the FileList again, so no statement in
    // that stretch can be conditioned on how many files were picked.
    expect(between).not.toMatch(/\bpicked\b/);
    expect([...src.matchAll(/noteBatchAttempt\s*\(\)/g)].length).toBe(1);
  });

  it('the whole gate is still four references: declare, wrap, call, render', () => {
    // If the gate ever grows a real payload — disabled state, a withheld
    // result, a second call site — this count changes and the audit sentence
    // "nothing is withheld" has to be rewritten. The inline notice is not a
    // payload: it is set outside the guard, so the guard still decides only
    // whether the overlay opens.
    expect([...src.matchAll(/\bguardBatch\b/g)].length).toBe(2); // destructured, then used
    expect([...src.matchAll(/\bbatchGate\b/g)].length).toBe(2); // destructured, then rendered
    expect(src).toContain('{batchGate}');
    expect(src).toContain("gate: 'metadata-multi-file'");
    expect(src).toContain("...GATE_COPY['metadata-multi-file']");
  });
});

describe('F5: scan, paste, single photo and the first audit are free, and the copy says so', () => {
  // The F5 row carried an empty gap — nothing was left uncovered on it. These
  // pin the claim anyway, because it is the half of the paywall description
  // most likely to rot silently: adding a guard to any of these four is one
  // line, and no existing test in this group would notice.
  it('no guard stands between a visitor and a scan, a paste or a first audit', () => {
    const cookies = code('components/tools/CookieAnalyzerTool.tsx');
    const audit = code('components/tools/BrowserPrivacyTool.tsx');
    const meta = code('components/tools/MetadataViewerTool.tsx');
    expect(cookies).toContain('<button onClick={scanBrowserCookies}');
    expect(cookies).toContain('<button onClick={analyzePastedCookies}');
    // The FIRST audit is unwrapped; only `runAt > 0` — a second run in the
    // same visit — reaches the guard, and a reload resets runAt to 0.
    expect(audit).toMatch(/onClick=\{runAt > 0 \? guardRerun\(runAudit\) : runAudit\}/);
    expect(meta).toMatch(/const\s+file\s*=\s*picked\?\.\[0\];/);
  });

  it('each overlay names the free path it leaves open', () => {
    expect(GATE_COPY['cookie-csv-export'].free).toMatch(/scan another page/i);
    expect(GATE_COPY['browser-privacy-rerun'].free).toMatch(/reload/i);
    expect(GATE_COPY['metadata-multi-file'].free).toMatch(/one at a time/i);
    for (const gate of ['cookie-csv-export', 'browser-privacy-rerun', 'metadata-multi-file'] as const) {
      expect(GATE_COPY[gate].free, `${gate} must state what stays free`).toMatch(/free|reload/i);
    }
  });
});

/* ------------------------------------------------------------------ */
/* F8: what actually sets <html data-ib-pro>                          */
/* ------------------------------------------------------------------ */

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

const CHROME_UA =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36';
const APP_UA = `${CHROME_UA} IncognitoBrowser/5.2`;

/**
 * A setTimeout the test drives by hand.
 *
 * lib/in-app.ts arms a grace loop that re-queues itself up to ten times,
 * looking for a bridge injected after the script ran. `flush(rounds)` runs
 * whatever is queued, one round at a time, and returns how many callbacks
 * ran, so a test can assert "the loop ran to the end and the mark is still
 * absent" rather than "the mark is absent" in a window where the loop could
 * not run at all. `pending()` is how many callbacks are queued right now.
 */
function fakeTimers() {
  let queue: Array<() => void> = [];
  return {
    // The delay the script passes is irrelevant here: nothing fires until flushed.
    setTimeout: (fn: () => void) => { queue.push(fn); return queue.length; },
    pending: () => queue.length,
    flush(rounds: number) {
      let ran = 0;
      for (let r = 0; r < rounds && queue.length > 0; r++) {
        const due = queue;
        queue = [];
        for (const fn of due) { fn(); ran++; }
      }
      return ran;
    },
  };
}

/**
 * Open `href` in a fake tab and run the boot script AS IT SHIPS — the
 * serialised IN_APP_BOOT_SCRIPT string that app/layout.tsx inlines, not the
 * TypeScript function. Passing the same FakeStorage to two calls is one tab
 * making two navigations. Timers never fire on their own: whatever the boot
 * script queues sits in `timers` until a test flushes it.
 */
function boot(href: string, opts: { storage?: FakeStorage; ua?: string; bridge?: unknown } = {}) {
  const root = new FakeElement();
  const storage = opts.storage ?? new FakeStorage();
  const timers = fakeTimers();
  const w = {
    document: { documentElement: root },
    location: { href },
    sessionStorage: storage,
    IncognitoBrowserApp: opts.bridge,
    navigator: { userAgent: opts.ua ?? CHROME_UA },
    setTimeout: timers.setTimeout,
    history: { state: null, replaceState: vi.fn() },
  };
  new Function('window', IN_APP_BOOT_SCRIPT)(w);
  return { root, storage, w, timers };
}

describe('F8: the Pro mark needs a pro claim plus proof of the app — and nothing else', () => {
  const BRIDGE = { postMessage: () => {} };

  it('?pro=1 alone sets the mark when the bridge is there: ?inapp=1 is not required', () => {
    // The finding wrote the trigger as "?inapp=1&pro=1 plus bridge or UA".
    // lib/in-app.ts computes `source` as param|bridge|ua, so `source` is
    // already truthy whenever the bridge or the UA is present, and the
    // condition `source && pro && (bridged || named)` collapses to
    // `pro && (bridged || named)`. No `inapp` parameter here at all.
    const { root } = boot('https://example.test/resources-pro/tools/x/y/?pro=1', { bridge: BRIDGE });
    expect(root.getAttribute('data-inapp')).toBe('bridge');
    expect(root.hasAttribute('data-ib-pro')).toBe(true);
  });

  it('?pro=1 alone also sets it on a user agent that names the app', () => {
    const { root } = boot('https://example.test/resources-pro/tools/x/y/?pro=1', { ua: APP_UA });
    expect(root.getAttribute('data-inapp')).toBe('ua');
    expect(root.hasAttribute('data-ib-pro')).toBe(true);
  });

  it('neither parameter need be on the current URL: one earlier ?pro=1 arms the tab', () => {
    // Case D/E of the audit. Page one is an ordinary browser with a crafted
    // link and gets nothing — correct. But the claim is kept in
    // sessionStorage, and `pro` is read back out of it on every later
    // navigation, so a page with a completely clean URL inherits it the
    // moment the bridge shows up.
    const first = boot('https://example.test/a/?pro=1');
    expect(first.root.hasAttribute('data-ib-pro')).toBe(false);
    expect(first.storage.getItem('ib-pro')).toBe('1');

    const later = boot('https://example.test/b/', { storage: first.storage, bridge: BRIDGE });
    expect(later.w.history.replaceState).not.toHaveBeenCalled(); // no parameters to clean off
    expect(later.root.hasAttribute('data-ib-pro')).toBe(true);
  });

  it('a pro claim with nothing vouching for it still marks nothing — with the grace loop run to the end', () => {
    // The control that makes the three above meaningful rather than alarming.
    // A shared or crafted link, opened in an ordinary browser, is inert: this
    // is the 2026-09-18 fix and it still holds.
    const bare = boot('https://example.test/?pro=1');
    expect(bare.root.hasAttribute('data-ib-pro')).toBe(false);
    expect(bare.timers.pending(), 'no ?inapp=1, so nothing to wait for').toBe(0);
    // `?inapp=1&pro=1` is the one shape that also arms lib/in-app.ts's
    // late-bridge grace loop: ten looks, 100 ms apart, for a bridge injected
    // after the script ran. That loop is the only place the mark can be set
    // AFTER load, and the first version of this control never let it run —
    // boot() handed the script `setTimeout: undefined` — so its body could
    // set the attribute unconditionally and every test here stayed green
    // (verifier, 2026-09-22). Drive it to exhaustion and look again.
    const crafted = boot('https://example.test/?inapp=1&pro=1');
    expect(crafted.root.hasAttribute('data-ib-pro')).toBe(false);
    expect(crafted.timers.pending(), 'the grace loop did not arm — this control is blind to it again').toBe(1);
    expect(crafted.timers.flush(50), 'ten looks, then it stops re-arming: bounded, not a poll').toBe(10);
    expect(crafted.timers.pending()).toBe(0);
    expect(crafted.root.hasAttribute('data-ib-pro')).toBe(false);
    // And proof of the app without a pro claim marks the app, not Pro, and
    // arms nothing: there is no claim for a late bridge to confirm.
    const inApp = boot('https://example.test/?inapp=1', { bridge: BRIDGE });
    expect(inApp.root.getAttribute('data-inapp')).toBe('param');
    expect(inApp.root.hasAttribute('data-ib-pro')).toBe(false);
    expect(inApp.timers.pending()).toBe(0);
  });

  it('the grace loop does its one job: a bridge that turns up late confirms the claim through that same loop', () => {
    // The positive half of the control above. Without it, a fake setTimeout
    // that queued callbacks nobody ran would make "still absent after the
    // flush" true for the wrong reason — the same blindness, one layer down.
    const late = boot('https://example.test/?inapp=1&pro=1');
    expect(late.timers.flush(3)).toBe(3);
    expect(late.root.hasAttribute('data-ib-pro')).toBe(false);
    late.w.IncognitoBrowserApp = BRIDGE;
    expect(late.timers.flush(1)).toBe(1);
    expect(late.root.hasAttribute('data-ib-pro')).toBe(true);
    expect(late.timers.pending(), 'found the bridge, so no further look is queued').toBe(0);
  });

  it('a late bridge confirms the stored claim with no parameter in sight', async () => {
    // lib/in-app.ts confirmStoredPro(): once anything finds the bridge object,
    // sessionStorage alone is enough to set the attribute. inAppSource() is
    // called by every upgrade surface on the page, so this runs constantly.
    // Note what it does NOT read: the URL, or `ib-inapp`.
    vi.resetModules();
    const root = new FakeElement();
    const store = new FakeStorage();
    store.setItem('ib-pro', '1');
    vi.stubGlobal('document', { documentElement: root });
    vi.stubGlobal('window', { IncognitoBrowserApp: { postMessage: () => {} } });
    vi.stubGlobal('sessionStorage', store);
    try {
      const { inAppSource, inAppPro } = await import('@/lib/in-app');
      expect(root.hasAttribute('data-ib-pro')).toBe(false);
      expect(inAppSource()).toBe('bridge');
      expect(root.hasAttribute('data-ib-pro')).toBe(true);
      expect(inAppPro()).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      vi.resetModules();
    }
  });

  it('the boot script source states the condition it really evaluates', () => {
    // Read from the shipped string, comments and all removed, so this cannot
    // pass on the strength of the 38-line header above bootInApp().
    const src = code('lib/in-app.ts');
    expect(src).toMatch(/if \(source && pro && \(bridged \|\| named\)\) root\.setAttribute\('data-ib-pro', ''\)/);
    expect(src).toMatch(/let pro = get\('ib-pro'\) === '1';/);
    expect(src).toContain('confirmStoredPro();');
    // The grace loop: armed only by a parameter-backed claim with no proof
    // yet, and its body sets the mark on finding the bridge and on nothing
    // else. The behavioural tests above are what catch a change here; this
    // pins the shape so the failure names the line.
    expect(src).toMatch(/if \(pro && fromApp && !bridged && !named && typeof w\.setTimeout === 'function'\) \{/);
    expect(src).toMatch(/const again = \(\) => \{\s*if \(onBridge\(\)\) \{ root\.setAttribute\('data-ib-pro', ''\); return; \}\s*tries = tries \+ 1;\s*if \(tries < 10\) w\.setTimeout\(again, 100\);/);
  });
});
