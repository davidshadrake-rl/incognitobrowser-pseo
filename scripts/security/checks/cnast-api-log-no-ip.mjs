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
 * THE OTHER HALF OF THE SAME REQUIREMENT. The owner's cutover condition has
 * two clauses: never log the client's address (above), AND keep an audit log
 * of what the server fetched — the scan target and the address it resolved
 * to. Those are different addresses belonging to different parties, and they
 * are not in tension: `2026-09-22T12:00:00 scan example.com -> 93.184.216.34`
 * satisfies the second clause completely and identifies no visitor. What
 * breaks the promise is JOINING a target to a client, which is exactly what
 * the field guard below forbids. So this check also grades the ABSENCE of
 * the target log: api.log records %r only — `POST /api/scan-url HTTP/1.1` —
 * and the scanned URL travels in the POST body, so nothing on this box
 * records what was fetched. On a company target that is a medium finding
 * with the two ways to close it named; on the demo it is the current,
 * deliberate behaviour and is recorded at info, never silently.
 *
 * Read-only: one grep, shared with the rest of the cnast batch — plus, on a
 * COMPANY target only, one further grep for mod_security's audit directives.
 * The cnast discipline is built around a single session per night for a
 * reason (cnast-lib.mjs), and the demo's nightly still gets exactly that; the
 * second read is spent only where the finding it informs is a real grade.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';
import { droplet, section } from './cnast-lib.mjs';
import { stripComments } from './sast-lib.mjs';
import { deployTarget, sev, cutover } from './pro-deploy-host.mjs';

/**
 * What a route-side scan-target audit sink looks like, when one exists. Today
 * none does — app/scan-url/route.ts holds the resolved addresses in `resolved`
 * right after dnsLookup() and discards them once the allowlist has judged
 * them. The names here are the contract: a sink called one of these, or a raw
 * file append in the route, is what this check will recognise as the audit
 * log, and it then reads the sink's arguments for a client address.
 */
const AUDIT_SINK_RE = /\b(?:scanAudit\w*|auditScan\w*|logScanTarget|appendFile(?:Sync)?|createWriteStream)\s*\(/g;
/** Anything in a sink's argument list that is, or derives from, the caller's address. */
const CLIENT_ADDRESS_RE = /\b(?:clientIP|getClientIP|getIpBucket|bucket|remoteAddress|request\.headers|req\.headers|x-forwarded-for|cf-connecting-ip|x-real-ip|true-client-ip)\b/i;
/** The one extra read, company target only. */
const MODSEC_CMD = "grep -rhoE '^[[:space:]]*Sec(AuditEngine|AuditLog|RuleEngine)[[:space:]]+[^[:space:]]+' /etc/apache2/ /etc/modsecurity/ 2>/dev/null | sort -u; echo '---IB:MODSEC-END---'";

/** The text between the parentheses of a call whose `(` is at `openIdx`. */
function callArgs(text, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') { depth--; if (depth === 0) return text.slice(openIdx + 1, i); }
  }
  return text.slice(openIdx + 1);
}
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

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

    // ---- the positive half: is what the server FETCHED recorded anywhere? --
    const t = deployTarget(ctx);

    // (1) A route-side sink. The route is where the target and its resolved
    // addresses exist together and the client address does not have to.
    const routeRel = 'app/scan-url/route.ts';
    const routePath = join(ctx.repoRoot, routeRel);
    const routeSinks = [];
    let routeNote = `${routeRel} not present in this checkout`;
    if (existsSync(routePath)) {
      checked++;
      const code = stripComments(readFileSync(routePath, 'utf-8'), { strings: false });
      for (const m of code.matchAll(AUDIT_SINK_RE)) {
        const args = callArgs(code, m.index + m[0].length - 1);
        routeSinks.push({ line: lineOf(code, m.index), call: m[0].replace(/\s*\($/, ''), args: args.replace(/\s+/g, ' ').slice(0, 160), joinsClient: CLIENT_ADDRESS_RE.test(args) });
      }
      routeNote = routeSinks.length
        ? `${routeRel} audit sink(s): ${routeSinks.map((s) => `:${s.line} ${s.call}(${s.args})`).join(' | ')}`
        : `${routeRel} has no audit sink (no scanAudit*/auditScan*/logScanTarget/appendFile/createWriteStream call)`;
    }

    // (2) mod_security's audit log, read only on a company target — see the
    // header for why the demo's nightly is not charged a second session.
    let modsec = null;
    if (t.kind === 'company') {
      const out = String(ctx.ssh(MODSEC_CMD, { timeoutMs: 20_000 }));
      if (!out.includes('---IB:MODSEC-END---')) {
        modsec = { inspected: false, note: `the mod_security grep did not complete: ${out.slice(-160).replace(/\n/g, ' ')}` };
      } else {
        checked++;
        const kv = {};
        for (const line of out.split('\n')) {
          const m = /^\s*(SecAuditEngine|SecAuditLog|SecRuleEngine)\s+(\S+)/.exec(line);
          if (m) kv[m[1]] = m[2];
        }
        modsec = { inspected: true, ...kv, note: Object.keys(kv).length ? Object.entries(kv).map(([k, v]) => `${k} ${v}`).join(', ') : 'no Sec* directive under /etc/apache2 or /etc/modsecurity' };
      }
    }
    const modsecFull = Boolean(modsec && modsec.inspected && /^on$/i.test(modsec.SecAuditEngine || '') && modsec.SecAuditLog);

    // What api.log itself records, quoted so the reader can see there is no
    // body token in it (Apache has none; the target cannot be in this line).
    const formats = proxying.map(([file, lines]) => {
      const f = lines.find((l) => /LogFormat\s+".*"\s+ib_api_noip/.test(l.text));
      return f ? `${file}:${f.line} ${f.text}` : `${file}: (no ib_api_noip LogFormat)`;
    });
    const layout = [
      ...formats,
      routeNote,
      `mod_security: ${modsec ? (modsec.inspected ? modsec.note : `NOT inspected — ${modsec.note}`) : 'not inspected on the demo target (one ssh session per night; see header)'}`,
    ].join('\n  ');

    if (!routeSinks.length && !modsecFull) {
      findings.push(finding({
        severity: sev(t, 'info', 'medium'),
        title: t.kind === 'company'
          ? 'No audit log of scan targets exists: api.log records the request line only, and the scanned URL is in the POST body'
          : 'No audit log of scan targets — the demo\'s current behaviour, by design, and the cutover requirement it does not meet',
        detail: `${cutover(t)}The owner's cutover condition has two clauses. The no-client-address half is graded above. The other half — keep a record of what the server FETCHED, the target and the address it resolved to — has nothing on this box that satisfies it: Apache's ib_api_noip format is %t %r %>s %b %D, and %r is \`POST /api/scan-url HTTP/1.1\`, which names the route and never the target; the target and its resolved addresses exist only in app/scan-url/route.ts (\`resolved\`, right after dnsLookup) and are discarded once the allowlist has judged them. On a company deployment that means an incident on the internal network — a scan that reached something it should not have — cannot be reconstructed from anything the server kept. The two clauses are not in tension: a line of target -> resolved address identifies no visitor. What must never happen is joining that line to a client address, which this check's field guard above would then catch on the Apache side and the audit-sink argument read here catches on the route side.`,
        evidence: layout,
        remediation: 'Two ways to close it, either one is enough. (a) In app/scan-url/route.ts, right after the allowlist has judged `resolved`, append one line per scan — timestamp, target host, resolved address(es), outcome — to a SEPARATE file (not journald, not api.log) through a sink named scanAuditLog(...), with NO client address, bucket or request header in its arguments; this check reads those arguments and grades any client-address token in them high. (b) A mod_security audit log (SecAuditEngine On, SecAuditLog <path>) on the /api/ vhost, which captures the POST body and so the target — but note that mod_security\'s mandatory A section records the client address, so that option turns the privacy promise into a retention-and-access question on that one file, and this check will say so rather than go green.',
      }));
    } else {
      for (const s of routeSinks) {
        findings.push(finding({
          severity: s.joinsClient ? 'high' : 'info',
          file: routeRel,
          line: s.line,
          title: s.joinsClient
            ? `The scan-target audit sink at ${routeRel}:${s.line} is handed a client address — the target is joined to the caller`
            : `A route-side scan-target audit sink exists at ${routeRel}:${s.line}, and its arguments carry no client address`,
          detail: s.joinsClient
            ? 'This is the one join the whole promise is about. api.log omits %h so that no file on this box says which person scanned which site; an audit sink that takes the client address (or the /24 bucket, or the request headers it is derived from) beside the target recreates exactly that record under a different name.'
            : 'Recorded so the requirement reads as met for a reason that can be re-checked: the sink is named, its line is named, and its argument list was read for clientIP / getClientIP / bucket / request.headers and the four forwarding headers.',
          evidence: `${routeRel}:${s.line} ${s.call}(${s.args})`,
          remediation: s.joinsClient ? 'Remove the client address, bucket and request-header arguments from the audit sink; log target and resolved address only.' : 'No action. Keep it this way.',
        }));
      }
      if (modsecFull) {
        findings.push(finding({
          severity: sev(t, 'low', 'medium'),
          title: 'The scan-target audit log is mod_security\'s, whose mandatory A section records the client address',
          detail: `${cutover(t)}SecAuditEngine On with a SecAuditLog captures the POST body and so the scanned URL — the audit requirement is met — but every entry's A section carries the client address and port, so target and caller sit in one file. That is not the "never log the client" promise as written; it is that promise reduced to who can read one file and for how long. Say so in the runbook, restrict and rotate that file, or prefer the route-side sink, which needs no such caveat.`,
          evidence: layout,
          remediation: 'Prefer option (a): a route-side scanAuditLog() with no client address. If mod_security stays, document the A-section address, restrict the file to root, and rotate it on the same schedule as api.log.',
        }));
      }
    }

    return { findings, checked };
  },
});
