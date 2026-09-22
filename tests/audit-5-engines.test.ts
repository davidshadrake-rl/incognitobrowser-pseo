/**
 * Audit group 5 — "engines": the three tool engines behind the Pro paywall
 * (browser-privacy, and the metadata reader's file handling), plus the two
 * promises the paywall copy makes about them.
 *
 * Everything here exists because the previous audit pass found the PROPERTY
 * held but nothing asserted it. That is the dangerous shape: it is true by
 * construction today, and the construction is one refactor away from
 * changing with nothing failing. Each block below says which property it
 * pins and what breaks it.
 *
 * Two house rules are obeyed here on purpose, both because this repo has been
 * bitten by ignoring them:
 *
 *   1. A guard that matches its own explanatory comment has shipped twice.
 *      Every source assertion in this file runs against COMMENT-STRIPPED
 *      source, and `describe('the comment stripper')` proves the stripper
 *      actually strips before any of those assertions are trusted.
 *
 *   2. A probe sized politely enough to miss the consequence has shipped
 *      once. The decompression-bomb tests below therefore use LITERAL sizes
 *      (12 MiB, 18 MiB, 200 chunks) and assert on the CONSEQUENCE — whether
 *      the payload reached a rendered row — not on the label the code prints.
 *      Deriving the expected size from LIMITS would make them pass no matter
 *      what LIMITS said, which is the "test that cannot fail" failure mode.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import zlib from 'node:zlib';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { inflatePending, readImageMetadata, LIMITS, type ImageMetadata } from '../lib/exif';
import { GATE_COPY } from '../lib/card-copy';
import { useUpgradeGate } from '../components/useUpgradeGate';
import { BrowserPrivacyTool } from '../components/tools/BrowserPrivacyTool';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf-8');

/* ══════════════════════════════════════════════════════════════════════ *
 * The comment stripper, and its own proof
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Remove comments while leaving string, template and regex literals intact.
 *
 * Written out rather than regexed because a naive /\/\/.*$/ eats the `//` in
 * a URL and the `/` in a regex literal, and both appear in the files below.
 * The scanner tracks which literal it is inside; a `/` only starts a regex
 * when the previous significant character cannot end an expression.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let prev = '';
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
      const quote = c;
      out += c;
      i++;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
      prev = quote;
      continue;
    }
    if (c === '/' && /[=(,:;[{!&|?+\-*%~^]|^$/.test(prev)) {
      // A regex literal. Copy it whole, character classes included, so a `/`
      // inside [...] does not look like the closing delimiter.
      out += c;
      i++;
      let inClass = false;
      while (i < src.length) {
        if (src[i] === '\\') { out += src[i] + (src[i + 1] ?? ''); i += 2; continue; }
        if (src[i] === '[') inClass = true;
        else if (src[i] === ']') inClass = false;
        out += src[i];
        if (src[i] === '/' && !inClass) { i++; break; }
        i++;
      }
      prev = '/';
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

const AUDIT_SRC = read('components/tools/BrowserPrivacyTool.tsx');
const AUDIT = stripComments(AUDIT_SRC);
const GATE_SRC = read('components/useUpgradeGate.tsx');
const GATE = stripComments(GATE_SRC);
const META_SRC = read('components/tools/MetadataViewerTool.tsx');
const META = stripComments(META_SRC);

describe('the comment stripper (nothing below is trustworthy until this passes)', () => {
  /**
   * The failure this guards against, twice shipped in this repo: a source
   * guard that "passes" because the phrase it looks for is sitting in the
   * comment explaining the guard, not in the code the guard is about.
   *
   * These two phrases exist ONLY inside comments in their files. If the
   * stripper ever stops working, they survive, this block fails, and the
   * source assertions further down stop being believed — instead of quietly
   * passing on prose.
   */
  it('removes a line comment, keeping the code on either side of it', () => {
    expect(AUDIT_SRC).toContain('Never persisted');
    expect(AUDIT).not.toContain('Never persisted');
    expect(AUDIT).toContain('const [runAt, setRunAt] = useState(0);');
  });

  it('removes a block comment, keeping the declaration it documents', () => {
    expect(GATE_SRC).toContain('any link opened all three gates');
    expect(GATE).not.toContain('any link opened all three gates');
    expect(GATE).toContain('export function shouldGate()');
  });

  it('leaves regex literals and URLs alone (the two things a naive stripper eats)', () => {
    // A `//` inside a string, and a regex whose character class holds a `/`.
    expect(stripComments("const u = 'https://example.test/a'; // gone")).toBe("const u = 'https://example.test/a'; ");
    expect(stripComments('const re = /[a-z/]+/g; // gone')).toBe('const re = /[a-z/]+/g; ');
    // ...and the real one from the metadata tool, which must survive intact.
    expect(META).toContain("file.name.replace(/\\.[^.]+$/, '')");
  });
});

/* ══════════════════════════════════════════════════════════════════════ *
 * A tiny hook harness
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Run a hook (or a whole component function) inside a real React render and
 * hand back what it returned.
 *
 * This repo has no DOM test environment and no React testing library, which
 * is why tests/use-upgrade-gate.test.ts only ever tested `shouldGate()`, the
 * pure half. But Fizz (react-dom/server) is a real dispatcher: useState,
 * useRef, useCallback and useMemo all work inside it, and a component
 * function CALLED DIRECTLY from a probe's render body has its hooks
 * attributed to the probe. That is enough to get the actual `guard` closure
 * and the actual rendered element tree into a test's hands.
 *
 * A setState dispatched after the render has finished is a no-op in Fizz, so
 * the overlay's open/close state cannot be observed this way. Every
 * assertion below is therefore about whether the WRAPPED ACTION RAN, which
 * is the half that matters for a paywall.
 */
function inRender<T>(body: () => T): T {
  let captured: T;
  let ran = false;
  const Probe = () => { captured = body(); ran = true; return null; };
  renderToStaticMarkup(createElement(Probe));
  if (!ran) throw new Error('the probe never rendered — the harness is broken, not the code');
  return captured!;
}

type Node = { type?: unknown; props?: { children?: unknown; [k: string]: unknown } };

/** Depth-first walk of a returned element tree, collecting every node. */
function flatten(node: unknown, out: Node[] = []): Node[] {
  if (Array.isArray(node)) { for (const n of node) flatten(n, out); return out; }
  if (!node || typeof node !== 'object') return out;
  const el = node as Node;
  out.push(el);
  if (el.props && 'children' in el.props) flatten(el.props.children, out);
  return out;
}

class FakeRoot {
  attrs = new Set<string>();
  hasAttribute(k: string) { return this.attrs.has(k); }
}

/**
 * Stub `document` and `window` so the two branches of a gated handler can be
 * told apart by what they touch:
 *   - the GATED branch reads `document.activeElement` (to restore focus)
 *   - the FREE branch runs the audit, whose first act is to read
 *     `window.OfflineAudioContext` for the audio fingerprint
 * Neither branch touches the other's global, so `touched` is unambiguous.
 */
function stubBrowser(pro: boolean) {
  const root = new FakeRoot();
  if (pro) root.attrs.add('data-ib-pro');
  const touched: string[] = [];
  vi.stubGlobal('document', {
    documentElement: root,
    get activeElement() { touched.push('document.activeElement'); return null; },
  });
  vi.stubGlobal('window', new Proxy({}, {
    get(_t, k) { touched.push(`window.${String(k)}`); return undefined; },
    has() { return false; },
  }));
  return { root, touched };
}

/* ══════════════════════════════════════════════════════════════════════ *
 * A1 — "the second click overlays; a reload reruns it free"
 * ══════════════════════════════════════════════════════════════════════ */

describe('A1 browser-privacy-rerun: the reload really is a free reset', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('the copy promises a free reload reset, in those words', () => {
    // The promise was asserted nowhere: it lived only in this string, and the
    // mechanism that makes it true lived only in a useState initialiser. If
    // the copy is softened or dropped, the mechanism tests below become tests
    // of a promise nobody makes any more, so pin the string here and the
    // mechanism immediately after it.
    expect(GATE_COPY['browser-privacy-rerun'].free).toBe('Reload this page to run the audit again, free, any time.');
    expect(GATE_COPY['browser-privacy-rerun'].headline).toBe('This audit already ran once this visit');
    // "this visit" is the load-bearing word. A gate that outlived the visit
    // would make both of these sentences false.
    expect(GATE_COPY['browser-privacy-rerun'].stake).toContain('this visit');
  });

  it('the gate input is component state seeded with a literal 0, not a stored value', () => {
    // A reload resets the gate because `runAt` starts at 0 on every mount and
    // the decision is `runAt > 0`. Both halves asserted, on stripped source.
    expect(AUDIT).toContain('const [runAt, setRunAt] = useState(0);');
    expect(AUDIT).toContain('onClick={runAt > 0 ? guardRerun(runAudit) : runAudit}');
    // The only writer is the in-memory clock at the end of a run. A write of
    // anything else — or from anywhere else — is a different mechanism.
    const writes = AUDIT.match(/setRunAt\([\s\S]*?\);/g) ?? [];
    expect(writes).toEqual(['setRunAt(Date.now());']);
  });

  it('nothing in the engine can survive a reload: no storage API of any kind', () => {
    // THIS is the regression the whole item is about. `runAt` being React
    // state is what makes the reload free, and a single sessionStorage line
    // added by a future "remember the visitor ran it" change would turn the
    // paywall copy into a lie with no test failing. Every browser-side
    // persistence surface is refused by name.
    const PERSISTENCE = [
      'sessionStorage', 'localStorage', 'indexedDB', 'document.cookie',
      'BroadcastChannel', 'caches', 'openDatabase', 'window.name',
      'CookieStore', 'cookieStore',
    ];
    for (const api of PERSISTENCE) {
      expect(AUDIT, `${api} appeared in BrowserPrivacyTool.tsx — the reload reset is no longer free`).not.toContain(api);
    }
    // And the gate hook itself must stay memory-only for the same reason: it
    // is shared with the CSV and multi-file gates.
    for (const api of PERSISTENCE) {
      expect(GATE, `${api} appeared in useUpgradeGate.tsx`).not.toContain(api);
    }
  });

  it('a fresh mount — which is what a reload produces — runs the audit with no overlay', () => {
    // Behavioural, not source: render the component the way a reloaded page
    // would, pull the real button out of the tree, click it, and watch which
    // branch it took. Fake timers hold the audit at its 400ms pause so the
    // run never reaches the DOM-reading half; the evidence is already in by
    // then, because the audio-fingerprint read happens before that await.
    const { touched } = stubBrowser(false);
    vi.useFakeTimers();
    // Called as a plain function inside the probe's render, so its hooks are
    // the probe's and its returned element tree lands in a variable rather
    // than being flattened to markup. useReportResult() is a no-op outside
    // its provider (ResultContext.tsx:172), so no wrapper is needed.
    const tree = inRender(() => (BrowserPrivacyTool as unknown as () => unknown)());
    const buttons = flatten(tree).filter((n) => n.type === 'button');
    expect(buttons, 'the audit button is gone from the tree').toHaveLength(1);
    const onClick = buttons[0].props!.onClick as () => unknown;
    expect(typeof onClick).toBe('function');

    const returned = onClick();
    if (returned && typeof (returned as Promise<unknown>).catch === 'function') {
      (returned as Promise<unknown>).catch(() => {});
    }

    // The free branch: the audit started (it reached the audio probe) and the
    // overlay never took focus.
    expect(touched).toContain('window.OfflineAudioContext');
    expect(touched).not.toContain('document.activeElement');
  });
});

/* ══════════════════════════════════════════════════════════════════════ *
 * A2 — "you cannot skip the overlay without reloading"
 * ══════════════════════════════════════════════════════════════════════ */

describe('A2 the overlay cannot be dismissed past', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /** Pull the real `guard` out of a real render of the real hook. */
  function realGuard(pro: boolean) {
    const stub = stubBrowser(pro);
    const { guard } = inRender(() => useUpgradeGate({
      engine: 'browser-privacy',
      gate: 'browser-privacy-rerun',
      ...GATE_COPY['browser-privacy-rerun'],
    }));
    return { guard, ...stub };
  }

  it('dismiss, re-attempt, dismiss, re-attempt: the action never runs once', () => {
    // The gap this closes: four e2e tests asserted the overlay APPEARS, and
    // none asserted it still appears on the second attempt. A gate that let
    // the action through after one dismissal would have passed all four.
    //
    // Dismissal is not modelled directly (Fizz cannot observe setOpen), and
    // it does not need to be: dismissing sets `open` to false and touches
    // nothing else, so a re-attempt is simply another call to the same
    // wrapped handler. Ten of them, and the audit must not run once.
    const { guard, touched } = realGuard(false);
    const audit = vi.fn();
    const wrapped = guard(audit);
    for (let i = 0; i < 10; i++) wrapped();
    expect(audit, 'the gated action ran — the overlay can be dismissed past').not.toHaveBeenCalled();
    // ...and the overlay opened on every one of them, rather than going quiet
    // after the first (which would be a gate that blocks but stops asking).
    expect(touched.filter((t) => t === 'document.activeElement')).toHaveLength(10);
  });

  it('arguments are dropped with the call, not smuggled through', () => {
    const { guard } = realGuard(false);
    const audit = vi.fn();
    guard(audit)('a', 2, { c: true });
    expect(audit).not.toHaveBeenCalled();
  });

  it('a confirmed Pro visitor runs it untouched, every time', () => {
    // The other half of the same branch: if this stopped working the gate
    // would be blocking the people who paid, and the test above would still
    // pass. Both directions, or neither is proven.
    const { guard, touched } = realGuard(true);
    const audit = vi.fn();
    const wrapped = guard(audit);
    wrapped('x');
    wrapped('y');
    expect(audit).toHaveBeenCalledTimes(2);
    expect(audit).toHaveBeenNthCalledWith(1, 'x');
    expect(audit).toHaveBeenNthCalledWith(2, 'y');
    expect(touched).not.toContain('document.activeElement');
  });

  it('"cannot skip without reloading" is true of the UI and false of the origin', () => {
    // Stated plainly because the owner-facing claim overstates it. The gate is
    // one attribute read (useUpgradeGate.tsx -> lib/in-app.ts inAppPro()), so
    // anything that can run script on this origin — an extension, the console,
    // an injected bridge object — skips it without reloading. That is asserted
    // here rather than left as a belief.
    const { guard, root } = realGuard(false);
    const audit = vi.fn();
    const wrapped = guard(audit);
    wrapped();
    expect(audit).not.toHaveBeenCalled();
    root.attrs.add('data-ib-pro');   // one line of script in the page
    wrapped();
    expect(audit, 'setting the attribute no longer opens the gate').toHaveBeenCalledTimes(1);
    // Why that is tolerable is settled elsewhere and must stay settled: every
    // gated action is client-side reformatting of data the visitor already
    // has, and none of the three reaches our API. tests/pro-entitlement.test.ts
    // holds that line; this only records that the bypass is real.
    expect(Object.keys(GATE_COPY).sort()).toEqual(['browser-privacy-rerun', 'cookie-csv-export', 'metadata-multi-file']);
  });
});

/* ══════════════════════════════════════════════════════════════════════ *
 * A5 — canvas and audio fingerprinting stay in the page
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * The body of a declaration, by brace matching.
 *
 * Not "the first `{` after the name": `detectWebRtcLeaks` is declared
 * `: Promise<{ publicIPs: string[]; … }>`, and taking that brace returns the
 * RETURN TYPE instead of the body — an eight-word string that trivially
 * satisfies every `.not.toMatch(NETWORK_SINK)` below. That is a vacuous
 * assertion of exactly the kind this audit exists to stop, and it is why the
 * opening brace is required to be the one that starts a block (followed by a
 * newline) and why each body assertion also asserts something the body is
 * known to contain.
 */
function bodyFrom(src: string, needle: string): string {
  const at = src.indexOf(needle);
  if (at < 0) throw new Error(`not found in source: ${needle}`);
  let open = -1;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '{' && /^\{[ \t]*\r?\n/.test(src.slice(i, i + 4))) { open = i; break; }
  }
  if (open < 0) throw new Error(`no block body found after ${needle}`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unbalanced braces after ${needle}`);
}

/** Every way this codebase has of reaching the network from a page. */
const NETWORK_SINK = /\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource|SCAN_API_BASE|['"`]\/api\/|navigator\.connection|importScripts/;

describe('A5 the fingerprint probes never leave the page', () => {
  it('the audio fingerprint — which sits OUTSIDE runAudit — makes no request', () => {
    // The existing assertion (tests/pro-entitlement.test.ts:398) scans
    // runAudit's body only. audioFingerprintHash is a module-level function,
    // so it was outside that body and outside that assertion; the canvas
    // probe is inside it. Both are covered here, and on stripped source, so a
    // sink hidden in a commented-out line cannot satisfy either.
    const audio = bodyFrom(AUDIT, 'async function audioFingerprintHash');
    expect(audio).toContain('OfflineAudioContext');
    expect(audio).toContain('startRendering');
    expect(audio).not.toMatch(NETWORK_SINK);

    const hash = bodyFrom(AUDIT, 'async function fastHashHex');
    expect(hash).toContain("crypto.subtle.digest('SHA-256'");
    expect(hash).not.toMatch(NETWORK_SINK);

    const run = bodyFrom(AUDIT, 'const runAudit');
    expect(run).toContain('CANVAS_PROBE_TEXT');       // the canvas probe is in here
    expect(run).toContain('audioFingerprintHash');
    expect(run).not.toMatch(NETWORK_SINK);
  });

  it('the whole engine holds no sink, and cannot import one', () => {
    // A body-scoped assertion is defeated by `import { track } from
    // '@/lib/track'` plus one call — track() posts to /api/event over
    // sendBeacon (lib/track.ts:64). So the file's import list is pinned too:
    // every one of these is local UI or copy, and none can reach the network.
    expect(AUDIT).not.toMatch(NETWORK_SINK);
    const imports = [...AUDIT.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]).sort();
    expect(imports).toEqual([
      '@/components/ui/StatusDot',
      '@/components/useUpgradeGate',
      '@/lib/card-copy',
      './ConsoleFrame',
      './ResultContext',
      'react',
    ].sort());
  });

  it('records the one thing the engine DOES send, so "all in-page" is not over-claimed', () => {
    // Honest counterweight: the WebRTC row opens an RTCPeerConnection against
    // third-party STUN servers. That is the check working as intended, not a
    // leak to us — but "the audit never touches the network" would be false,
    // and a test that implied it would be the reassuring-grade mistake again.
    // Canvas and audio are in-page; WebRTC is not, and here is the proof.
    const webrtc = bodyFrom(AUDIT, 'async function detectWebRtcLeaks');
    expect(webrtc).toContain('stun:stun.cloudflare.com:3478');
    expect(webrtc).toContain('stun:stun.l.google.com:19302');
    // Those two, and nothing else: a third destination is a new disclosure.
    const urls = [...AUDIT.matchAll(/['"`]([a-z]+:\/\/[^'"`]+|stun:[^'"`]+)['"`]/g)].map((m) => m[1]).sort();
    expect(urls).toEqual(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']);
  });
});

/* ══════════════════════════════════════════════════════════════════════ *
 * M4 — the decompression bomb
 * ══════════════════════════════════════════════════════════════════════ */

const cat = (...parts: Array<Uint8Array | number[]>) => {
  const all = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
};
const str = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const pngChunk = (type: string, data: Uint8Array) => cat(be32(data.length), str(type), data, [0, 0, 0, 0]);
const png = (...chunks: Uint8Array[]) =>
  cat([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], pngChunk('IHDR', new Uint8Array(13)), ...chunks, pngChunk('IEND', new Uint8Array(0)));

/** A zTXt chunk whose payload inflates to `bytes` bytes of filler. */
function bomb(key: string, bytes: number): Uint8Array {
  const z = zlib.deflateSync(Buffer.alloc(bytes, 0x41)); // 'A' repeated
  return pngChunk('zTXt', cat(str(`${key}\0`), [0], Uint8Array.from(z)));
}

const rowFor = (m: ImageMetadata, tag: string) => m.fields.find((f) => f.tag === tag);
const MiB = 1024 * 1024;

describe('M4 a PNG decompression bomb is refused, not rendered', () => {
  /**
   * The previous pass tested a DECLARED-DIMENSIONS bomb (a 65535x65535 IHDR
   * in 88 bytes) and said so in its own spec: "this is a HEADER bomb, not a
   * compression bomb". The actual decompression surface — lib/exif.ts
   * inflatePending() and the three constants that bound it — had no test at
   * all, in tests/, e2e/ or scripts/security/checks/.
   *
   * Sizes below are LITERALS on purpose. If they were derived from LIMITS,
   * raising LIMITS would move the probe with the cap and the tests would pass
   * on any value, which is the exact "test that cannot fail" the owner has
   * already been burned by twice.
   *
   * Scope, stated plainly: this reader runs in the visitor's browser and
   * never posts the file anywhere (the metadata tool touches no network at
   * all). A bomb here costs the visitor's own tab, not the droplet. It is
   * still worth bounding — a tool that hangs the tab of anyone sent a crafted
   * image is a real defect — but it is not a path to the server.
   */

  it('a 12 MiB payload hidden in a 13 KB file never reaches a row', () => {
    const file = png(bomb('Comment', 12 * MiB));
    // The whole point of a bomb: it is small on disk.
    expect(file.length).toBeLessThan(64 * 1024);

    const m = readImageMetadata(file);
    expect(m.pending).toHaveLength(1);

    const started = Date.now();
    return inflatePending(m).then(() => {
      const elapsed = Date.now() - started;
      expect(m.pending).toHaveLength(0);

      const row = rowFor(m, 'Comment');
      expect(row, 'the chunk produced no row at all').toBeTruthy();
      // The consequence, asserted directly: none of the payload is in the row.
      expect(row!.value).not.toContain('AAAA');
      expect(row!.value).toMatch(/not read/);
      expect(row!.value).toMatch(/once decompressed/);
      // Bailing early, not materialising 12 MiB and then trimming it.
      expect(elapsed, 'the bomb was decompressed in full before being refused').toBeLessThan(5000);
      // And the cap that did the refusing has to stay well under the probe,
      // or the probe stops proving anything about it.
      expect(LIMITS.inflatedBytes).toBeGreaterThan(0);
      expect(LIMITS.inflatedBytes).toBeLessThanOrEqual(8 * MiB);
    });
  });

  it('six 3 MiB chunks cost 8 MiB, not 18: the per-file budget is spent, then closed', async () => {
    // Each chunk is comfortably under the per-chunk cap, so per-chunk alone
    // would let all six through — 18 MiB of decompression from a ~19 KB file.
    // The per-file budget is the only thing that stops it.
    const file = png(...['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((k) => bomb(k, 3 * MiB)));
    expect(file.length).toBeLessThan(128 * 1024);

    const m = readImageMetadata(file);
    expect(m.pending).toHaveLength(6);
    await inflatePending(m);

    const keys = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'];
    const decompressed = keys.filter((k) => (rowFor(m, k)?.value ?? '').includes('AAAA'));
    const refused = keys.filter((k) => /not read/.test(rowFor(m, k)?.value ?? ''));

    // 8 MiB of budget buys two 3 MiB chunks and no more.
    expect(decompressed.length).toBeLessThanOrEqual(2);
    expect(refused.length).toBeGreaterThanOrEqual(3);
    expect(decompressed.length + refused.length).toBe(6);
    // The tail must be refused on the PER-FILE ground specifically, not the
    // per-chunk one — that is the constant with no coverage.
    expect(rowFor(m, 'c6')!.value).toMatch(/per file/);
    expect(LIMITS.inflatedTotal).toBeLessThanOrEqual(16 * MiB);
  });

  it('200 compressed chunks do not become 200 decompression jobs', async () => {
    // The queue itself is a cost: `pending` holds every compressed chunk met,
    // and each one becomes an await. Capping the inflate size but not the
    // COUNT would leave a file that queues tens of thousands of them.
    const file = png(...Array.from({ length: 200 }, (_, i) => bomb(`k${i}`, 4096)));
    const m = readImageMetadata(file);

    expect(m.pending.length, '200 chunks were all queued').toBeLessThan(200);
    expect(m.pending.length).toBe(LIMITS.pendingTexts);
    expect(LIMITS.pendingTexts).toBeLessThanOrEqual(128);
    // ...and the visitor is told, rather than being shown a short list that
    // looks like the whole file.
    expect(m.notes.join(' ')).toMatch(/compressed text chunks; only the first/);
    expect(m.undecoded.join(' ')).toMatch(/more compressed text chunks than this viewer reads/);

    await inflatePending(m);
    expect(m.pending).toHaveLength(0);
  });

  it('a chunk the viewer DOES accept still cannot put 3 MiB into the page', async () => {
    // The politeness trap, closed: a 3 MiB chunk is under every inflate cap,
    // so it is decompressed for real. What bounds the damage after that is
    // LIMITS.shownChars in addField(), and that had no test on this path
    // either. Without it, an accepted chunk renders 3 million characters.
    const m = readImageMetadata(png(bomb('Description', 3 * MiB)));
    await inflatePending(m);

    const row = rowFor(m, 'Description');
    expect(row, 'the accepted chunk produced no row').toBeTruthy();
    expect(row!.value).toContain('AAAA');           // it really was decompressed
    expect(row!.value.length).toBeLessThan(4000);   // ...and really was trimmed
    expect(row!.value.endsWith('…')).toBe(true);
    // Whole-file bound, which is what a page actually has to render.
    const rendered = m.fields.reduce((n, f) => n + f.tag.length + f.value.length, 0);
    expect(rendered).toBeLessThan(200_000);
  });
});

/* ══════════════════════════════════════════════════════════════════════ *
 * M5 — filenames handed out of the page (CHARACTERISATION, not a guard)
 * ══════════════════════════════════════════════════════════════════════ */

describe('M5 GAP: the clean-copy filename is not sanitised', () => {
  /**
   * This block pins what the code DOES, not what it should do — the same
   * shape tests/pro-bridge.test.ts uses for the saveImage half of this
   * finding ("GAP: the web side validates neither value"). It is reported in
   * needsSourceChange, not counted as closed: nothing here would fail if the
   * bug were exploited, only if it were FIXED, at which point these get
   * rewritten as refusals. That is the point of pinning them — the
   * strip-download half previously had no test of any kind.
   */
  it('cleanFileName applies exactly one transformation, and it is not a basename strip', () => {
    const body = bodyFrom(META, 'function cleanFileName');
    expect(body).toContain("return file.name.replace(/\\.[^.]+$/, '') + '-clean.jpg';");
    // Nothing removes directory segments, and nothing rejects a name.
    expect(body).not.toMatch(/split\(|basename|lastIndexOf|\.pop\(\)|replaceAll/);
    // So a name carrying traversal carries it into the download attribute:
    const cleanFileName = (name: string) => name.replace(/\.[^.]+$/, '') + '-clean.jpg';
    expect(cleanFileName('../../Download/evil.html')).toBe('../../Download/evil-clean.jpg');
  });

  it('the one half that IS guarded: the extension is always forced to .jpg', () => {
    // Worth separating out, because it is real containment rather than luck —
    // the clean copy is re-encoded through a canvas to JPEG, and the name is
    // rebuilt rather than reused. An .apk or .html name cannot survive this
    // function, whatever the source file was called.
    const cleanFileName = (name: string) => name.replace(/\.[^.]+$/, '') + '-clean.jpg';
    for (const n of ['update.apk', 'page.html', 'x.jpg.exe', 'IMG_4471.HEIC', 'noextension']) {
      expect(cleanFileName(n).endsWith('-clean.jpg')).toBe(true);
    }
    // And the value really is what the anchor is given, in both places.
    expect(META).toContain('a.download = cleanFileName(currentFile);');
    expect(META).toContain('download={strippedName}');
  });
});
