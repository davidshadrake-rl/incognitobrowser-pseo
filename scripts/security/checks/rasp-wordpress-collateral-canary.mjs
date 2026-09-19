/**
 * Are the team's WordPress and both static sites still answering?
 *
 * This is the outcome the whole abuse-resistance design exists to prevent.
 * API-ON-DROPLET.md:274-275: "what these do guarantee is that the tools service
 * cannot take WordPress and MySQL down with it, which is what used to happen
 * under load." Everything else in this discipline checks a control; this checks
 * the consequence.
 *
 * scripts/deploy-api.sh:102-105 already asserts exactly these three paths — but
 * only at the moment of a deploy, when nothing is going on. Nothing looks at
 * 03:00, which is when a flood would be running, and the team would learn about
 * it from a person rather than from a check. Same three paths on purpose: one
 * list, not two that drift apart.
 *
 * Timing matters as much as status. MySQL under memory pressure gets slow well
 * before it gets 500s, so a page that still answers 200 four seconds late is
 * the early warning. The medians live in rasp-baseline.json (null until seeded
 * from a healthy run) and the observed times in rasp-runtime-state.json.
 *
 * Three unauthenticated GETs of pages Apache serves to the public anyway. No
 * measurable load; no API budget spent at all.
 *
 * Deliberately NOT flagged: a redirect. `/` on this vhost may legitimately 301
 * to a canonical host, so 2xx and 3xx both count as "answering"; only 4xx, 5xx
 * and a dead connection are failures.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { readState, writeState } from './rasp-restart-oom-watch.mjs';

export default check({
  id: 'rasp-wordpress-collateral-canary',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The co-hosted WordPress and both static sites still answer, and are not quietly getting slow.',
  async run(ctx) {
    const baseline = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/rasp-baseline.json'), 'utf-8'));
    const { paths, slowFactor, floorMs, medianMs } = baseline.canary;
    const findings = [];
    let checked = 0;
    const observed = {};

    for (const p of paths) {
      const url = `${ctx.origin}${p}`;
      let t0 = Date.now();
      let res = await ctx.http(url, { method: 'GET', timeoutMs: 15_000 });
      let ms = Date.now() - t0;
      let firstError = null;

      // One retry, and only for a TRANSPORT failure — never for a status code.
      // Earned the hard way: rasp-apache-body-cap runs earlier in the same
      // process and its oversized POST is refused mid-upload, which leaves a
      // half-closed socket in the connection pool. The next request picked it
      // up and died in 4ms, and this check duly reported that the team's
      // WordPress was down while curl was answering 200 from the same laptop.
      // A check whose first nightly result is a phantom outage teaches people
      // to ignore it.
      if (!res.ok) {
        firstError = res.error;
        await new Promise((r) => setTimeout(r, 750));
        t0 = Date.now();
        res = await ctx.http(url, { method: 'GET', timeoutMs: 15_000 });
        ms = Date.now() - t0;
      }
      checked++;

      if (!res.ok) {
        findings.push(finding({
          severity: 'high',
          title: `${p} did not answer at all`,
          detail: 'A dead connection here means the shared Apache, or the box, is not serving. If the tools service caused it, this is the failure the systemd ceilings were supposed to make impossible. Both attempts failed, so this is not a single flaky socket.',
          evidence: `GET ${url} → no response, twice: first "${firstError}", then "${res.error}" after ${ms}ms`,
          remediation: 'On the droplet: systemctl status apache2 mysql ib-api, then journalctl -k --since -1h | grep -i oom.',
        }));
        continue;
      }
      if (firstError) {
        findings.push(finding({
          severity: 'info',
          title: `${p} needed a second attempt`,
          detail: 'The first connection failed and the retry succeeded. Recorded rather than hidden: one-off transport failures are usually a stale pooled socket, but a pattern of them is not.',
          evidence: `GET ${url} → first attempt "${firstError}", retry ${res.status} in ${ms}ms`,
          remediation: 'No action unless this appears on consecutive nights.',
        }));
      }

      observed[p] = ms;
      const answering = res.status >= 200 && res.status < 400;
      if (!answering) {
        findings.push(finding({
          severity: 'high',
          title: `${p} answered ${res.status}`,
          detail: p === '/'
            ? 'This is the team’s WordPress. A 5xx here alongside a healthy API is the collateral damage pattern: shared Apache, shared box, MySQL squeezed.'
            : 'A static site served straight off disk by Apache should not be able to fail. If it is failing, the problem is below the application.',
          evidence: `GET ${url} → ${res.status} in ${ms}ms (${res.text.length} bytes)`,
          remediation: 'systemctl status apache2 mysql; tail /var/log/apache2/error.log.',
        }));
        continue;
      }

      const median = medianMs && medianMs[p];
      if (typeof median === 'number' && ms > Math.max(median * slowFactor, floorMs)) {
        findings.push(finding({
          severity: 'medium',
          title: `${p} took ${ms}ms — ${(ms / median).toFixed(1)}× its healthy median`,
          detail: 'MySQL under memory or IO pressure gets slow long before it starts returning errors, so this is the earlier signal. It is a warning, not an outage.',
          evidence: `GET ${url} → ${res.status} in ${ms}ms; baseline median ${median}ms, threshold ${Math.max(median * slowFactor, floorMs)}ms`,
          remediation: 'Check load and memory on the droplet (uptime, free -m) and whether a scan flood is in progress.',
        }));
      }
    }

    writeState(ctx.repoRoot, { canaryMs: observed, canarySeenAt: new Date().toISOString() });

    // Timings with nothing to compare against prove nothing, and that gets said
    // out loud rather than being counted as a quiet pass.
    if (!medianMs && Object.keys(observed).length) {
      findings.push(finding({
        severity: 'info',
        title: 'No healthy-median baseline yet — only status was graded, not speed',
        detail: 'Statuses were checked and are reported above. The slow-response arm of this check is inert until medians are recorded.',
        evidence: `observed this run: ${Object.entries(observed).map(([k, v]) => `${k} ${v}ms`).join(', ')}`,
        remediation: 'When these times look healthy, copy them into canary.medianMs in scripts/security/data/rasp-baseline.json.',
      }));
    }

    return { findings, checked };
  },
});
