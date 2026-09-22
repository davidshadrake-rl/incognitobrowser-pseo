/**
 * Through the real stack: is an over-cap chunked body REFUSED? And nothing more
 * than that, because nothing more than that is visible from here.
 *
 * ## This check has now been wrong in both directions, which is the lesson
 *
 * First it was too generous. It correctly established that Apache's cap
 * (`<If "%{HTTP:Content-Length} -gt ...">`) cannot fire on a chunked request —
 * there is no header to compare — then sent 1.1 MB, got a 413, and graded the
 * result `low` with the sentence "The app-side caps are what actually bind
 * today and they are correct". They were not. The 413 arrived AFTER an
 * unbounded request.text() had buffered the body. At 1.1 MB that is
 * survivable, which is exactly why a polite probe produced a reassuring
 * answer; at 300 MB against a 448 MB heap it is an OOM kill from one
 * unauthenticated request.
 *
 * Then it was too harsh. Rewritten to count bytes instead of status codes, it
 * reported `critical` against a build where the bug was already fixed —
 * because the number it counted was bytes the CLIENT produced, and Apache
 * drains a client's request body regardless of what the backend does with it.
 * Measured 2026-09-22: ib-api refused a 24 MB chunked body immediately, and
 * the client still uploaded all 24 MB and still waited 7.7s for the answer.
 *
 * Both mistakes have the same root. From outside Apache, a service that
 * buffers the whole body and a service that refuses after 512 bytes are
 * INDISTINGUISHABLE — same status, same timing, same bytes on the wire. No
 * cleverness in this file changes that. So this check no longer pretends to
 * measure memory safety. It measures the one thing the edge can honestly
 * report — was the request refused — and the process-level guarantee is
 * measured where it is actually visible, next to the process, by
 * rasp-api-body-cap-process.
 *
 * ## Why the edge cannot be fixed here
 *
 * LimitRequestBody is silently inert for reverse-proxied requests; it was
 * tried in <Location /api/> and a 1.5 MB POST still reached Node (recorded in
 * the vhost at /etc/apache2/sites-enabled/000-default-le-ssl.conf:55). So
 * Apache will absorb the bandwidth of a large chunked upload whatever the
 * route does. That is a volumetric concern, decided upstream of this box, and
 * it is not something the application can close.
 */
import { check, finding, Skip } from '../lib/harness.mjs';

/** Comfortably over every route cap (the largest is 2 KB) and cheap to send. */
const OFFER_BYTES = 3 * 1024 * 1024;

export default check({
  id: 'live-body-cap-chunked',
  discipline: 'api',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'Through Apache, an over-cap chunked body with no Content-Length is refused rather than accepted on its merits.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    // /dns-leak/result: smallest cap (512 bytes), fetches nothing, and needs
    // no proof-of-work — which is what made it the cheapest way in.
    const target = `${ctx.apiBase}/dns-leak/result`;

    const chunk = new TextEncoder().encode('a'.repeat(64 * 1024));
    let produced = 0;
    const body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('{"id":"')); produced += 7; },
      pull(c) {
        if (produced >= OFFER_BYTES) return c.close();
        produced += chunk.length;
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
    checked += 1;

    // A reset mid-upload is the server declining to keep reading, which is a
    // refusal. Grade it as one rather than reporting a failure to test.
    const reset = !res.ok && /reset|EPIPE|aborted|socket hang up/i.test(res.error || '');
    if (!res.ok && !reset) {
      throw new Skip(`the chunked upload did not complete against ${target}: ${res.error}`);
    }

    const status = res.ok ? res.status : 'connection reset';
    // 502 is a refusal here: the route answers 413 and closes while Apache is
    // still reading the body, and Apache reports the early close as 502.
    const refused = reset || res.status === 403 || res.status === 413 || res.status === 502;

    if (!refused) {
      findings.push(finding({
        severity: 'high',
        title: `An over-cap chunked body was accepted by the live API (${status})`,
        detail:
          `This route caps the request body at 512 bytes and ${OFFER_BYTES} bytes were offered with no Content-Length, so it must be refused. It was not. Apache cannot help on this path — its cap matches a header a chunked request does not send, and LimitRequestBody is inert for proxied requests — so the route's own streaming cap is the only control, and this says it is not running. The likeliest cause is a deployed build older than the source.`,
        evidence: `POST ${target} chunked, no Content-Length, ${OFFER_BYTES} bytes offered => ${status} after ${ms}ms ${JSON.stringify(res.json || res.text).slice(0, 120)}`,
        remediation:
          'Redeploy the API and confirm the build actually rebuilt (scripts/deploy-api.sh). Then re-run this check, and rasp-api-body-cap-process for the memory question this one cannot answer.',
        file: 'app/dns-leak/result/route.ts',
        line: 74,
      }));
      return { findings, checked };
    }

    // Refused. Say plainly what this did and did not establish, so nobody
    // reads a green tick here as "the process is safe" — the exact inference
    // that let the original bug survive a passing check.
    findings.push(finding({
      severity: 'info',
      title: `Refused (${status}) — memory safety is NOT established by this check`,
      detail:
        'The request was refused, which is what the edge can tell us. It does not show whether the process buffered the body first: Apache drains the client regardless of what the backend does, so a buffering route and a streaming one look identical from outside. rasp-api-body-cap-process measures VmRSS next to the process and is the check that answers that. Separately, the bandwidth of the upload is spent either way — Apache absorbs it, LimitRequestBody cannot stop it for a proxied request, and that is a volumetric problem decided upstream of this box.',
      evidence: `POST ${target} chunked, ${OFFER_BYTES} bytes offered => ${status} after ${ms}ms`,
      remediation: 'None here. Keep rasp-api-body-cap-process in the nightly run; it is the one with the answer.',
      file: 'scripts/security/checks/rasp-api-body-cap-process.mjs',
      line: 1,
    }));

    return { findings, checked };
  },
});
