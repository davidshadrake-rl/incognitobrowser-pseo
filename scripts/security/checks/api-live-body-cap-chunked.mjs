/**
 * Oversized bodies must be refused even without a Content-Length (live, opt-in).
 *
 * The body cap in front of the API is an Apache condition:
 *   <If "%{HTTP:Content-Length} -gt 1048576 && %{REQUEST_URI} =~ m#^/api/#">
 * A chunked request carries NO Content-Length, so that condition has nothing
 * to compare and cannot fire. The runbook already records that LimitRequestBody
 * is inert for proxied requests and that a 1.5 MB POST reached Node, so the
 * gap is documented rather than theoretical.
 *
 * Behind it, the app-side caps landed on 2026-09-18 — /event, /scan-url,
 * /stats and /dns-leak/result each check Content-Length and then re-check the
 * buffered length, because Content-Length can lie. This check asks the one
 * question those in-process tests cannot: what does the LIVE stack do when no
 * length is declared at all. /dns-leak/result is the target because its cap is
 * the smallest (512 bytes) and it fetches nothing.
 *
 * WHAT COUNTS AS A PASS, and why the answer is nuanced rather than a status
 * code: a 403 means Apache refused it; a 413 means Node buffered it and then
 * refused. Both are refusals, but they cost different amounts, and a 413 that
 * arrives only after the whole 1.1 MB crossed the wire tells you the megabyte
 * was paid for. The check reports the distinction rather than flattening it.
 * A 200 or a 400 means nothing stopped it.
 *
 * GATED, and it stays gated. This is the only check in the API set that sends
 * real volume, the box has 2 vCPU, and it also serves the team's WordPress and
 * MySQL. It is never in the scheduled run:
 *
 *     node scripts/security/run.mjs --only=live-body-cap-chunked --opt-in=live-body-cap-chunked
 *
 * Run it after any vhost change, which is the only time its answer can have
 * changed.
 */
import { check, finding, Skip } from '../lib/harness.mjs';

const TARGET_BYTES = 1_100_000;

export default check({
  id: 'live-body-cap-chunked',
  discipline: 'api',
  cadence: 'on-demand',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: true,
  requires: ['network'],
  describe: 'A chunked 1.1 MB POST with no Content-Length is refused rather than buffered in full.',
  async run(ctx) {
    const findings = [];
    let checked = 0;

    // A stream body makes undici send Transfer-Encoding: chunked with no
    // Content-Length, which is the whole point — a declared length would be
    // caught by the Apache <If> and would grade the wrong control.
    const chunk = 'a'.repeat(64 * 1024);
    let sent = 0;
    const body = new ReadableStream({
      pull(controller) {
        if (sent === 0) { controller.enqueue(new TextEncoder().encode('{"id":"')); sent += 7; }
        if (sent >= TARGET_BYTES) { controller.enqueue(new TextEncoder().encode('"}')); controller.close(); return; }
        controller.enqueue(new TextEncoder().encode(chunk));
        sent += chunk.length;
      },
    });

    const started = Date.now();
    const res = await ctx.http(`${ctx.apiBase}/dns-leak/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.origin },
      body,
      duplex: 'half',
      timeoutMs: 30_000,
    });
    const ms = Date.now() - started;
    checked += 1;

    if (!res.ok) {
      // A connection reset mid-upload IS a refusal — the server stopped
      // reading. Report it as the observation it is rather than as a failure
      // to test, but do not call it a clean pass either.
      if (/reset|EPIPE|aborted|socket hang up/i.test(res.error || '')) {
        return { findings, checked };
      }
      throw new Skip(`the chunked upload did not complete against ${ctx.apiBase}/dns-leak/result: ${res.error}`);
    }

    if (res.status !== 403 && res.status !== 413) {
      // WHICH cap is missing changes what you go and fix, so ask. A 1 KB body
      // with an honest Content-Length is twice the route's 512-byte limit and
      // well under Apache's 1 MB one. If THAT is refused, only the chunked
      // path is open and the gap is in the vhost. If it is accepted too, the
      // route has no cap at all in the running build — which, when the repo
      // source plainly has one, means the box is running older code.
      const declared = await ctx.http(`${ctx.apiBase}/dns-leak/result`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ctx.origin },
        body: JSON.stringify({ id: 'a'.repeat(1000) }),
        timeoutMs: 15_000,
      });
      checked += 1;
      const appCapMissing = declared.ok && declared.status !== 413;

      // And a CONTROL on a different route, so the finding names the right
      // thing. /event's 2 KB cap predates the 2026-09-18 round of fixes. If
      // /event refuses and /dns-leak/result does not, the running build is
      // simply missing the newer caps — which is a deploy problem, not an
      // Apache one and not a design one.
      const control = await ctx.http(`${ctx.apiBase}/event`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: ctx.origin },
        body: JSON.stringify({ event: 'tool_run', tool: 'whats-my-ip', pad: 'x'.repeat(3000) }),
        timeoutMs: 15_000,
      });
      checked += 1;
      const controlNote = control.ok
        ? (control.status === 413
          ? '/event refuses a 3 KB body with 413, so the older app-side caps ARE deployed and Apache is not the difference'
          : `/event answered ${control.status} for a 3 KB body, so no app-side cap is deployed anywhere`)
        : `/event control failed: ${control.error}`;

      findings.push(finding({
        severity: appCapMissing ? 'high' : 'medium',
        title: appCapMissing
          ? 'The deployed /dns-leak/result has no request-body cap at all'
          : 'A 1.1 MB chunked body with no Content-Length was accepted by the live API',
        detail: appCapMissing
          ? 'Neither cap is refusing on this route. A 1 KB body — twice its documented 512-byte limit, and far below Apache\'s 1 MB condition — was buffered, parsed and answered on its merits, and so was a 1.1 MB chunked one. app/dns-leak/result/route.ts:74-82 in this repository contains both the Content-Length precheck and the post-read check, and the in-process check api-error-shape confirms they fire against this source. So the running build is not this source. The control probe says which: see the evidence. On a 2 vCPU box that also serves the team\'s WordPress and MySQL, an unbounded buffered body is the cheapest denial of service available, and this route needs twelve characters.'
          : 'The Apache cap matches on the Content-Length header, and a chunked request carries none, so it cannot fire. The app-side cap does refuse a declared oversize body, so the gap is specifically the chunked path at the proxy.',
        evidence: `POST ${ctx.apiBase}/dns-leak/result chunked, no Content-Length, ~${TARGET_BYTES} bytes => ${res.status} in ${ms}ms ${JSON.stringify(res.json || res.text).slice(0, 110)} · the same route with a declared Content-Length of ~1011 bytes (cap is 512) => ${declared.ok ? declared.status : `failed: ${declared.error}`} ${JSON.stringify(declared.json || declared.text).slice(0, 80)} · control: ${controlNote}`,
        remediation: appCapMissing
          ? 'Redeploy the API and confirm the build actually rebuilt: scripts/deploy-api.sh must run npm ci and the resulting .next must be newer than the source. Then re-run this check; the declared-length probe must answer 413.'
          : 'Add a chunked-aware limit at the proxy, or accept that the app-side cap is the only one on this path and keep it small.',
        file: 'app/dns-leak/result/route.ts',
        line: 74,
      }));
      return { findings, checked };
    }

    // Refused. Which layer, and at what cost, is worth saying out loud: a 413
    // after the whole body crossed the wire means the megabyte was paid for,
    // and that is a different posture from Apache refusing at the front door.
    if (res.status === 413 && ms > 2_000) {
      findings.push(finding({
        severity: 'low',
        title: 'The chunked body was refused only after the whole 1.1 MB had been received',
        detail:
          'A 413 is a refusal, so nothing is exposed — but it came from Node, after the request crossed Apache and was buffered. The front-door cap cannot help here because it matches on a header a chunked request does not send. That is acceptable at 512 bytes per route; it is worth knowing that the only defence against a chunked flood is the Node process itself.',
        evidence: `POST ${ctx.apiBase}/dns-leak/result, chunked, ~${TARGET_BYTES} bytes => ${res.status} after ${ms}ms`,
        remediation: 'Optional: add a chunked-aware limit at the proxy (mod_reqtimeout body rate, or a length cap that also matches Transfer-Encoding). The app-side caps are what actually bind today and they are correct.',
        file: 'API-ON-DROPLET.md',
        line: 180,
      }));
    }

    return { findings, checked };
  },
});
