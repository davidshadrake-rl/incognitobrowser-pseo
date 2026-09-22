/**
 * Does the API PROCESS stay bounded when a chunked body arrives? Measured on
 * the box, against the process, because it cannot be seen from anywhere else.
 *
 * ## Why this check had to exist separately
 *
 * live-body-cap-chunked probes through Apache from a laptop, and there is a
 * hard limit on what that can tell you: Apache reads the client's request body
 * whatever the backend does with it. When ib-api refused a 24 MB chunked body
 * instantly, the client STILL uploaded all 24 MB and still waited 7.7s for the
 * answer, because Apache drained it before replying. From outside, a service
 * that buffers 24 MB and a service that refuses after 512 bytes look identical.
 *
 * That blind spot is not academic. It is exactly where the real bug lived:
 *
 *   const declared = Number(request.headers.get('content-length'));
 *   if (declared > MAX_BODY) return 413;   // chunked sends none, so skipped
 *   const text = await request.text();     // unbounded
 *   if (text.length > MAX_BODY) return 413; // after it is already resident
 *
 * A 413 came back, so an external probe called it refused. It was refused
 * AFTER the allocation. 300 MB into a 448 MB heap, from one unauthenticated
 * request, on a route with no proof-of-work. The status code was never the
 * question; resident bytes were.
 *
 * So this check asks the process directly: hold the offer against
 * 127.0.0.1:3100, with Apache out of the path entirely, and watch VmRSS.
 *
 * ## Why 64 MB and not 300
 *
 * 300 MB is what it takes to actually kill the service. A check that proves
 * the bug by CAUSING the outage has not tested production, it has taken it
 * down — and this box also serves the team's WordPress and MySQL. 64 MB is far
 * above any route cap (the largest is 2 KB) so a buffering route shows an
 * unmistakable RSS jump, and far below the 448 MB heap so a broken build is
 * embarrassed rather than killed. The finding says plainly that the real
 * ceiling is lower than the damage threshold.
 */
import { check, finding } from '../lib/harness.mjs';

const OFFER_MB = 64;
/** Anything above this means the body was held, not streamed past. */
const RSS_GROWTH_LIMIT_MB = 24;

export default check({
  id: 'rasp-api-body-cap-process',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'critical',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: `A ${OFFER_MB}MB chunked body sent straight at the Node process does not become resident memory.`,
  async run(ctx) {
    const findings = [];
    let checked = 0;

    // One ssh round trip: everything is measured next to the process, because
    // sampling RSS from here would race the request.
    const out = ctx.ssh(`
      PID=$(systemctl show -p MainPID --value ib-api)
      [ "$PID" = "0" ] && { echo "UNIT_DOWN"; exit 0; }
      rss() { awk '/VmRSS/{print $2}' /proc/$PID/status 2>/dev/null || echo 0; }
      BEFORE=$(rss)
      RESTARTS_BEFORE=$(systemctl show -p NRestarts --value ib-api)
      # Chunked: no Content-Length, which is the whole point. Straight at Node,
      # so Apache cannot mask the answer by draining on the process's behalf.
      CODE=$(head -c ${OFFER_MB * 1024 * 1024} /dev/zero | tr '\\0' 'a' \\
        | curl -s -o /dev/null -w '%{http_code}' --max-time 45 \\
            -X POST http://127.0.0.1:3100/dns-leak/result \\
            -H 'content-type: application/json' \\
            -H 'origin: ${ctx.origin}' \\
            -H 'Transfer-Encoding: chunked' --data-binary @- 2>/dev/null)
      PEAK=$(rss)
      sleep 1
      AFTER=$(rss)
      echo "PID=$PID CODE=$CODE BEFORE=$BEFORE PEAK=$PEAK AFTER=$AFTER RESTARTS_BEFORE=$RESTARTS_BEFORE RESTARTS_AFTER=$(systemctl show -p NRestarts --value ib-api) PID_AFTER=$(systemctl show -p MainPID --value ib-api)"
    `, { timeoutMs: 120_000 });

    checked += 1;
    const text = String(out).trim();
    if (text.includes('UNIT_DOWN')) {
      findings.push(finding({
        severity: 'high',
        title: 'ib-api is not running, so its body cap could not be measured',
        detail: 'The unit reported MainPID 0. Whatever else is true, the API is down.',
        evidence: text.slice(0, 200),
        remediation: 'systemctl status ib-api, and journalctl -u ib-api -n 100.',
        file: 'API-ON-DROPLET.md',
        line: 1,
      }));
      return { findings, checked };
    }

    const f = Object.fromEntries(
      [...text.matchAll(/(\w+)=(\S+)/g)].map((m) => [m[1], m[2]]),
    );
    const beforeMb = Number(f.BEFORE) / 1024;
    const peakMb = Number(f.PEAK) / 1024;
    const growthMb = peakMb - beforeMb;
    const restarted = f.RESTARTS_AFTER !== f.RESTARTS_BEFORE || f.PID_AFTER !== f.PID;

    if (restarted) {
      findings.push(finding({
        severity: 'critical',
        title: `The API process died while being offered a ${OFFER_MB}MB chunked body`,
        detail:
          'The pid or the restart counter changed across the probe, which means the request killed the service and systemd brought it back. This is the denial of service in its finished form: one request, no proof-of-work required on this route, and a loop keeps the API down. It also means the probe size is already past the survivable ceiling, so the real threshold is somewhere below ' + OFFER_MB + 'MB.',
        evidence: text,
        remediation: 'Read bodies through readCappedRequestText (lib/request-body.ts). Never request.text() or request.json() in a route handler.',
        file: 'lib/request-body.ts',
        line: 1,
      }));
      return { findings, checked };
    }

    if (growthMb > RSS_GROWTH_LIMIT_MB) {
      findings.push(finding({
        severity: 'critical',
        title: `A chunked body became ${growthMb.toFixed(0)}MB of resident memory in the API process`,
        detail:
          `This route caps the body at 512 bytes, so a ${OFFER_MB}MB offer should cost the process nothing — it should stop reading and cancel the stream. Instead RSS grew by ${growthMb.toFixed(0)}MB, which means the body is being buffered and only then measured. The status code does not redeem this: a 413 that arrives after the allocation has already been paid is not a refusal in any sense that matters. The service runs with --max-old-space-size=448, so a large enough body is an out-of-memory kill from a single unauthenticated request.`,
        evidence: `${text} · RSS ${beforeMb.toFixed(0)}MB -> ${peakMb.toFixed(0)}MB (+${growthMb.toFixed(0)}MB) while being offered ${OFFER_MB}MB`,
        remediation: 'Read bodies through readCappedRequestText (lib/request-body.ts), which stops pulling at the cap. tests/request-body-cap.test.ts covers the behaviour and a guard in the same file bans request.text() across every route.',
        file: 'lib/request-body.ts',
        line: 1,
      }));
      return { findings, checked };
    }

    if (f.CODE !== '413') {
      findings.push(finding({
        severity: 'medium',
        title: `An over-cap chunked body was answered ${f.CODE} rather than 413`,
        detail: `Memory stayed flat (+${growthMb.toFixed(0)}MB), so the process is not at risk. But the route is documented to refuse an over-cap body with 413, and it did not — which means either the cap is not what is stopping this, or something else answered first. An unexplained pass is not a pass.`,
        evidence: text,
        remediation: 'Confirm which layer produced this status. If the route never saw the request, the cap on this path is still untested.',
        file: 'app/dns-leak/result/route.ts',
        line: 74,
      }));
    }

    return { findings, checked };
  },
});
