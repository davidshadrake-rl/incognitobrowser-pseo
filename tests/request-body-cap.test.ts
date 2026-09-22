/**
 * The request body cap, tested on the axis that actually failed.
 *
 * Found 2026-09-21. Every POST route pre-checked Content-Length and then
 * called request.text(), which is unbounded. A chunked request sends no
 * Content-Length, so the pre-check read null, `Number(null) > MAX` was false,
 * and the fast path was SKIPPED rather than triggered — the unbounded read ran
 * with nothing in front of it. Measured in process: 300MB resident on the
 * 448MB heap the droplet runs, from one request, with no proof-of-work
 * required on /event, /stats or /dns-leak/result.
 *
 * Three of these are behavioural, against real streams. The memory bound is
 * asserted by counting what the producer was ever ASKED for rather than by
 * sampling heapUsed: a heap assertion depends on when GC runs and would be
 * flaky in CI, while "the reader stopped pulling" is the exact property that
 * makes the cap real and is deterministic.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { readCappedRequestText } from '../lib/request-body';

/** A body that arrives as a stream with no Content-Length, i.e. chunked. */
function chunkedBody(chunkBytes: number, chunks: number) {
  const counter = { produced: 0 };
  const chunk = new Uint8Array(chunkBytes).fill(0x61);
  let sent = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (sent++ >= chunks) return c.close();
      counter.produced += chunkBytes;
      c.enqueue(chunk);
    },
  });
  return { stream, counter };
}

function req(body: BodyInit | ReadableStream, headers: Record<string, string> = {}) {
  return new Request('http://x/api/event', {
    method: 'POST',
    body: body as BodyInit,
    headers,
    // @ts-expect-error duplex is required for a stream body and is not in the DOM lib types
    duplex: 'half',
  });
}

describe('readCappedRequestText', () => {
  it('refuses a chunked body over the cap', async () => {
    const { stream } = chunkedBody(1024, 64); // 64 KB offered
    const r = req(stream);
    expect(r.headers.get('content-length')).toBeNull(); // the hole the old check fell through
    const out = await readCappedRequestText(r, 2048);
    expect(out.ok).toBe(false);
  });

  it('stops pulling once the cap is passed, so the body never goes resident', async () => {
    // 64MB offered against a 2KB cap. If the cap were post-read, the producer
    // would be drained and all 64MB would be allocated. A streaming cap stops
    // after the first over-cap chunk.
    const { stream, counter } = chunkedBody(1 << 20, 64);
    const out = await readCappedRequestText(req(stream), 2048);
    expect(out.ok).toBe(false);
    // One chunk, possibly one more from the stream's internal pull-ahead.
    expect(counter.produced).toBeLessThanOrEqual(2 << 20);
    expect(counter.produced).toBeLessThan(64 << 20);
  });

  it('is not fooled by a Content-Length that lies about a large body', async () => {
    // Declaring a small length used to buy a pass through the pre-check and
    // then an unbounded read of whatever actually arrived.
    const { stream } = chunkedBody(1 << 20, 8);
    const out = await readCappedRequestText(req(stream, { 'content-length': '10' }), 2048);
    expect(out.ok).toBe(false);
  });

  it('refuses on the declared length alone, without draining the stream', async () => {
    // Not "produces nothing": a ReadableStream calls pull() once eagerly when
    // it is constructed, before any consumer exists, so one chunk is already
    // out of the producer no matter what this function does. What the cap
    // controls is whether the REST is drained — 8 KB is offered here and at
    // most that first pull-ahead chunk is ever produced.
    const { stream, counter } = chunkedBody(1024, 8);
    const out = await readCappedRequestText(req(stream, { 'content-length': '999999' }), 2048);
    expect(out.ok).toBe(false);
    expect(counter.produced).toBeLessThanOrEqual(1024);
  });

  it('returns a body that fits, byte for byte', async () => {
    const payload = JSON.stringify({ event: 'cta_click', tool: 'cookie-analyzer' });
    const out = await readCappedRequestText(req(payload), 2048);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe(payload);
  });

  it('accepts a body that sits exactly on the cap, and refuses one byte more', async () => {
    const exact = 'a'.repeat(64);
    expect((await readCappedRequestText(req(exact), 64)).ok).toBe(true);
    expect((await readCappedRequestText(req('a'.repeat(65)), 64)).ok).toBe(false);
  });

  it('treats a missing body as empty rather than throwing', async () => {
    const out = await readCappedRequestText(new Request('http://x/', { method: 'POST' }), 512);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.text).toBe('');
  });

  it('caps on bytes, not characters, because bytes are what occupy the heap', async () => {
    // 40 characters, 120 bytes in UTF-8. A character-count cap of 64 would
    // have let this through at nearly double the intended memory.
    const multibyte = '這是測試'.repeat(10);
    expect(multibyte.length).toBe(40);
    expect(new TextEncoder().encode(multibyte).byteLength).toBe(120);
    expect((await readCappedRequestText(req(multibyte), 64)).ok).toBe(false);
  });
});

describe('no route reads a body without a cap', () => {
  // The fix is only as good as its adoption. A new route added later that
  // reaches for request.text() reintroduces exactly this bug, silently.
  const routes: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === 'route.ts') routes.push(p);
    }
  };
  walk(join(__dirname, '..', 'app'));

  it('finds the route files at all', () => {
    expect(routes.length).toBeGreaterThanOrEqual(7);
  });

  for (const path of routes) {
    it(`${path.split('/app/')[1]} uses the capped reader`, () => {
      const src = readFileSync(path, 'utf-8');
      // Strip comments first: this very guard is described in prose in several
      // of these files, and a guard that matches its own explanatory comment
      // has caught nothing. That mistake has been made twice in this repo.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(code).not.toMatch(/\brequest\.text\(\)/);
      expect(code).not.toMatch(/\brequest\.json\(\)/);
      if (/\bPOST\b/.test(code) && /readCappedRequestText|MAX_BODY|MAX_REQUEST_BODY/.test(code)) {
        expect(code).toContain('readCappedRequestText');
      }
    });
  }
});
