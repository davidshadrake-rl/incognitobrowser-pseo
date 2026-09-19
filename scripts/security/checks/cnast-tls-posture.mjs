/**
 * The certificate, and the machine that is supposed to keep renewing it.
 *
 * Why this matters more here than on an ordinary site: the cert is a 90-day
 * Let's Encrypt cert, and scripts/droplet-htaccess.conf:74 sets
 * `Strict-Transport-Security: max-age=63072000; includeSubDomains`. HSTS is
 * per-HOST, not per-path, so once any browser has loaded /resources/ it will
 * refuse the http:// fallback for EVERY path on 206-189-186-34.nip.io —
 * including the team's WordPress at /. An expired certificate here is not a
 * degraded site with a click-through warning. It is a non-bypassable outage
 * for a site that is not even ours.
 *
 * OVERLAP, stated plainly rather than hidden: dast-tls-posture already grades
 * the handshake, the chain, the SAN and the TLS 1.0/1.1 floor against the same
 * host, and grades expiry at 21 and 30 days. Duplicating those findings would
 * print the same problem twice a night, which is how people learn to skim the
 * output. So this check does two things that one does not:
 *
 *   1. It grades the RENEWAL MACHINERY, which is the leading indicator. The
 *      strings "certbot", "letsencrypt" and "Let's Encrypt" appear zero times
 *      anywhere in this repo — I grepped every .md, .sh, .mjs and .conf. An
 *      expiry date is a lagging indicator: by the time it reads 30 days,
 *      renewal has already been failing for about 60. `certbot.timer` being
 *      disabled, or not having fired for days, is the same failure visible two
 *      months earlier.
 *   2. It holds the hard floor. Under 14 days is this check's own finding
 *      regardless of what else ran, because a cert that close to expiry on an
 *      HSTS-pinned host that also serves someone else's site is not something
 *      to leave to one check.
 *
 * The 14–30 day band is reported as info here and left to dast-tls-posture to
 * grade, so the same runway is not double-billed.
 *
 * The TLS half needs only the network; the certbot half needs ssh. When there
 * is no droplet login the certbot probe is reported as info and is NOT counted
 * in `checked` — the same discipline dast-tls-posture uses for a downgrade
 * probe this machine could not make. Counting an unmade observation as checked
 * would be the suite lying to itself.
 */
import tls from 'node:tls';
import { check, finding } from '../lib/harness.mjs';
import { droplet, section, baseline, showProps } from './cnast-lib.mjs';

const DAY = 24 * 60 * 60 * 1000;

function handshake(opts, timeoutMs = 12_000) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (r) => { if (!settled) { settled = true; try { socket.destroy(); } catch { /* already gone */ } resolve(r); } };
    const socket = tls.connect(opts, () => done({
      connected: true,
      authorized: socket.authorized,
      authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
      protocol: socket.getProtocol(),
      cert: socket.getPeerCertificate(),
    }));
    socket.setTimeout(timeoutMs, () => done({ connected: false, error: `timeout after ${timeoutMs}ms` }));
    socket.on('error', (e) => done({ connected: false, error: String(e.message || e), code: e.code }));
  });
}

export default check({
  id: 'tls-posture',
  discipline: 'cnast',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['network', 'ssh'],
  describe: 'The live cert covers the served host with real runway, TLS 1.2 is accepted, and certbot.timer is still firing — the leading indicator nothing in this repo watches.',
  async run(ctx) {
    const base = baseline(ctx);
    const host = new URL(ctx.origin).hostname;
    const port = Number(new URL(ctx.origin).port || 443);
    const findings = [];
    let checked = 0;

    const main = await handshake({ host, port, servername: host, rejectUnauthorized: false });
    if (!main.connected) {
      // Not a Skip: a handshake that does not complete is the answer, and it
      // is the worst one. nip.io going dark shows up here too, which is why
      // the DNS-tautology check the reviewer cut was not needed.
      return {
        checked: 1,
        findings: [finding({
          severity: 'high',
          title: `TLS handshake with ${host}:${port} did not complete`,
          detail: 'Behind a two-year HSTS this is the whole host down for every returning visitor, the team\'s WordPress at / included. It also means nothing below could be measured.',
          evidence: `tls.connect ${host}:${port} servername=${host} → ${main.error}`,
          remediation: 'Check Apache is listening on 443 and that the certificate files named in the vhost exist.',
        })],
      };
    }

    // 1. Does the cert actually cover the host we serve from? Cheap, and the
    //    one failure a renewal cannot fix by itself.
    checked++;
    const sans = (main.cert?.subjectaltname || '').split(',').map((s) => s.trim().replace(/^DNS:/, '')).filter(Boolean);
    const names = [...sans, ...(main.cert?.subject?.CN ? [main.cert.subject.CN] : [])];
    const covers = names.some((n) => n === host || (n.startsWith('*.') && host.endsWith(n.slice(1))));
    if (!covers) {
      findings.push(finding({
        severity: 'high',
        title: `The certificate does not name ${host}`,
        detail: 'SITE_ORIGIN points at a hostname the certificate does not cover, so every browser rejects the connection and HSTS forbids the fallback.',
        evidence: `tls.connect ${host}:${port} → CN=${main.cert?.subject?.CN || '(none)'}, SAN=${main.cert?.subjectaltname || '(none)'}`,
        remediation: `Re-issue for ${host}, or correct SITE_ORIGIN in .secrets if the host moved.`,
      }));
    }

    // 2. The hard floor. Below 14 days this check speaks regardless of who
    //    else is watching; 14-30 is dast-tls-posture's band and is reported
    //    here as context only.
    checked++;
    const notAfter = main.cert?.valid_to ? Date.parse(main.cert.valid_to) : NaN;
    const daysLeft = Number.isNaN(notAfter) ? null : Math.floor((notAfter - Date.now()) / DAY);
    if (daysLeft !== null && daysLeft < 14) {
      findings.push(finding({
        severity: daysLeft <= 7 ? 'critical' : 'high',
        title: `The certificate expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`,
        detail: "Let's Encrypt starts renewing at 30 days left. Under 14 means renewal has had more than two weeks to succeed and has not, so it is broken rather than late. On expiry, HSTS max-age=63072000 makes it a hard stop for both sites on this host.",
        evidence: `tls.connect ${host}:${port} → notAfter=${main.cert.valid_to} (${daysLeft} days), issuer=${main.cert?.issuer?.CN || '?'}`,
        remediation: 'On the droplet: certbot renew --dry-run, and confirm /.well-known/ still answers over plain http (the managed .htaccess block exempts it from the dotfile deny for exactly this reason).',
      }));
    }

    // 3. TLS 1.2 must still be ACCEPTED. dast-tls-posture proves 1.0/1.1 are
    //    refused; the opposite regression — an SSLProtocol line that leaves
    //    only 1.3 — locks out older Android WebViews, which is this product's
    //    in-app surface. One extra handshake.
    checked++;
    const twelve = await handshake({ host, port, servername: host, rejectUnauthorized: false, minVersion: 'TLSv1.2', maxVersion: 'TLSv1.2' });
    if (!twelve.connected) {
      findings.push(finding({
        severity: 'medium',
        title: 'TLS 1.2 was refused',
        detail: 'A 1.3-only server turns away older Android WebViews, which is where the in-app pages are rendered. This is a compatibility break dressed as hardening.',
        evidence: `tls.connect ${host}:${port} pinned to TLSv1.2 → ${twelve.code || ''} ${twelve.error}`,
        remediation: 'SSLProtocol -all +TLSv1.2 +TLSv1.3',
      }));
    }

    // 4. The renewal machinery — the half nothing else in this repo can see.
    try {
      const sections = droplet(ctx);
      const certbot = section(ctx, sections, 'CERTBOT');
      const enabled = /^enabled/m.test(certbot);
      const props = showProps(certbot);
      const last = props.get('LastTriggerUSec');
      checked++;
      if (!enabled) {
        findings.push(finding({
          severity: 'high',
          title: 'certbot.timer is not enabled',
          detail: 'Nothing is renewing the certificate. Today\'s expiry date says nothing about tomorrow: this is the same outage as an expired cert, seen two months before it happens. No file in this repo mentions certbot at all, so there is no other record that renewal is someone\'s job.',
          evidence: `systemctl is-enabled certbot.timer → ${certbot.split('\n')[0] || '(empty)'}`,
          remediation: 'systemctl enable --now certbot.timer, then certbot renew --dry-run.',
        }));
      } else if (last && last !== 'n/a' && !/^0$/.test(last)) {
        const lastMs = Date.parse(last.replace(/^[A-Za-z]{3} /, ''));
        const ageDays = Number.isNaN(lastMs) ? null : (Date.now() - lastMs) / DAY;
        if (ageDays !== null && ageDays > base.certbot.maxDaysSinceLastTrigger) {
          findings.push(finding({
            severity: 'medium',
            title: `certbot.timer is enabled but last fired ${ageDays.toFixed(1)} days ago`,
            detail: `The unit exists and the timer is on, but it is not running on its expected cadence (twice daily on Ubuntu). Threshold is ${base.certbot.maxDaysSinceLastTrigger} days.`,
            evidence: `systemctl show certbot.timer -p LastTriggerUSec → ${last}`,
            remediation: 'systemctl status certbot.timer certbot.service, and check the box\'s clock.',
          }));
        }
      }
    } catch (err) {
      if (!err || !err.isSkip) throw err;
      // Deliberately info, and deliberately NOT counted: we did not observe
      // that renewal is healthy, we failed to look.
      findings.push(finding({
        severity: 'info',
        title: 'Certificate renewal was not verified — no droplet login on this machine',
        detail: 'The TLS observations above stand on their own, but the leading indicator (certbot.timer) needs ssh. Reported rather than passed over, because a silent omission here is how a renewal failure stays invisible for two months.',
        evidence: `cnast droplet batch → Skip: ${err.message}`,
        remediation: 'Run this check from a machine with .secrets, or check by hand: systemctl list-timers certbot.timer',
      }));
    }

    // Context the reviewer asked to keep when the DNS tautology check was cut:
    // the resolved answer is implicit in a completed handshake, so the expiry
    // and issuer are reported as the durable record instead.
    if (daysLeft !== null && daysLeft >= 14 && daysLeft <= 30) {
      findings.push(finding({
        severity: 'info',
        title: `Certificate has ${daysLeft} days left — inside the renewal window`,
        detail: 'Not graded here on purpose: dast-tls-posture owns the 21/30-day warning bands, and printing the same runway twice a night trains people to skim.',
        evidence: `tls.connect ${host}:${port} → notAfter=${main.cert.valid_to}, issuer=${main.cert?.issuer?.CN || '?'}, protocol=${main.protocol}`,
      }));
    }

    return { findings, checked };
  },
});
