/**
 * Does Apache still refuse an oversized body before it reaches Node?
 *
 * Added on the reviewer's point, and this one is a documented regression trap
 * rather than a hypothetical. API-ON-DROPLET.md:291-298 records that
 * `LimitRequestBody` is SILENTLY INERT for reverse-proxied requests — set to
 * 1 MiB in two places, a 1.5 MB POST still reached Node and was answered 200,
 * taking 1.3 s against 14 ms for a small body, so the whole body crossed the
 * wire. `RewriteRule … [R=413]` does not fire either, because ProxyPass claims
 * the request in translate_name before mod_rewrite runs. Only the vhost-level
 * `<If "%{HTTP:Content-Length} -gt 1048576">` block actually works.
 *
 * The runbook then says: "Do not restore the tidier-looking directives." That
 * sentence exists because the working form looks wrong and the broken form
 * looks right, so someone, eventually, will tidy it. When they do, every byte
 * of an oversized body reaches the Node process on a 768M cap, and nothing
 * anywhere would notice — the tidier config passes `apache2ctl configtest`
 * exactly as happily.
 *
 * One request per run, 1.1 MB, refused at the vhost before it is proxied.
 * That is less work for the box than a single real page load, and it spends no
 * scan budget: /api/ip has no proof-of-work, no counters and no side effects.
 *
 * Deliberately NOT flagged: a 429. The /ip route is rate limited like the rest,
 * and a limiter doing its job must not be reported as a missing body cap —
 * that is reported as a skip, because nothing was observed either way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

export default check({
  id: 'rasp-apache-body-cap',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The vhost still refuses >1 MiB bodies to /api/ before proxying them into the 768M-capped Node process.',
  async run(ctx) {
    const cfg = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/rasp-baseline.json'), 'utf-8')).apache;
    const findings = [];
    let checked = 0;

    // First a normal body, so a failure of the big one can be told apart from
    // the route simply being down. Without this, "refused" and "broken" look
    // identical and the check would report the wrong thing.
    const small = await ctx.http(`${ctx.apiBase}${cfg.probePath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.origin },
      body: '{}',
      timeoutMs: 15_000,
    });
    checked++;
    if (!small.ok) throw new ctx.Skip(`POST ${ctx.apiBase}${cfg.probePath} (small body) did not complete: ${small.error}`);
    if (small.status === 429) throw new ctx.Skip(`POST ${cfg.probePath} → 429: rate limited, so the body cap was not probed`);
    if (small.status !== 200) {
      findings.push(finding({
        severity: 'medium',
        title: `${cfg.probePath} answered ${small.status} to an ordinary request`,
        detail: 'The control probe failed, so the oversized-body probe below cannot be interpreted. Reported rather than skipped, because a route that should answer 200 and does not is itself worth knowing about.',
        evidence: `POST ${ctx.apiBase}${cfg.probePath} body "{}" → ${small.status} ${small.text.slice(0, 120)}`,
        remediation: 'journalctl -u ib-api -n 50 --no-pager; curl the route by hand.',
      }));
      return { findings, checked };
    }

    // 1.1 MiB: just over the 1 MiB cap, small enough that a box serving
    // WordPress will not notice. Valid JSON so that, if it does get through,
    // the failure is unambiguously the cap and not a parse error.
    const oversize = 1_100_000;
    const body = `{"pad":"${'a'.repeat(oversize)}"}`;
    const t0 = Date.now();
    const big = await ctx.http(`${ctx.apiBase}${cfg.probePath}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ctx.origin },
      body,
      timeoutMs: 30_000,
    });
    const ms = Date.now() - t0;
    checked++;

    if (!big.ok) {
      // A connection reset mid-upload is ALSO Apache refusing, and is a pass in
      // substance. Reported as info so the run still shows what happened.
      findings.push(finding({
        severity: 'info',
        title: 'The oversized POST was cut off rather than answered',
        detail: 'A refused or reset upload is the server declining to take the body, which is the desired outcome — but it is not a status code, so it is recorded rather than graded.',
        evidence: `POST ${ctx.apiBase}${cfg.probePath} with a ${body.length}-byte body → ${big.error} after ${ms}ms`,
        remediation: 'None if this is consistent. If it is new, check the vhost <If> block by hand.',
      }));
      return { findings, checked };
    }

    if (!cfg.refusedStatuses.includes(big.status)) {
      findings.push(finding({
        severity: big.status === 200 ? 'high' : 'medium',
        title: `A ${body.length}-byte body to ${cfg.probePath} was answered ${big.status}, not refused`,
        detail: big.status === 200
          ? 'The whole oversized body crossed the wire and was processed by the Node service. This is exactly the state API-ON-DROPLET.md:291-298 documents for the inert LimitRequestBody/RewriteRule forms — the vhost <If Content-Length> block is gone or no longer matching, and an attacker can now push unbounded bytes into a process capped at 768M.'
          : 'The oversized body was neither refused by Apache nor answered by one of the expected statuses, so the cap’s behaviour is not what the runbook records.',
        evidence: `POST ${ctx.apiBase}${cfg.probePath} Content-Length=${body.length} → ${big.status} in ${ms}ms (a 2-byte body to the same route answered ${small.status}); expected one of ${cfg.refusedStatuses.join('/')}`,
        remediation: 'Restore in the :443 vhost, before </VirtualHost>: <If "%{HTTP:Content-Length} -gt 1048576 && %{REQUEST_URI} =~ m#^/api/#"> Require all denied </If>. Do NOT use LimitRequestBody or RewriteRule — both are inert here.',
      }));
    }

    return { findings, checked };
  },
});
