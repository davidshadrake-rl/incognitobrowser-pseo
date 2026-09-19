/**
 * What is ACTUALLY in /etc/ib-api.env on the box?
 *
 * Added on the reviewer's point, which I agree with: rasp-tuning-bounds-unit
 * proves the floors exist in source, and that is worth pinning, but a vitest
 * process on a laptop with no env set has never seen the value that would
 * actually hang the service. Only the droplet knows whether someone typed
 * POW_MAX_NUMBER=0 into the panic-mode runbook at 3am and left it there.
 *
 * Two questions, one ssh round trip:
 *   - are the numeric knobs inside the ranges lib/tuning.ts would accept? A
 *     value OUTSIDE them is not an outage today (intEnv falls back to the
 *     default and warns), but it means the operator's intended setting is not
 *     in force and nobody was told — during an incident that is its own kind
 *     of failure.
 *   - are the two secrets that must exist actually there? ALTCHA_HMAC_KEY is
 *     the one whose absence turns /challenge into a 503 for every visitor
 *     (lib/altcha.ts throws when it is missing or under 32 chars), and
 *     REDIS_URL is the one whose absence silently disables three controls.
 *
 * SECRET VALUES NEVER LEAVE THE BOX. The remote awk prints the numeric knobs
 * verbatim and reduces every other variable to NAME=<len:N>, so no key, token
 * or connection string ever enters this process, this report, or a CI log. That
 * is deliberate: a security check that leaks the secrets it is checking is a
 * worse bug than the one it was looking for.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

export default check({
  id: 'rasp-env-floors',
  discipline: 'rasp',
  cadence: 'nightly',
  severity: 'high',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: ['ssh'],
  describe: 'The live /etc/ib-api.env holds usable tuning values and the two secrets whose absence breaks or disarms the API.',
  async run(ctx) {
    const baseline = JSON.parse(readFileSync(join(ctx.repoRoot, 'scripts/security/data/rasp-baseline.json'), 'utf-8')).env;
    const numeric = Object.keys(baseline.floors);
    const numericRe = `^(${numeric.join('|')})$`;

    // The awk runs on the droplet. Numeric knobs come back as values; anything
    // else comes back as a length only.
    const awk = `awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ { k=$1; v=substr($0, index($0,"=")+1); gsub(/^["'"'"']|["'"'"']$/, "", v); if (k ~ /${numericRe}/) print k"="v; else print k"=<len:"length(v)">" }'`;
    const out = String(ctx.ssh([
      'echo "--RASP:READABLE--"',
      '(sudo -n test -r /etc/ib-api.env 2>/dev/null || test -r /etc/ib-api.env) && echo yes || echo no',
      'echo "--RASP:ENV--"',
      `(sudo -n cat /etc/ib-api.env 2>/dev/null || cat /etc/ib-api.env 2>/dev/null) | ${awk} || true`,
      'echo "--RASP:END--"',
    ].join('; '), { timeoutMs: 25_000 }));

    if (!out.includes('--RASP:END--')) throw new ctx.Skip(`env read did not complete: ${out.slice(0, 200) || '(empty)'}`);
    // Split on marker lines. The first version of this used a lazy regex
    // between markers, and an EMPTY section swallowed the next one — which is
    // how this suite's first run reported a kernel OOM kill on a box whose
    // oom-kill count was zero. A parser bug in a security check looks exactly
    // like a finding about the system, which is the most expensive kind of
    // false positive there is.
    const parts = {};
    let cur = null;
    for (const line of out.split('\n')) {
      const m = /^--RASP:([A-Z]+)--$/.exec(line.trim());
      if (m) { cur = m[1]; parts[cur] = []; continue; }
      if (cur) parts[cur].push(line);
    }
    const section = (n) => (parts[n] || []).join('\n').trim();
    if (section('READABLE') !== 'yes') {
      throw new ctx.Skip('/etc/ib-api.env is not readable by the deploy user and sudo -n is not available — the live tuning values were NOT checked');
    }

    const env = new Map();
    for (const line of section('ENV').split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) env.set(line.slice(0, i), line.slice(i + 1));
    }
    if (!env.size) throw new ctx.Skip('/etc/ib-api.env parsed to zero variables — refusing to report that as healthy');

    const findings = [];
    let checked = 0;

    // ---- numeric knobs -----------------------------------------------------
    for (const [name, range] of Object.entries(baseline.floors)) {
      if (!env.has(name)) continue; // absent means the source default applies, which rasp-tuning-bounds-unit grades
      checked++;
      const raw = env.get(name);
      const n = Number.parseInt(raw, 10);
      const badInt = !Number.isSafeInteger(n) || String(n) !== raw.trim();
      const low = range.min !== undefined && n < range.min;
      const high = range.max !== undefined && n > range.max;
      if (badInt || low || high) {
        findings.push(finding({
          severity: name === 'POW_MAX_NUMBER' && n === 0 ? 'high' : 'medium',
          title: `${name}=${raw} on the live box is outside the range lib/tuning.ts accepts`,
          detail: badInt
            ? 'intEnv() will refuse it and use the default, so whatever the operator meant to change is not changed — and the only notice is a console.warn in a journal nobody reads.'
            : `Accepted range is [${range.min ?? 0}, ${range.max ?? 'MAX_SAFE_INTEGER'}]. The value is ignored and the default applies, so the intended setting is not in force.`,
          evidence: `/etc/ib-api.env: ${name}=${raw}  (lib/tuning.ts floor ${range.min ?? 0}${range.max ? `, ceiling ${range.max}` : ''})`,
          remediation: `Fix ${name} in /etc/ib-api.env and restart ib-api, or delete the line to use the documented default.`,
          file: '/etc/ib-api.env',
        }));
      }
    }

    // ---- the secrets that must exist --------------------------------------
    for (const { name, minLength, why } of baseline.requiredSecrets) {
      checked++;
      const v = env.get(name);
      const len = Number(/^<len:(\d+)>$/.exec(v || '')?.[1] ?? NaN);
      if (v === undefined) {
        findings.push(finding({
          severity: 'high',
          title: `${name} is not set in /etc/ib-api.env`,
          detail: why,
          evidence: `/etc/ib-api.env lists ${env.size} variables and ${name} is not among them: ${[...env.keys()].sort().join(', ')}`,
          remediation: `Set ${name} in /etc/ib-api.env and restart ib-api.`,
          file: '/etc/ib-api.env',
        }));
      } else if (Number.isFinite(len) && len < minLength) {
        findings.push(finding({
          severity: 'high',
          title: `${name} is set but only ${len} characters long`,
          detail: why,
          evidence: `/etc/ib-api.env: ${name} has length ${len}, minimum ${minLength}. (The value itself is never read off the box by this check.)`,
          remediation: `Replace ${name} with a value of at least ${minLength} characters and restart ib-api.`,
          file: '/etc/ib-api.env',
        }));
      }
    }

    return { findings, checked };
  },
});
