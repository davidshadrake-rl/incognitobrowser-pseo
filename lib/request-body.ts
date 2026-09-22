/**
 * Read a request body with a cap that binds BEFORE the bytes are resident.
 *
 * ## Why this file exists
 *
 * Every POST route used to do this:
 *
 *     const declared = Number(request.headers.get('content-length'));
 *     if (declared > MAX_BODY) return 413;      // cheap pre-check
 *     const text = await request.text();        // <-- unbounded
 *     if (text.length > MAX_BODY) return 413;   // too late
 *
 * The comment above it called the post-read check "the one that actually
 * binds". It does bind what is ACCEPTED. It does not bind what is ALLOCATED,
 * and allocation is the thing an attacker is buying.
 *
 * A chunked request carries no Content-Length at all — `Transfer-Encoding:
 * chunked` and the header is simply absent — so the pre-check reads null,
 * `Number(null)` is 0, `0 > MAX_BODY` is false, and the fast path is skipped
 * rather than triggered. Measured on 2026-09-21, in process, against a real
 * Request built on a 300MB chunked stream:
 *
 *     content-length the route would read: null
 *     request.text() returned 300MB; heap 7MB -> 305MB
 *
 * The API runs with --max-old-space-size=448. So one POST, of one request,
 * with no proof-of-work required on /event, /stats or /dns-leak/result, puts
 * the process into OOM; systemd restarts it, and a loop keeps it restarting.
 * That is a single-packet denial of service on the exact axis this deployment
 * was most worried about, and it sat behind a comment asserting it was handled.
 *
 * Apache's cap missed it for the same reason: `<If "%{HTTP:Content-Length}
 * -gt ...">` cannot match a header that was never sent. That is now
 * LimitRequestBody, which applies to chunked bodies too — but an edge
 * directive is one config edit away from being gone, so the process bounds
 * itself here regardless.
 *
 * ## The rule
 *
 * Never call `request.text()` or `request.json()` in a route handler. Read
 * through this function. It stops pulling at the cap, cancels the stream, and
 * never holds more than the cap plus one chunk.
 *
 * NextRequest extends the Web Request API (node_modules/next/dist/docs/
 * 01-app/04-api-reference/.../next-request.md), so `request.body` is a plain
 * ReadableStream and this needs nothing Next-specific.
 */

export type CappedBody =
  | { ok: true; text: string }
  | { ok: false; reason: 'too-large' };

/**
 * Read at most `maxBytes` of the body, then stop.
 *
 * Capped on BYTES, not characters: bytes are what occupy the heap, and a
 * multi-byte body would otherwise pass a character-count check while costing
 * up to four times the memory. For the ASCII JSON these routes accept the two
 * are the same number.
 *
 * Returns `{ok: false}` the moment the stream offers more than the cap. The
 * caller turns that into a 413; it does not get a truncated body to guess at,
 * because a half-read JSON document is not a smaller request, it is a
 * different one.
 */
export async function readCappedRequestText(
  request: Request,
  maxBytes: number,
): Promise<CappedBody> {
  // A declared length over the cap is refused without reading a byte. This is
  // an optimisation, not the control — Content-Length can lie, and chunked
  // omits it — so the streaming cap below is what actually holds.
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, reason: 'too-large' };

  if (!request.body) {
    // No body at all. Not an error: GET-shaped POSTs and empty bodies are the
    // caller's business, and an empty string parses as invalid JSON downstream
    // exactly as it did before.
    return { ok: true, text: '' };
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let received = 0;
  let out = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        // Over the cap. Stop pulling and discard what we have — see the note
        // above on why a truncated body is not returned.
        try { await reader.cancel(); } catch { /* the peer is gone; nothing to do */ }
        return { ok: false, reason: 'too-large' };
      }
      out += decoder.decode(value, { stream: true });
    }
    out += decoder.decode();
  } finally {
    try { reader.releaseLock(); } catch { /* already released by cancel() */ }
  }
  return { ok: true, text: out };
}
