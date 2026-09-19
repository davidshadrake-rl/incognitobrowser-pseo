/**
 * The privacy promise itself, as Apache config.
 *
 * ADDED BEYOND THE SPECIFICATION, on the reviewer's point, which I agree with
 * and could not find covered anywhere: not by tests/, not by
 * scripts/security-smoke.mjs, not by any other check in this suite. I grepped
 * for `ib_api_noip` across scripts/security/checks/ before writing it and the
 * only occurrence was the one I was about to add.
 *
 * Three directives in the :443 vhost (API-ON-DROPLET.md:188-194) are what make
 * the claim true:
 *
 *   SetEnvIf Request_URI "^/api/" ib_api
 *   LogFormat "%{%Y-%m-%dT%H:%M:%S}t \"%r\" %>s %b %Dus" ib_api_noip
 *   CustomLog ${APACHE_LOG_DIR}/api.log ib_api_noip env=ib_api
 *
 * plus the `env=!ib_api` that keeps /api/ out of the ordinary combined log.
 * Together they mean a scan is logged with time, request line, status, bytes
 * and duration — and no client address.
 *
 * Lose them, and api.log silently becomes a standing per-visitor record of
 * which sites each person scanned, held on a box that also runs someone else's
 * WordPress. Nothing breaks. No test fails. No visitor can tell. The product
 * simply stops being what it says it is, and the first anyone would know is
 * whenever somebody next reads the log.
 *
 * The realistic way it happens is the one the runbook already warns about
 * twice: a restored vhost backup, or a rebuilt box. apache-managed-block-drift
 * inspects the RequestHeader and Content-Length directives in that same file
 * and walks straight past the three log directives beside them.
 *
 * Graded per vhost that actually proxies /api/, not globally, so that adding a
 * second proxying vhost (an http:// one, say) without the log configuration is
 * caught rather than masked by the :443 one being correct.
 *
 * Read-only: one grep, shared with the rest of the cnast batch.
 */
import { check, finding } from '../lib/harness.mjs';
import { droplet, section } from './cnast-lib.mjs';

/** grep -n output, grouped by file. */
function byFile(text) {
  const files = new Map();
  for (const line of text.split('\n')) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(line);
    if (!m) continue;
    if (!files.has(m[1])) files.set(m[1], []);
    files.get(m[1]).push({ line: Number(m[2]), text: m[3].trim() });
  }
  return files;
}

export default check({
  id: 'api-log-no-ip',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'Every vhost that proxies /api/ still logs those requests without the client address — the "we count clicks, not people" promise, as config.',
  async run(ctx) {
    const sections = droplet(ctx);
    const vhost = section(ctx, sections, 'VHOST');
    const files = byFile(vhost);
    if (!files.size) throw new ctx.Skip(`the vhost grep returned nothing parseable: ${vhost.slice(0, 200)}`);

    const findings = [];
    let checked = 0;

    const proxying = [...files.entries()].filter(([, lines]) => lines.some((l) => /^ProxyPass\s+\/api\//.test(l.text)));
    if (!proxying.length) {
      // Not a pass and not a quiet zero: if nothing proxies /api/, either the
      // API is unreachable through Apache or the grep missed it, and both are
      // things a human has to look at.
      throw new ctx.Skip(`no sites-enabled vhost contains a ProxyPass for /api/ — nothing to grade. Observed files: ${[...files.keys()].join(', ')}`);
    }

    for (const [file, lines] of proxying) {
      const text = lines.map((l) => l.text).join('\n');

      checked++;
      if (!/SetEnvIf\s+Request_URI\s+"\^\/api\/"\s+ib_api/.test(text)) {
        findings.push(finding({
          severity: 'high',
          title: `${file} proxies /api/ but does not set the ib_api log flag`,
          detail: 'Without SetEnvIf, neither the no-IP log nor the combined log\'s exclusion has anything to test, so scan requests fall through into the ordinary access log with the client address attached. For a product whose pitch is that it counts clicks and not people, that is the most damaging single line to lose on this box.',
          evidence: `grep -n 'SetEnvIf Request_URI' ${file} → (no match). Proxy line present: ${lines.filter((l) => /ProxyPass\s+\/api\//.test(l.text)).map((l) => `${l.line}: ${l.text}`).join(' | ')}`,
          remediation: 'Restore the three log directives from API-ON-DROPLET.md:188-194, then apache2ctl configtest && systemctl reload apache2.',
          file,
        }));
      }

      checked++;
      if (!/LogFormat\s+".*"\s+ib_api_noip/.test(text)) {
        findings.push(finding({
          severity: 'high',
          title: `${file} has no ib_api_noip log format`,
          detail: 'The format is what omits %h. Without it, the CustomLog below either fails to load or falls back to a format that includes the address.',
          evidence: `grep -n 'LogFormat' ${file} → ${lines.filter((l) => l.text.startsWith('LogFormat')).map((l) => `${l.line}: ${l.text}`).join(' | ') || '(no LogFormat lines)'}`,
          remediation: 'LogFormat "%{%Y-%m-%dT%H:%M:%S}t \\"%r\\" %>s %b %Dus" ib_api_noip',
          file,
        }));
      } else {
        // The format exists — but does it still omit the address? %h, %a and
        // %{X-Forwarded-For}i are the three ways an address gets back in.
        const fmt = lines.find((l) => /LogFormat\s+".*"\s+ib_api_noip/.test(l.text));
        checked++;
        if (fmt && /%\{?[ah]\}?|%\{X-Forwarded-For\}i|%\{CF-Connecting-IP\}i/.test(fmt.text.replace(/ib_api_noip\s*$/, ''))) {
          findings.push(finding({
            severity: 'high',
            title: `The ib_api_noip format now includes a client address token`,
            detail: 'The format kept its name and stopped doing its job, which is worse than losing it outright — the name reads as proof in every later review.',
            evidence: `${file}:${fmt.line}: ${fmt.text}`,
            remediation: 'Remove %h / %a / %{X-Forwarded-For}i from the ib_api_noip format.',
            file,
            line: fmt.line,
          }));
        }
      }

      checked++;
      const noIpLog = lines.find((l) => /CustomLog\s+\S*api\.log\s+ib_api_noip\s+env=ib_api/.test(l.text));
      if (!noIpLog) {
        findings.push(finding({
          severity: 'high',
          title: `${file} does not write /api/ requests to the no-IP log`,
          detail: 'The CustomLog line is the one that actually routes scan requests away from the combined log. Without it they go wherever the vhost\'s default CustomLog sends them, with %h at the front of every line.',
          evidence: `grep -n 'CustomLog' ${file} → ${lines.filter((l) => l.text.startsWith('CustomLog')).map((l) => `${l.line}: ${l.text}`).join(' | ') || '(none)'}`,
          remediation: 'CustomLog ${APACHE_LOG_DIR}/api.log ib_api_noip env=ib_api',
          file,
        }));
      }

      // And the other half: the ordinary log must still EXCLUDE /api/. A
      // combined log without env=!ib_api records the address for every scan
      // even when the no-IP log above is perfectly configured.
      for (const l of lines.filter((x) => x.text.startsWith('CustomLog') && !/ib_api_noip/.test(x.text))) {
        checked++;
        if (!/env=!ib_api/.test(l.text)) {
          findings.push(finding({
            severity: 'high',
            title: `${file}:${l.line} logs /api/ requests into a combined log with the client address`,
            detail: 'The no-IP log is not an alternative to the combined log unless the combined log opts out. With both active, every scan is recorded twice and one of the copies has %h on it.',
            evidence: `${file}:${l.line}: ${l.text} (expected a trailing env=!ib_api)`,
            remediation: 'Append env=!ib_api to that CustomLog line.',
            file,
            line: l.line,
          }));
        }
      }
    }

    // Other enabled vhosts that do NOT proxy /api/ are not graded: their logs
    // are the other site's business, and WordPress is not ours to configure.
    // Recorded so the scope of what was graded is explicit in the report.
    findings.push(finding({
      severity: 'info',
      title: `Graded ${proxying.length} vhost(s) that proxy /api/`,
      detail: 'Vhosts that do not proxy /api/ are deliberately out of scope — their logging is the team\'s WordPress configuration, which this project has no authority over.',
      evidence: `sites-enabled proxying /api/: ${proxying.map(([f]) => f).join(', ')}; all enabled: ${(sections.SITESENABLED || '').split('\n').join(', ')}`,
    }));

    return { findings, checked };
  },
});
