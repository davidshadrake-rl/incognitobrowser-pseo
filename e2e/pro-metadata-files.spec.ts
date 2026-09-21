/**
 * The Image Metadata Viewer, fed files that are trying something.
 *
 * WHY THIS EXISTS, and what it adds to what is already here.
 * tests/pro-client-only.test.ts and scripts/security/checks/pro-client-only.mjs
 * already prove, FROM SOURCE, that components/tools/MetadataViewerTool.tsx and
 * lib/exif.ts contain no transport at all, that the size guard runs before
 * arrayBuffer(), and that the multi-file gate does not swallow the free first
 * file. Those are strong checks and this file does not repeat them. What a
 * grep cannot do is say what a RUNNING page does with a hostile file: whether
 * a <script> inside an image ever executes, whether an SVG is put somewhere
 * that can render it as markup, whether a header that declares 17 GB of pixels
 * makes the tab allocate 17 GB, and whether any image byte leaves the browser
 * once the file is real and the page is live. That is this file's whole job.
 *
 * The fixtures are built in e2e/fixtures/polyglot/make.ts rather than
 * committed, and every one of them carries a marker the assertions key off.
 *
 * The metadata viewer makes NO network calls of its own (verified in source,
 * and asserted again here from the wire), so this spec puts no load on
 * /api/scan-url and cannot trip the droplet's rate limits. It fetches static
 * pages and nothing else.
 *
 * Run:
 *   E2E_BASE_URL=https://206-189-186-34.nip.io npx playwright test e2e/pro-metadata-files.spec.ts
 */
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOMB_HEIGHT,
  BOMB_TEXT_VALUE,
  BOMB_WIDTH,
  JPEG_COMMENT_TEXT,
  MARK,
  SVG_TEXT_MARKER,
  htmlJpegPolyglot,
  oversizedJpeg,
  pngHeaderBomb,
  svgAsSvg,
  svgRenamedJpg,
  type Fixture,
} from './fixtures/polyglot/make';

const BASE = (process.env.E2E_BASE_URL || 'https://206-189-186-34.nip.io').replace(/\/$/, '');
const PRO = `${BASE}/resources-pro`;
const FIX = path.join(__dirname, 'fixtures');
const ROOT = path.join(__dirname, '..');

/**
 * The page under test, taken from the generated fixture rather than typed out,
 * so a tool page that moves or a tier that changes surfaces as a clear failure
 * here instead of a 404 that reads like a broken input.
 */
const TOOL_PAGES: Array<{ site: 'free' | 'pro'; path: string; engine: string }> = JSON.parse(
  fs.readFileSync(path.join(FIX, 'tool-pages.json'), 'utf-8'),
);
const VIEWER = TOOL_PAGES.find((t) => t.engine === 'metadata-viewer' && t.site === 'pro');
const PAGE_URL = VIEWER ? `${PRO}${VIEWER.path}/` : '';

const TOOL_SRC = fs.readFileSync(path.join(ROOT, 'components', 'tools', 'MetadataViewerTool.tsx'), 'utf-8');

/**
 * The size cap, READ OUT OF THE PRODUCT rather than remembered. The brief says
 * the owner believes it is 50 MB / 0x3200000; this resolves the real
 * expression, and the first test states what it found so the number is on the
 * record either way.
 */
function sizeCapFromSource(): { bytes: number; message: string } {
  const guard = /file\.size\s*>\s*([0-9_*+\s()]+)\)/.exec(TOOL_SRC);
  if (!guard) throw new Error('no file.size guard in MetadataViewerTool.tsx — the size cap has moved or gone');
  const bytes = Function(`"use strict";return (${guard[1].replace(/_/g, '')});`)() as number;
  const alerted = /alert\(\s*'([^']*[Mm]aximum size[^']*)'/.exec(TOOL_SRC);
  if (!alerted) throw new Error('the size refusal no longer alerts a message naming a maximum');
  return { bytes, message: alerted[1] };
}
const CAP = sizeCapFromSource();

// ───────────────────────────── page helpers ─────────────────────────────

/** Every request the page made, with its body, so "no image byte left" is checked on the wire. */
interface Sent {
  url: string;
  method: string;
  type: string;
  bytes: number;
  body: string;
}
function watchNetwork(page: Page): Sent[] {
  const sent: Sent[] = [];
  page.on('request', (r) => {
    let buf: Buffer | null = null;
    try {
      buf = r.postDataBuffer();
    } catch {
      buf = null;
    }
    sent.push({
      url: r.url(),
      method: r.method(),
      type: r.resourceType(),
      bytes: buf?.length ?? 0,
      body: buf ? buf.toString('latin1') : '',
    });
  });
  return sent;
}

/**
 * The wire is not enough on its own. The page's one beacon (lib/track.ts) goes
 * out through navigator.sendBeacon with a Blob body, and Playwright reports
 * that request with postDataBuffer() === null — so a check that only read the
 * wire would be quietly blind to the single request most worth reading. This
 * wraps sendBeacon, fetch and XMLHttpRequest.send in the page itself, before
 * any of the app's code runs, and keeps every body it is given.
 */
interface InPageSent {
  kind: string;
  url: string;
  body: string;
  bytes: number;
}
async function installBodyRecorder(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __ibSent: InPageSentRec[] };
    interface InPageSentRec { kind: string; url: string; body: string; bytes: number }
    w.__ibSent = [];
    const note = (kind: string, url: unknown, body: unknown) => {
      const rec: InPageSentRec = { kind, url: String(url), body: '', bytes: 0 };
      w.__ibSent.push(rec);
      if (body == null) return;
      if (typeof body === 'string') { rec.body = body; rec.bytes = body.length; return; }
      if (body instanceof Blob) {
        rec.bytes = body.size;
        // Async, but the assertions poll; a body that never resolves stays
        // visible as bytes > 0 with an empty string, which still fails a
        // "nothing large was sent" check.
        body.text().then((t) => { rec.body = t; }).catch(() => { rec.body = '[blob unreadable]'; });
        return;
      }
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const view = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array((body as ArrayBufferView).buffer);
        rec.bytes = view.byteLength;
        let s = '';
        for (let i = 0; i < view.length; i++) s += String.fromCharCode(view[i]);
        rec.body = s;
        return;
      }
      if (body instanceof FormData) {
        const parts: string[] = [];
        body.forEach((v, k) => parts.push(`${k}=${typeof v === 'string' ? v : `[file ${v.name} ${v.size}B]`}`));
        rec.body = parts.join('&');
        rec.bytes = rec.body.length;
        return;
      }
      rec.body = `[body of type ${Object.prototype.toString.call(body)}]`;
      rec.bytes = rec.body.length;
    };

    const beacon = navigator.sendBeacon?.bind(navigator);
    if (beacon) {
      navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => {
        note('sendBeacon', url, data);
        return beacon(url, data);
      };
    }
    const realFetch = window.fetch;
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      note('fetch', typeof input === 'string' || input instanceof URL ? input : input.url, init?.body);
      return realFetch(input, init);
    };
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      (this as unknown as { __ibUrl: string }).__ibUrl = String(url);
      return (open as (...a: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
      note('xhr', (this as unknown as { __ibUrl?: string }).__ibUrl, body);
      return send.call(this, body);
    };
  });
}

/** Everything the page itself handed to a transport, bodies included. */
function recordedBodies(page: Page): Promise<InPageSent[]> {
  return page.evaluate(() => (window as unknown as { __ibSent?: InPageSent[] }).__ibSent ?? []) as Promise<InPageSent[]>;
}

/**
 * The one assertion this whole file exists for: nothing the page sent carries
 * the file. Checked on the wire AND at the call site, because the two see
 * different things.
 */
async function expectNoImageBytesLeft(page: Page, sent: Sent[], needles: string[], label: string) {
  const inPage = await recordedBodies(page);
  const all = [
    ...sent.filter((s) => s.bytes > 0).map((s) => ({ where: `wire ${s.method} ${s.url}`, body: s.body, bytes: s.bytes })),
    ...inPage.map((s) => ({ where: `in-page ${s.kind} ${s.url}`, body: s.body, bytes: s.bytes })),
  ];
  for (const s of all) {
    for (const needle of needles) {
      expect(s.body, `${s.where} carries "${needle}"`).not.toContain(needle);
    }
    expect(s.bytes, `${s.where} posted ${s.bytes} bytes — far more than a counter needs`).toBeLessThan(4096);
  }
  const summary = all.length ? all.map((s) => `${s.where} (${s.bytes}B)`).join('; ') : 'nothing with a body at all';
  test.info().annotations.push({ type: 'network', description: `${label}: ${summary}` });
  console.log(`[${label}] bodies sent: ${summary}`);
  return all;
}

/** alert() is how this tool refuses a file; Playwright dismisses dialogs unhandled, so catch them. */
function watchDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on('dialog', (d) => {
    seen.push(d.message());
    void d.dismiss();
  });
  return seen;
}

/** Page errors and console errors: a fixture that kills the tab must not read as a pass. */
function watchErrors(page: Page): string[] {
  const errs: string[] = [];
  page.on('pageerror', (e) => errs.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errs.push(`console: ${m.text()}`);
  });
  return errs;
}

/**
 * A committed fixture, read into a payload. setInputFiles refuses to mix paths
 * with buffers, and the hostile fixtures only exist as buffers, so anything
 * chosen alongside one has to become a buffer too.
 */
function fromDisk(file: string, mimeType: string): Fixture {
  return { name: path.basename(file), mimeType, buffer: fs.readFileSync(file) };
}

/** Choose files the way a visitor does: the control is on screen first (mirrors cta-visibility.spec.ts). */
async function choose(page: Page, files: Fixture[] | string[]) {
  const input = page.locator('input[type="file"]').first();
  await input.evaluate((el) => {
    let box: Element | null = el;
    while (box && box.getBoundingClientRect().height === 0) box = box.parentElement;
    box?.scrollIntoView({ block: 'nearest' });
  });
  await input.setInputFiles(files as never);
}

/** Which XSS markers, if any, actually ran. Empty is the only acceptable answer. */
function firedMarkers(page: Page): Promise<string[]> {
  return page.evaluate(
    (keys) => keys.filter((k) => (window as unknown as Record<string, unknown>)[k] !== undefined),
    Object.values(MARK) as string[],
  );
}

/** Anything a file's bytes could have become if the page ever treated them as markup. */
function injected(page: Page) {
  return page.evaluate(
    ({ marks, svgText }) => ({
      scripts: [...document.querySelectorAll('script')].filter((s) =>
        marks.some((m) => (s.textContent ?? '').includes(m)),
      ).length,
      // An <img src=blob:> is inert; an SVG that got inlined would be in the
      // tree. The page draws its own decorative SVGs (some with <text>), so
      // this counts only what could have come from the chosen FILE: a <script>
      // or an onload inside any SVG, or a <text> holding the fixture's marker.
      inlineSvg:
        document.querySelectorAll('svg script, svg[onload], svg *[onload]').length +
        [...document.querySelectorAll('svg text')].filter((t) => (t.textContent ?? '').includes(svgText)).length,
      svgTextVisible: document.body.innerText.includes(svgText),
      // React escapes text nodes. If the JPEG comment reached the page at all,
      // it must be there in its ESCAPED form — the exact payload, character
      // for character, not merely "some escaped angle bracket somewhere".
      escapedInHtml: marks.some((m) => document.body.innerHTML.includes(`&lt;script&gt;window.${m}=1&lt;/script&gt;`)),
      rawScriptTagInHtml: /<script>window\.__ibXss/.test(document.body.innerHTML),
    }),
    { marks: Object.values(MARK) as string[], svgText: SVG_TEXT_MARKER },
  );
}

/** Live check that the tab is still answering, after a fixture meant to stall or crash it. */
async function stillAlive(page: Page) {
  const pong = await page.evaluate(() => {
    const t = performance.now();
    return { title: document.title.length > 0, took: performance.now() - t };
  });
  return pong.title;
}

/** Chromium exposes a coarse heap reading without a flag; undefined elsewhere. */
function heapBytes(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return m ? m.usedJSHeapSize : null;
  });
}

async function openViewer(page: Page) {
  await installBodyRecorder(page); // before the first navigation, or the app's code runs first
  const res = await page.goto(PAGE_URL);
  expect(res?.status(), `${PAGE_URL} must exist on this deployment`).toBeLessThan(400);
  await expect(page.locator('input[type="file"]').first()).toBeVisible({ timeout: 15_000 });
}

const CONSOLE = '[data-console="metadata-viewer"]';
const GATE = '.ug-panel[data-upgrade-gate="metadata-multi-file"]';

// A tool page missing from this deployment is a failure, not a silent skip.
test.beforeEach(() => {
  expect(VIEWER, 'metadata-viewer has no Pro page in e2e/fixtures/tool-pages.json').toBeTruthy();
});

// ───────────────────── 0. the detectors detect ─────────────────────

/**
 * Every "nothing executed" and "nothing was sent" assertion below is a check
 * that something is ABSENT, and an absence is exactly what a typo produces. A
 * misspelled marker, a `window` read against the wrong frame or a request
 * listener that never fires would make the rest of this file pass while
 * testing nothing at all. So, on the real page, with the real helpers: plant
 * each signal deliberately and prove it is seen.
 */
test('the detectors are not vacuous: a planted script and a planted request body are both caught', async ({ page }) => {
  test.setTimeout(60_000);
  const sent = watchNetwork(page);
  await openViewer(page);

  expect(await firedMarkers(page), 'clean page').toEqual([]);
  const dom0 = await injected(page);
  expect(dom0.scripts).toBe(0);
  expect(dom0.rawScriptTagInHtml).toBe(false);
  expect(dom0.escapedInHtml, 'a page with no fixture on it already reports the payload as escaped').toBe(false);

  // Plant exactly what a successful attack would leave behind.
  await page.evaluate(
    ({ mark, svgText }) => {
      (window as unknown as Record<string, unknown>)[mark] = 1;
      const s = document.createElement('script');
      s.textContent = `window.${mark}=1`;
      document.body.appendChild(s);
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      t.textContent = svgText;
      svg.appendChild(t);
      document.querySelector('main')?.appendChild(svg);
      // The benign case the polyglot test expects to see: the payload present
      // as an escaped text node, which is what React renders a field value as.
      const p = document.createElement('p');
      p.textContent = `<script>window.${mark}=1</script>`;
      document.body.appendChild(p);
    },
    { mark: MARK.jpegComment, svgText: SVG_TEXT_MARKER },
  );

  expect(await firedMarkers(page), 'firedMarkers cannot see an executed marker').toEqual([MARK.jpegComment]);
  const dom1 = await injected(page);
  expect(dom1.scripts, 'injected() cannot see a planted <script>').toBe(1);
  expect(dom1.inlineSvg, 'injected() cannot see an inlined SVG carrying the fixture marker').toBeGreaterThan(0);
  expect(dom1.svgTextVisible, 'injected() cannot see the SVG rendered as markup').toBe(true);
  expect(dom1.escapedInHtml, 'injected() cannot see the payload rendered as an escaped text node').toBe(true);

  // And the two body recorders. Both POSTs are same-origin to a STATIC path
  // (nginx answers 405 or 404); neither touches /api, so neither can trip a
  // rate limit. The sendBeacon case is the one that matters: it is how
  // lib/track.ts sends the page's only real body, and Playwright reports that
  // request with a null postDataBuffer — which is exactly why the in-page
  // recorder exists.
  const before = sent.length;
  await page.evaluate((url) => {
    void fetch(url, { method: 'POST', body: 'IB-CANARY-FETCH' }).catch(() => {});
    navigator.sendBeacon(url, new Blob(['IB-CANARY-BEACON'], { type: 'application/json' }));
  }, PAGE_URL);

  await expect.poll(() => sent.slice(before).filter((s) => s.bytes > 0).length, { timeout: 10_000 }).toBeGreaterThan(0);
  const onWire = sent.slice(before).filter((s) => s.bytes > 0);
  expect(onWire.map((s) => s.body), 'watchNetwork cannot read a fetch body off the wire').toContain('IB-CANARY-FETCH');

  await expect.poll(async () => (await recordedBodies(page)).map((s) => s.body).join('|'), { timeout: 10_000 })
    .toContain('IB-CANARY-BEACON');
  const inPage = await recordedBodies(page);
  expect(inPage.map((s) => s.body), 'the in-page recorder missed the fetch body').toContain('IB-CANARY-FETCH');
  expect(inPage.filter((s) => s.kind === 'sendBeacon').length, 'the in-page recorder missed the sendBeacon').toBeGreaterThan(0);

  // Stated for the record: the wire alone is blind to a Blob beacon body.
  const beaconOnWire = onWire.filter((s) => s.body.includes('IB-CANARY-BEACON')).length;
  console.log(
    `[detector] planted script seen; fetch body seen on the wire and in-page; ` +
      `sendBeacon Blob body seen in-page, and ${beaconOnWire ? 'also' : 'NOT'} on the wire ` +
      `(${onWire.length} wire bodies, ${inPage.length} in-page calls)`,
  );
});

// ───────────────────────── 1. HTML-as-JPEG polyglot ─────────────────────────

test('polyglot: a JPEG carrying a <script> in its comment is read as an image, printed as text, and never executed', async ({ page }) => {
  test.setTimeout(60_000);
  const sent = watchNetwork(page);
  const dialogs = watchDialogs(page);
  const errs = watchErrors(page);
  await openViewer(page);

  const fixture = htmlJpegPolyglot(path.join(FIX, 'sample.jpg'));
  // The fixture is a real photo with a comment segment spliced in and an HTML
  // document after the EOI — both halves of a classic polyglot.
  expect(fixture.buffer.subarray(0, 3).toString('hex'), 'fixture must still start FFD8FF').toBe('ffd8ff');
  expect(fixture.buffer.toString('latin1')).toContain(JPEG_COMMENT_TEXT);
  const before = sent.length;

  await choose(page, [fixture]);

  // It parsed AS AN IMAGE: the JPEG reader reached the COM segment and made a row.
  await expect(page.locator(CONSOLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('code').filter({ hasText: '__ibXssJpegComment' }).first()).toBeVisible({ timeout: 15_000 });
  const shown = await page.locator('code').filter({ hasText: '__ibXssJpegComment' }).first().textContent();
  expect(shown?.trim(), 'the comment is shown verbatim, as data').toBe(JPEG_COMMENT_TEXT);
  // …and the file's own name is reported, so this row belongs to this file.
  await expect(page.locator('code').filter({ hasText: 'holiday-photo.jpg' }).first()).toBeVisible();

  // Nothing ran. Not the comment's script, not the HTML after the EOI.
  expect(await firedMarkers(page), 'a script inside the image executed').toEqual([]);
  const dom = await injected(page);
  expect(dom.scripts, 'a <script> holding the file\'s payload is in the document').toBe(0);
  expect(dom.rawScriptTagInHtml, 'the payload is live markup in the DOM, not escaped text').toBe(false);
  expect(dom.escapedInHtml, 'the payload should appear HTML-escaped, which is what a text node looks like').toBe(true);

  // 6. Zero network. The viewer has no transport, so nothing should have been
  //    posted at all — but the page as a whole does have one beacon
  //    (lib/track.ts POSTs cookieless counters to /event), so this asserts on
  //    CONTENT and VOLUME rather than on a request count, which is the claim
  //    that actually matters: no image byte left the browser.
  const after = sent.slice(before);
  await expectNoImageBytesLeft(page, after, ['__ibXss', 'holiday-photo', JPEG_COMMENT_TEXT], 'polyglot');
  expect(after.filter((s) => /\/(scan-url|challenge)\b/.test(s.url)).map((s) => s.url), 'the viewer called the scan API').toEqual([]);

  // The only place the bytes went is an object URL: the preview <img> is fed
  // blob:, which is this document's own memory and reaches no server.
  const previewSrc = await page.locator('img[alt*="Preview of the image"]').first().getAttribute('src');
  expect(previewSrc, `the preview is loaded from ${previewSrc}, not from a blob: URL`).toMatch(/^blob:/);
  console.log(`[polyglot] ${after.length} requests after the upload (file was ${fixture.buffer.length} bytes); preview src scheme: ${previewSrc?.slice(0, 5)}`);

  expect(dialogs, 'a valid image should not be refused').toEqual([]);
  expect(await stillAlive(page)).toBe(true);
  expect(errs.filter((e) => e.startsWith('pageerror'))).toEqual([]);
});

// ───────────────────────── 2. SVG, renamed and honest ─────────────────────────

for (const [label, make] of [
  ['renamed .jpg', svgRenamedJpg],
  ['uploaded as .svg', svgAsSvg],
] as const) {
  test(`svg ${label}: never rendered as markup, and its script never runs`, async ({ page }) => {
    test.setTimeout(60_000);
    const dialogs = watchDialogs(page);
    const errs = watchErrors(page);
    const sent = watchNetwork(page);
    await openViewer(page);
    const before = sent.length;

    const fixture = make();
    await choose(page, [fixture]);

    // detectImageFormat() keys off magic bytes, so '<?xml' is 'unknown' whatever
    // the extension or the MIME type claims — and summarizeMetadata() then
    // refuses to grade it, rather than calling an unreadable file clean.
    await expect(page.locator(CONSOLE)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('Unrecognised file type').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(CONSOLE).getByText('Not read').first()).toBeVisible();

    // The security claim: an SVG is an XML document that can carry script. It
    // must reach the page only as an <img> source (inert by specification) and
    // never as markup.
    expect(await firedMarkers(page), 'the SVG executed').toEqual([]);
    const dom = await injected(page);
    expect(dom.scripts, 'the SVG\'s <script> is in the document').toBe(0);
    expect(dom.inlineSvg, 'the SVG was inlined into the page instead of being used as an image source').toBe(0);
    expect(dom.svgTextVisible, 'the SVG was rendered as markup — its text is in the page').toBe(false);

    // Give an onload one more turn of the event loop before declaring it never fired.
    await page.waitForTimeout(500);
    expect(await firedMarkers(page), 'the SVG executed on a later tick').toEqual([]);

    await expectNoImageBytesLeft(page, sent.slice(before), [SVG_TEXT_MARKER, MARK.svg, '<svg'], `svg ${label}`);
    expect(dialogs, 'an unreadable file is reported in the page, not behind an alert()').toEqual([]);
    expect(errs.filter((e) => e.startsWith('pageerror'))).toEqual([]);
    expect(await stillAlive(page)).toBe(true);
  });
}

// ───────────────────────── 3. The declared-dimensions bomb ─────────────────────────

test('bomb: a sub-kilobyte PNG declaring 65535 x 65535 is parsed without allocating for it', async ({ page }) => {
  test.setTimeout(60_000);
  const dialogs = watchDialogs(page);
  const errs = watchErrors(page);
  await openViewer(page);

  const fixture = pngHeaderBomb();
  // ~17 GB if anything ever sized a buffer from the header.
  expect(BOMB_WIDTH * BOMB_HEIGHT * 4).toBeGreaterThan(17e9);
  expect(fixture.buffer.length, 'the bomb must stay tiny — that is the whole asymmetry').toBeLessThan(400);

  const heapBefore = await heapBytes(page);
  const started = Date.now();
  await choose(page, [fixture]);

  // It WAS parsed: the tEXt chunk beside the enormous IHDR came through.
  await expect(page.locator(CONSOLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('code').filter({ hasText: BOMB_TEXT_VALUE }).first()).toBeVisible({ timeout: 15_000 });
  const elapsed = Date.now() - started;
  const heapAfter = await heapBytes(page);

  // Grounded in lib/exif.ts: IHDR is in PNG_KNOWN and readPng() never reads a
  // width or a height out of it. So the read is proportional to the file, not
  // to what the file claims — which is what these two numbers check.
  expect(elapsed, `reading a 130-byte file took ${elapsed}ms`).toBeLessThan(15_000);
  if (heapBefore !== null && heapAfter !== null) {
    const grew = heapAfter - heapBefore;
    test.info().annotations.push({ type: 'heap', description: `JS heap grew ${(grew / 1e6).toFixed(1)} MB reading the bomb` });
    console.log(`[bomb] ${fixture.buffer.length}-byte file declaring ${BOMB_WIDTH}x${BOMB_HEIGHT} (~${((BOMB_WIDTH * BOMB_HEIGHT * 4) / 1e9).toFixed(0)} GB): read in ${elapsed}ms, JS heap grew ${(grew / 1e6).toFixed(1)} MB`);
    expect(grew, `the JS heap grew ${(grew / 1e6).toFixed(1)} MB for a 130-byte file`).toBeLessThan(64e6);
  } else {
    test.info().annotations.push({ type: 'note', description: 'performance.memory unavailable — heap growth not measured, timing and liveness only' });
  }
  expect(await stillAlive(page)).toBe(true);

  // The other half: "Strip metadata & download" hands the file to the browser's
  // own decoder and sizes a <canvas> from img.naturalWidth. This file has no
  // pixel data, so the decode must fail and say so rather than sizing a canvas.
  await page.getByRole('button', { name: /Strip metadata/i }).first().click();
  await expect.poll(() => dialogs.length, { timeout: 20_000 }).toBeGreaterThan(0);
  expect(dialogs[0], 'the failed decode said nothing').toBeTruthy();
  test.info().annotations.push({ type: 'strip', description: `strip refused with: ${dialogs[0]}` });
  console.log(`[bomb] "Strip metadata & download" refused it with: ${dialogs[0]}`);
  expect(await stillAlive(page)).toBe(true);
  expect(errs.filter((e) => e.startsWith('pageerror'))).toEqual([]);

  /**
   * NOT COVERED HERE, said out loud rather than left to look like a pass:
   * this is a HEADER bomb, not a compression bomb. A file whose IDAT really
   * does inflate to gigabytes would be decoded by the browser itself, and if
   * the product failed the check the test machine — not the product — is what
   * would fall over. Building one would mean this suite could take a laptop
   * down, so it is deliberately absent. What is proven here is the half that
   * can be proven safely: the metadata reader never sizes anything from a
   * declared dimension, and the strip path fails closed on an undecodable file.
   */
});

// ───────────────────────── 4. The size cap ─────────────────────────

test(`size cap: a file one byte over the real limit (${CAP.bytes} bytes) is refused, not read`, async ({ page }) => {
  test.setTimeout(120_000);
  const dialogs = watchDialogs(page);
  const errs = watchErrors(page);
  await openViewer(page);

  // The owner said 50MB / 0x3200000. Verified against the product, not assumed:
  expect(CAP.bytes, `the cap in the source is ${CAP.bytes} bytes (0x${CAP.bytes.toString(16)})`).toBe(50 * 1024 * 1024);
  expect(CAP.bytes).toBe(0x3200000);
  // …and the refusal names the same number it enforces.
  expect(CAP.message).toContain(`${CAP.bytes / 1024 / 1024}MB`);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-oversize-'));
  try {
    const file = oversizedJpeg(dir, CAP.bytes + 1, 'huge.jpg');

    // First, the control: a file exactly ON the cap is not refused — otherwise
    // a guard that rejected everything would pass the test below.
    await choose(page, [oversizedJpeg(dir, CAP.bytes, 'at-the-limit.jpg')]);
    // It is a header with a 50 MB hole after it, so the reader finds no
    // metadata — the point is only that it was READ rather than refused.
    await expect(page.locator(CONSOLE)).toBeVisible({ timeout: 60_000 });
    expect(dialogs, `a file of exactly ${CAP.bytes} bytes was refused; the guard is off by one`).toEqual([]);

    // Now one byte over.
    await choose(page, [file]);
    await expect.poll(() => dialogs.length, { timeout: 30_000 }).toBeGreaterThan(0);
    expect(dialogs[0], 'the refusal must name the limit, not just fail').toBe(CAP.message);
    expect(dialogs[0]).toMatch(/too large/i);

    // The tab survived: no hang, no crash, the control is still usable.
    expect(await stillAlive(page)).toBe(true);
    await expect(page.locator('input[type="file"]').first()).toBeEnabled();
    expect(errs.filter((e) => e.startsWith('pageerror'))).toEqual([]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('size cap: a refused file and the verdict left on screen (the known low finding, checked on the live page)', async ({ page }) => {
  test.setTimeout(120_000);
  const dialogs = watchDialogs(page);
  await openViewer(page);

  // A real result first…
  await choose(page, [path.join(FIX, 'sample-gps.jpg')]);
  await expect(page.locator(CONSOLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/GPS location where it was taken/i).first()).toBeVisible({ timeout: 15_000 });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-oversize-'));
  try {
    await choose(page, [oversizedJpeg(dir, CAP.bytes + 1)]);
    await expect.poll(() => dialogs.length, { timeout: 30_000 }).toBeGreaterThan(0);

    // What MUST hold: the refusal happened, the tab is alive, and the oversized
    // file was never read — no row anywhere names it.
    expect(dialogs[0]).toBe(CAP.message);
    expect(await stillAlive(page)).toBe(true);
    await expect(page.locator('code').filter({ hasText: 'huge.jpg' })).toHaveCount(0);

    /**
     * What is REPORTED, not enforced: pro_metadata_multi_file_gated_single_still_works
     * grades it low that the size branch alerts and returns without clearing
     * state, so the refused file leaves the PREVIOUS photo's verdict on screen.
     * This records what the live page actually does. It is deliberately not a
     * hard expectation in either direction: failing when the bug is present
     * would duplicate a finding that is already tracked, and failing when it is
     * fixed would make a fix look like a regression.
     */
    const stale = await page.locator('code').filter({ hasText: 'sample-gps.jpg' }).count();
    const verdict = await page.locator(CONSOLE).isVisible();
    test.info().annotations.push({
      type: 'finding',
      description: stale > 0 || verdict
        ? `CONFIRMED on the live page: after refusing an oversized file the previous photo's verdict is still shown (console visible: ${verdict}, previous file name rows: ${stale}) — the low finding already graded by pro_metadata_multi_file_gated_single_still_works`
        : 'the stale-verdict finding no longer reproduces on the live page — the size branch now clears state',
    });
    console.log(`[finding] stale verdict after an oversized file: console visible=${verdict}, previous-file rows=${stale}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ───────────────────────── 5. The gate, both halves ─────────────────────────

test('gate: more than one file opens the overlay, and the FIRST file is still read and shown free', async ({ page }) => {
  test.setTimeout(60_000);
  const dialogs = watchDialogs(page);
  const sent = watchNetwork(page);
  await openViewer(page);
  const before = sent.length;

  // Two files, the second of them hostile: the gate must not become an excuse
  // to skip reading the first, and the first must be the one on screen.
  const polyglot = htmlJpegPolyglot(path.join(FIX, 'sample.jpg'));
  await choose(page, [fromDisk(path.join(FIX, 'sample-gps.jpg'), 'image/jpeg'), polyglot]);

  // Half one: the overlay, carrying the declared gate id.
  await expect(page.locator(GATE)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(GATE).getByText('One photo at a time is free').first()).toBeVisible();

  // Half two: the first file was read anyway, free, and it is file [0].
  await expect(page.locator(CONSOLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/GPS location where it was taken/i).first()).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('code').filter({ hasText: 'sample-gps.jpg' }).first()).toBeVisible();
  // The second file was NOT read: nothing on the page names it or its payload.
  await expect(page.locator('code').filter({ hasText: 'holiday-photo.jpg' })).toHaveCount(0);
  await expect(page.locator('code').filter({ hasText: '__ibXssJpegComment' })).toHaveCount(0);
  expect(await firedMarkers(page), 'the second, unread file still executed').toEqual([]);

  // The gate reports the ATTEMPT to /event (lib/track.ts). Whatever it reports
  // must be a counter, not the photos — and the beacon's body is read in-page,
  // because Playwright cannot read a sendBeacon Blob off the wire.
  const bodies = await expectNoImageBytesLeft(
    page,
    sent.slice(before),
    ['__ibXss', 'sample-gps.jpg', 'holiday-photo.jpg'],
    'gate',
  );
  // Positive half: something DID report the gate attempt, and what it reported
  // is the declared gate id — so "no photo in the body" is not just silence.
  const gateReports = bodies.filter((s) => s.body.includes('metadata-multi-file'));
  test.info().annotations.push({
    type: 'gate-telemetry',
    description: gateReports.length
      ? `the gate attempt was reported as: ${gateReports.map((s) => `${s.where} ${s.body.slice(0, 300)}`).join(' | ')}`
      : 'the gate attempt sent no request body at all',
  });
  console.log(`[gate] telemetry: ${gateReports.map((s) => s.body.slice(0, 300)).join(' | ') || 'none'}`);
  expect(dialogs).toEqual([]);
});
