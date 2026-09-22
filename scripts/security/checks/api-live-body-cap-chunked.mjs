/**
 * Does the live API stop READING an oversized chunked body, or drain it first?
 *
 * ## What this check got wrong before, and why it is worth writing down
 *
 * The previous version found the right fact and drew the wrong conclusion. It
 * established that the Apache cap cannot fire on a chunked request — true,
 * `<If "%{HTTP:Content-Length} -gt ...">` has nothing to compare — then sent
 * 1.1 MB, received a 413 from Node, and graded the result `low` with the
 * sentence "The app-side caps are what actually bind today and they are
 * correct."
 *
 * They were not correct. The app-side cap was:
 *
 *     const declared = Number(request.headers.get('content-length'));
 *     if (declared > MAX_BODY) return 413;   // skipped: chunked sends none
 *     const text = await request.text();     // unbounded
 *     if (text.length > MAX_BODY) return 413; // after the fact
 *
 * A 413 came back, so the check called it a refusal and stopped. But the 413
 * arrives AFTER `request.text()` has buffered whatever was sent. At 1.1 MB
 * that is survivable, which is exactly why probing with 1.1 MB produced a
 * reassuring answer. At 300 MB, against the 448 MB heap the service runs with,
 * it is an OOM from a single unauthenticated request — measured in process on
 * 2026-09-21, heap 7 MB -> 305 MB.
 *
 * The lesson is about the probe, not the route: a size chosen to be polite
 * cannot distinguish "refused" from "refused too late". So this version does
 * not grade the status code. It counts how many bytes the server was willing
 * to ACCEPT before answering, which separates the two directly.
 *
 * ## Why it is now safe to run on a schedule
 *
 * It was gated because it sent real volume at a 2 vCPU box that also serves
 * the team's WordPress. With a streaming cap in place the server stops reading
 * at the cap and resets, so the probe offers a large body and almost none of
 * it crosses the wire. If the cap is ever removed the probe does become
 * expensive — which is the one case where it should be, and it is bounded at
 * MAX_OFFER below.
 */
import { check, finding, Skip } from '../lib/harness.mjs';

/**
 * Offered, not sent. A correct server reads ~512 bytes of this and resets.
 * Deliberately larger than any plausible route cap and far smaller than the
 * heap, so a failing server is embarrassed rather than damaged.
 */
const MAX_OFFER = 24 * 1024 * 1024;
/** Above the largest route cap (2 KB on /event) with room to spare. */
const ACCEPTABLE_ACCEPTED_BYTES = 256 * 1024;

export default check({
  id: 'live-body-cap-chunked',
  discipline: 'api',
  cadence: 'nightly',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'A chunked body with no Content-Length stops being READ at the cap, rather than being drained and refused afterwards.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    // /dns-leak/result: smallest cap (512 bytes), fetches nothing, needs no
    // proof-of-work — which is also what made it the cheapest way in.
    const target = `${ctx.apiBase}/dns-leak/result`;

    // Count what the producer is actually asked for. This is the measurement:
    // a streaming cap stops pulling, an unbounded read drains to the end.
    const state = { produced: 0, closed: false };
    const chunk = new TextEncoder().encode('a'.repeat(64 * 1024));
    const body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"id":"')); state.produced += 7; },
      pull(c) {
        if (state.produced >= MAX_OFFER) { state.closed = true; return c.close(); }
        state.produced += chunk.length;
        c.enqueue(chunk);
      },
    });

    const started = Date.now();
    const res = await ctx.http(target, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.origin },
      body,
      duplex: 'half',
      timeoutMs: 30_000,
    });
    const ms = Date.now() - started;
    const accepted = state.produced;
    checked += 1;

    // A reset mid-upload is the SERVER STOPPING READING, which is the pass
    // condition here, not a failure to test. Grade it on bytes like any other.
    const reset = !res.ok && /reset|EPIPE|aborted|socket hang up/i.test(res.error || '');
    if (!res.ok && !reset) {
      throw new Skip(`the chunked upload did not complete against ${target}: ${res.error}`);
    }

    const status = res.ok ? res.status : 'connection reset';
    const refused = reset || res.status === 403 || res.status === 413;

    if (accepted > ACCEPTABLE_ACCEPTED_BYTES) {
      findings.push(finding({
        severity: 'critical',
        title: refused
          ? `The live API drained ${(accepted / 1048576).toFixed(1)} MB before refusing it`
          : `The live API accepted a ${(accepted / 1048576).toFixed(1)} MB chunked body`,
        detail:
          'The status code is not the question. This route caps the body at 512 bytes, so anything past roughly that should never be read at all. Bytes the server accepts are bytes it has allocated, and the service runs with --max-old-space-size=448: a body large enough to cross that is an out-of-memory kill from one request, on a route that requires no proof-of-work. systemd restarts the process, and a loop keeps it restarting. ' +
          (refused
            ? 'A 413 here means the refusal came after the buffering, which is the failure mode this check exists to tell apart from a real cap.'
            : 'Nothing refused it at all.') +
          ' Apache cannot cover this: its cap matches on Content-Length, and a chunked request does not send one, so the condition is skipped rather than triggered.',
        evidence: `POST ${target} chunked, no Content-Length, offered ${MAX_OFFER} bytes => ${status} after ${ms}ms; the server accepted ${accepted} bytes before answering (a capped route should accept under ${ACCEPTABLE_ACCEPTED_BYTES})`,
        remediation:
          'Read request bodies through readCappedRequestText (lib/request-body.ts), never request.text() or request.json(). It stops pulling at the cap and cancels the stream. tests/request-body-cap.test.ts and the route guard in the same file keep it that way.',
        file: 'app/dns-leak/result/route.ts',
        line: 74,
      }));
      return { findings, checked };
    }

    if (!refused) {
      findings.push(finding({
        severity: 'high',
        title: 'A chunked body was neither capped nor refused',
        detail: `The server accepted only ${accepted} bytes, so memory is not at risk, but it answered ${status} rather than refusing an over-cap body. Something is truncating the request before the route sees it, and whatever that is has not been identified — an unexplained pass is not a pass.`,
        evidence: `POST ${target} chunked => ${status} after ${ms}ms, ${accepted} bytes accepted`,
        remediation: 'Identify what closed the stream. If it is a proxy timeout rather than the body cap, the cap is still untested on this path.',
        file: 'API-ON-DROPLET.md',
        line: 180,
      }));
    }

    return { findings, checked };
  },
});
