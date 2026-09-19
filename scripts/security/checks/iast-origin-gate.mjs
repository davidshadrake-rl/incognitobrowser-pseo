/**
 * What the Origin allowlist actually enforces, exercised rather than read.
 *
 * Not in the original IAST spec — added because the adversarial reviewer was
 * right that it is the same class of bug as the one this discipline exists
 * for: a control that reads as enforced in source and is weaker in behaviour.
 *
 * lib/origin.ts allows a request when `new URL(origin).host === requestHost`,
 * and API-ON-DROPLET.md sets `ProxyPreserveHost On`, so the Host header the
 * comparison trusts is supplied by the CALLER. A script that sends
 * `Origin: https://anything` together with `Host: anything` is therefore inside
 * the gate on every route, without knowing a single allowlisted origin.
 * scripts/security-smoke.mjs cannot see this: it only ever sends a foreign
 * Origin with our real Host, which is correctly refused.
 *
 * This is a PIN, not an accusation. The code comments already concede Origin
 * is spoofable by non-browser clients and name the proof-of-work as the real
 * bound, and the same-origin branch exists because production once shipped
 * with the site unable to call its own API. The point is that the header pair
 * is ALSO forgeable, so nobody should count this as a defence layer — and if
 * someone tightens it, or loosens it further, this says so.
 */
import { check, finding, Skip } from '../lib/harness.mjs';
import { observe } from './iast-probe.mjs';

export default check({
  id: 'iast-origin-gate-forgeable-header-pair',
  discipline: 'iast',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Calls every route with a self-consistent forged Origin/Host pair and records which ones the allowlist lets through.',
  async run() {
    const obs = await observe();
    const rows = obs.origin || [];
    if (!rows.length) throw new Skip('the probe produced no origin-gate observations');

    const findings = [];

    // The allowlist must still do its one real job: refuse a foreign Origin
    // arriving at our own Host, which is the browser case it was written for.
    const notRefused = rows.filter((r) => !r.foreignOriginBlocked);
    if (notRefused.length) {
      findings.push(finding({
        severity: 'medium',
        title: `${notRefused.length} routes accepted a foreign Origin`,
        detail: 'A cross-origin page in a browser should not be able to drive these routes. This is the part of the gate that genuinely works, and it has stopped working here.',
        evidence: notRefused.map((r) => `${r.route}: Origin https://not-allowed.example, Host api.incognitobrowser.io → HTTP ${r.foreignOriginStatus} (expected 403)`).join(' ; '),
        remediation: 'Check ALLOWED_ORIGINS handling in lib/origin.ts and the same-origin branch above it.',
        file: 'lib/origin.ts',
        line: 58,
      }));
    }

    const forged = rows.filter((r) => r.forgedPairPassedGate);
    if (forged.length) {
      findings.push(finding({
        severity: 'low',
        title: 'The Origin allowlist is satisfied by a header pair the caller supplies',
        detail: 'isOriginAllowed returns true whenever the Origin host equals the Host header, and with ProxyPreserveHost On the caller controls both. curl -H "Origin: https://evil.example" -H "Host: evil.example" is inside the gate on every route without knowing any allowlisted origin. Nothing here needs fixing for browsers — CORS still protects them — but the gate must not be counted as one of three layers against scripted abuse. The proof-of-work is the only layer that costs a script anything, which makes every finding about the PoW claim worth more than it looks.',
        evidence: forged.map((r) => `${r.route}: Origin https://evil.example.test + Host evil.example.test → HTTP ${r.forgedPairStatus} (not 403)`).join(' ; '),
        remediation: 'Either accept and document it (the current position — see the comment in lib/origin.ts), or compare against a configured canonical host instead of the request Host header.',
        file: 'lib/origin.ts',
        line: 62,
      }));
    }

    return { findings, checked: rows.length };
  },
});
