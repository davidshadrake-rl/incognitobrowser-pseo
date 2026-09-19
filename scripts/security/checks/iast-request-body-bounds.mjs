/**
 * Does any route buffer a request body before it is allowed to?
 *
 * Every body-reading route here follows the same shape: check the declared
 * Content-Length against a cap, then `await request.text()`, then check the
 * length again. The first check is the only one that runs BEFORE the bytes are
 * pulled, and it is the one a caller can simply not send — a chunked POST
 * carries no Content-Length. The documented compensating control, the vhost
 * `<If "%{HTTP:Content-Length} -gt 1048576">` block in API-ON-DROPLET.md, has
 * the same hole for the same reason: the expression is false when the header
 * is absent.
 *
 * Measured as ORDER, not as memory. Heap deltas are the obvious thing to
 * assert and they flake on a shared runner, so instead the request body is a
 * stream that counts the bytes the route actually pulled. "Was the cap checked
 * before or after the body was buffered" then has a number as its answer.
 *
 * Why this matters on this box specifically: ib-api runs under MemoryMax=768M
 * with --max-old-space-size=448, and the kernel's OOM killer on that droplet
 * picks MySQL, which takes the team's WordPress down with it and does not
 * bring it back.
 *
 * Deliberately NOT flagged: the first 64 KiB. undici pulls one chunk from a
 * streaming body as soon as the Request exists, whether or not the handler
 * ever reads it — /dns-leak/start, which reads no body at all, shows exactly
 * that one chunk. So the signal is "pulled the WHOLE body", not "pulled
 * anything": a route that awaits request.text() on a 2 MiB stream drains all
 * of it, and a route that refuses first does not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './iast-probe.mjs';

export default check({
  id: 'iast-request-body-read-after-size-check',
  discipline: 'iast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Posts a 2 MiB chunked body to every route and counts the bytes each one pulled before answering.',
  async run(ctx) {
    const obs = await observe();
    const rows = obs.body || [];
    if (!rows.length) throw new Skip('the probe produced no body-bound observations');

    let decisions = { accepted: [] };
    try {
      decisions = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/iast-body-bound-decisions.json'), 'utf-8'));
    } catch (err) {
      throw new Skip(`cannot read the accepted-risk list: ${err.message}`);
    }
    const accepted = new Map((decisions.accepted || []).map((d) => [d.route, d]));

    const findings = [];

    // Part one: the header path. Every route should refuse an oversized
    // declared length without draining the body. This is the control that IS
    // implemented, and it is worth pinning so it cannot quietly regress into
    // "checked after the read", which is what /event, /stats, /scan-url and
    // /dns-leak/result each did before 2026-09-18.
    for (const row of rows.filter((r) => r.mode === 'declared')) {
      if (row.bytesPulled >= row.sent) {
        findings.push(finding({
          severity: 'medium',
          title: `${row.route} buffers the whole body despite an oversized Content-Length`,
          detail: 'The declared-length check is the only bound that can run before the bytes are pulled. If the whole body is drained anyway, the cap governs what is accepted rather than what is allocated — which is the state every one of these routes was in before 2026-09-18.',
          evidence: `POST ${row.route} with Content-Length: ${row.sent} → HTTP ${row.status}, ${row.bytesPulled} of ${row.sent} bytes pulled from the body stream`,
          remediation: 'Check content-length before awaiting request.text().',
        }));
      }
    }

    // Part two: the chunked path, where no header exists to check.
    const unbounded = [];
    for (const row of rows.filter((r) => r.mode === 'chunked')) {
      if (row.bytesPulled < row.sent) continue; // did not buffer the whole body
      if (accepted.has(row.route)) continue;    // an owner decision, recorded in the data file
      unbounded.push(row);
    }

    if (unbounded.length) {
      // One finding, not one per route: it is a single design property with
      // the same fix, and four copies of the same paragraph is how a report
      // gets skimmed. The evidence names every route and its number so any of
      // them can be re-checked by hand.
      const headline = unbounded.find((r) => r.route === '/dns-leak/result') || unbounded[0];
      const lines = unbounded.map((r) => `${r.route} (cap ${r.cap} bytes, gate: ${r.gate}) → HTTP ${r.status} after pulling ${r.bytesPulled} of ${r.sent} bytes`);
      findings.push(finding({
        severity: 'medium',
        title: `${unbounded.length} routes buffer an entire chunked request body before refusing it`,
        detail: `A POST with no Content-Length is read in full and only then measured against a cap of a few hundred bytes. The Apache <If "%{HTTP:Content-Length} -gt 1048576"> block cannot stop it — the expression is false when the header is absent — so nothing bounds the allocation but the service's own memory ceiling. The cheapest one is ${headline.route}: ${headline.gate}. Repeated concurrently this is a memory-exhaustion path on a 768M-capped process sharing a box with MySQL and WordPress.`,
        evidence: lines.join(' ; '),
        remediation: 'Either read the body as a stream and abort past the cap instead of awaiting request.text(), or record the decision and its compensating control in scripts/security/data/iast-body-bound-decisions.json.',
      }));
    }

    // A route that was refusing on the header and no longer does is a
    // regression worth naming separately from the chunked question.
    for (const row of rows.filter((r) => r.mode === 'declared' && r.cap !== null)) {
      if (row.status !== 413 && row.status !== 401 && row.status !== 403) {
        findings.push(finding({
          severity: 'low',
          title: `${row.route} answered ${row.status} to a 2 MiB declared body`,
          detail: 'Expected an explicit refusal (413, or an auth refusal ahead of it). Anything else suggests the size check moved or stopped applying.',
          evidence: `POST ${row.route} with Content-Length: ${row.sent} → HTTP ${row.status}, ${row.bytesPulled} bytes pulled`,
        }));
      }
    }

    return { findings, checked: rows.length };
  },
});
