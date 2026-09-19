/**
 * The certificate is valid, has runway, and old TLS is refused.
 *
 * This is the cheapest check in the suite and probably the one most likely to
 * save the site. Both static sites are served with
 * `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.
 * Two years. If certbot's renewal quietly stops working, an expired
 * certificate is not a warning a visitor can click through — HSTS turns it
 * into a hard failure, and ~1,400 pages plus all three server-backed tools go
 * dark at the same moment, for every returning visitor, until a new
 * certificate is installed. Nothing in this repo watches the expiry date.
 *
 * 21 days is the finding threshold and 30 days is the warning: Let's Encrypt
 * renews at 30 days remaining, so anything under 21 means renewal has already
 * had nine days to work and has not.
 *
 * The downgrade half (TLS 1.0 and 1.1 must be refused) is written to be honest
 * about a trap: modern Node cannot always OFFER those protocols, so a failed
 * handshake can mean "the server refused" or "this laptop's OpenSSL would not
 * try". Only the first is a pass. When the attempt cannot be made, that
 * sub-probe is reported as info and is NOT counted in `checked`, because
 * counting it would be the suite telling itself it verified something it did
 * not.
 *
 * Cipher-suite grading is deliberately out of scope. testssl.sh does it well
 * and is not installed here; certbot on Ubuntu 24.04 uses Mozilla-intermediate
 * defaults, so cipher selection is not where this system fails — expired
 * certificates are.
 */
import tls from 'node:tls';
import { check, finding } from '../lib/harness.mjs';

const DAY = 24 * 60 * 60 * 1000;

function handshake(opts, timeoutMs = 12_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; try { socket.destroy(); } catch { /* gone */ } resolve(r); } };
    const socket = tls.connect(opts, () => done({
      connected: true,
      authorized: socket.authorized,
      authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
      protocol: socket.getProtocol(),
      cipher: socket.getCipher(),
      cert: socket.getPeerCertificate(),
    }));
    socket.setTimeout(timeoutMs, () => done({ connected: false, error: `timeout after ${timeoutMs}ms` }));
    socket.on('error', (e) => done({ connected: false, error: String(e.message || e), code: e.code }));
  });
}

/**
 * Did the handshake fail because the SERVER said no, or because this client
 * would not make the attempt? Only the former proves anything about the box.
 */
function refusedByServer(r) {
  const s = `${r.code || ''} ${r.error || ''}`;
  if (/no protocols available|unsupported protocol|no ciphers available|library has no ciphers|SSL routines::no cipher match/i.test(s)) return false;
  return /alert|version|ECONNRESET|handshake failure|wrong version number|EPROTO/i.test(s);
}

export default check({
  id: 'dast-tls-posture',
  discipline: 'dast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network'],
  describe: 'The live certificate verifies, covers the served hostname, has more than 21 days left, and TLS 1.0/1.1 are refused.',

  async run(ctx) {
    const host = new URL(ctx.origin).hostname;
    const port = Number(new URL(ctx.origin).port || 443);
    const findings = [];
    let checked = 0;

    const main = await handshake({ host, port, servername: host, rejectUnauthorized: false });
    if (!main.connected) {
      findings.push(finding({
        severity: 'high',
        title: `TLS handshake with ${host}:${port} failed outright`,
        detail: 'Both sites and all three server-backed tools are https-only behind a two-year HSTS. A handshake that does not complete is the site being down for every returning visitor.',
        evidence: `tls.connect ${host}:${port} → ${main.error}`,
        remediation: 'Check Apache is running and listening on 443, and that the certificate files exist.',
      }));
      return { findings, checked: 1 };
    }

    checked++;
    if (!main.authorized) {
      findings.push(finding({
        severity: 'high',
        title: 'The certificate chain does not verify',
        detail: 'A browser will refuse the connection, and behind HSTS max-age=63072000 the visitor cannot click through.',
        evidence: `tls.connect ${host}:${port} → authorized=false, ${main.authorizationError}`,
        remediation: 'Check the certbot chain (fullchain.pem, not cert.pem, in the Apache SSLCertificateFile directive) and run certbot renew --dry-run.',
      }));
    }

    checked++;
    const names = [
      ...(main.cert?.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, '')).filter(Boolean),
      ...(main.cert?.subject?.CN ? [main.cert.subject.CN] : []),
    ];
    const covers = names.some((n) => n === host || (n.startsWith('*.') && host.endsWith(n.slice(1))));
    if (!covers) {
      findings.push(finding({
        severity: 'high',
        title: `The certificate does not cover ${host}`,
        detail: 'The served hostname is not in the certificate, so every browser rejects it.',
        evidence: `tls.connect ${host}:${port} → subject CN=${main.cert?.subject?.CN}, SAN=${main.cert?.subjectaltname || '(none)'}`,
        remediation: 'Re-issue the certificate for the hostname actually being served.',
      }));
    }

    checked++;
    const notAfter = main.cert?.valid_to ? Date.parse(main.cert.valid_to) : NaN;
    const daysLeft = Number.isNaN(notAfter) ? null : Math.floor((notAfter - Date.now()) / DAY);
    if (daysLeft === null) {
      findings.push(finding({
        severity: 'medium',
        title: 'Could not read the certificate expiry date',
        detail: 'Without an expiry there is no runway warning, which is the main thing this check is for.',
        evidence: `tls.connect ${host}:${port} → valid_to=${JSON.stringify(main.cert?.valid_to)}`,
        remediation: 'Inspect with: echo | openssl s_client -servername ' + host + ' -connect ' + host + ':443 | openssl x509 -noout -dates',
      }));
    } else if (daysLeft <= 21) {
      findings.push(finding({
        severity: daysLeft <= 7 ? 'critical' : 'high',
        title: `The certificate expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        detail: "Let's Encrypt renews at 30 days remaining, so under 21 means renewal has already had over a week to succeed and has not. On expiry, HSTS max-age=63072000 turns the warning into a hard stop: ~1,400 pages and all three server-backed tools go dark at once, with no click-through.",
        evidence: `tls.connect ${host}:${port} → notAfter=${main.cert.valid_to} (${daysLeft} days)`,
        remediation: 'On the droplet: certbot renew --dry-run, then check the certbot systemd timer is enabled and that port 80 still reaches the ACME challenge path (/.well-known/ is exempted from the dotfile deny for exactly this reason).',
      }));
    } else if (daysLeft <= 30) {
      findings.push(finding({
        severity: 'low',
        title: `The certificate expires in ${daysLeft} days — renewal should be happening now`,
        detail: 'This is the warning band, not a failure. If it is still here in a week, it becomes one.',
        evidence: `tls.connect ${host}:${port} → notAfter=${main.cert.valid_to} (${daysLeft} days)`,
        remediation: 'Confirm the certbot timer ran: systemctl list-timers | grep certbot',
      }));
    }

    checked++;
    if (main.protocol && !['TLSv1.2', 'TLSv1.3'].includes(main.protocol)) {
      findings.push(finding({
        severity: 'high',
        title: `The default handshake negotiated ${main.protocol}`,
        detail: 'A negotiated protocol below TLS 1.2 means the server is preferring something deprecated to a modern client.',
        evidence: `tls.connect ${host}:${port} → protocol=${main.protocol}, cipher=${main.cipher?.name}`,
        remediation: 'Set SSLProtocol -all +TLSv1.2 +TLSv1.3 in the Apache SSL config.',
      }));
    }

    // Now try to be an old client. Must be refused.
    for (const version of ['TLSv1.1', 'TLSv1']) {
      const r = await handshake({
        host, port, servername: host, rejectUnauthorized: false,
        minVersion: version, maxVersion: version,
        // Without this, OpenSSL 3's default security level removes every
        // cipher these versions can offer and the failure is ours, not theirs.
        ciphers: 'DEFAULT@SECLEVEL=0',
      });
      if (r.connected) {
        checked++;
        findings.push(finding({
          severity: 'high',
          title: `The server accepted a ${version} handshake`,
          detail: 'TLS 1.0 and 1.1 are deprecated and removed from every current browser. Still accepting them does not endanger those browsers, but it is a downgrade surface and a compliance failure, and it means the SSL config is not what it is assumed to be.',
          evidence: `tls.connect ${host}:${port} pinned to ${version} → connected, protocol=${r.protocol}, cipher=${r.cipher?.name}`,
          remediation: 'SSLProtocol -all +TLSv1.2 +TLSv1.3',
        }));
      } else if (refusedByServer(r)) {
        checked++;
      } else {
        // Not counted: we did not test the server, we failed to ask.
        findings.push(finding({
          severity: 'info',
          title: `Could not attempt ${version} from this machine — the protocol floor was not verified`,
          detail: 'The local OpenSSL build refused to offer the protocol, so the handshake never reached the server. Reported rather than counted as a pass, because a pass here would be a lie.',
          evidence: `tls.connect ${host}:${port} pinned to ${version} → ${r.code || ''} ${r.error}`,
          remediation: `Verify by hand from a machine with an older OpenSSL, or: openssl s_client -${version === 'TLSv1' ? 'tls1' : 'tls1_1'} -connect ${host}:${port}`,
        }));
      }
    }

    return { findings, checked };
  },
});
