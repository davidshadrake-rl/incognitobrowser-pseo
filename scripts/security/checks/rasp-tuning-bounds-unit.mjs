/**
 * Can one env typo still stop the whole API answering?
 *
 * It could, until today. lib/tuning.ts used to validate with
 * `if (Number.isNaN(parsed) || parsed < 0) return defaultValue`, which accepts
 * zero. POW_MAX_NUMBER=0 then made createChallenge's rejection-sampling bound
 * `Math.floor(0x100000000 / 0) * 0` = NaN, so `r < NaN` was never true and the
 * loop never exited. It is synchronous, on the one thread that serves all seven
 * routes, behind a CPUQuota of a single core — so the symptom is not a slow
 * /challenge, it is an API that stops answering entirely. SCAN_RATE_WINDOW_MS=0
 * was the quieter twin: every request lands in its own window, so the limiter
 * counts to one forever and fails OPEN while still printing limit headers.
 *
 * Both are fixed. This check is the pin that stops them coming back, because
 * the place that invites the typo is the panic-mode runbook at lib/tuning.ts:
 * 11-14, which tells an operator to hand-edit these very variables while under
 * attack — the worst possible moment to discover the floor is missing.
 *
 * It reads source, so it runs offline in milliseconds and gates every build.
 * What it CANNOT do is tell you what is in /etc/ib-api.env on the droplet; a
 * test process with no env set never exercises the value that matters. That is
 * rasp-env-floors, over ssh.
 *
 * Deliberately NOT required to have a floor: SCAN_RATE_LIMIT and
 * CHALLENGE_RATE_LIMIT. Zero there is documented in the source as a deliberate
 * kill switch — "refuse every scan" fails CLOSED, which is a coherent thing to
 * ask for during an incident. Requiring >= 1 would flag a working feature, and
 * a check that flags working features gets switched off. Same reasoning for the
 * pure collection ceilings (MAX_COOKIES, MAX_SCRIPT_MATCHES,
 * MAX_THIRD_PARTY_DOMAINS, MAX_URL_LENGTH, MAX_BODY_SIZE_MB): zero means
 * "collect nothing" and is safe.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { check, finding } from '../lib/harness.mjs';

/**
 * The knobs a zero (or an absurd value) would hang, disarm or abort — each with
 * the failure it causes, so a finding explains itself without this file.
 */
const DANGEROUS = [
  { name: 'POW_MAX_NUMBER', min: 1, max: 10_000_000, why: 'at 0 the rejection-sampling bound is NaN and createChallenge spins forever on the thread that serves every route; above 10M the server would issue challenges verifySolution refuses' },
  { name: 'POW_TTL_SECONDS', min: 1, max: 600, why: 'at 0 every challenge is already expired when handed out; above 600 it trips verifySolution’s expires-too-far-ahead guard' },
  { name: 'SCAN_RATE_WINDOW_MS', min: 1000, why: 'a 0 ms window makes every request its own window, so the limiter counts to 1 forever and fails OPEN while still reporting limits in its headers' },
  { name: 'CHALLENGE_RATE_WINDOW_MS', min: 1000, why: 'same failure as SCAN_RATE_WINDOW_MS, on the cheaper endpoint that gates the expensive one' },
  { name: 'FETCH_TIMEOUT_MS', min: 100, max: 120_000, why: 'at 0 every scan aborts before the connection opens; unbounded, one hostile target holds a socket, a response buffer and an in-flight slot for as long as it likes' },
  { name: 'MAX_IN_FLIGHT_SCANS', min: 1, why: 'at 0 the global cap refuses every scan; it is also a divisor-free counter comparison, so there is no safe zero reading' },
];

export default check({
  id: 'rasp-tuning-bounds-unit',
  discipline: 'rasp',
  cadence: 'every-commit',
  severity: 'medium',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Every tuning knob whose zero hangs or disarms the service still declares a floor, and the challenge loop is still bounded.',
  async run(ctx) {
    const tuningPath = join(ctx.repoRoot, 'lib/tuning.ts');
    const altchaPath = join(ctx.repoRoot, 'lib/altcha.ts');
    for (const p of [tuningPath, altchaPath]) {
      if (!existsSync(p)) throw new ctx.Skip(`${p} not found — this check grades those two files and nothing else`);
    }
    const tuning = readFileSync(tuningPath, 'utf-8');
    const altcha = readFileSync(altchaPath, 'utf-8');
    const findings = [];
    let checked = 0;

    // ---- the validator itself --------------------------------------------
    checked++;
    const hasRangeGuard = /parsed\s*<\s*min/.test(tuning) && /parsed\s*>\s*max/.test(tuning) && /Number\.isSafeInteger\(parsed\)/.test(tuning);
    if (!hasRangeGuard) {
      findings.push(finding({
        severity: 'high',
        title: 'intEnv() no longer range-checks against a per-variable min and max',
        detail: 'Without `parsed < min || parsed > max` plus a safe-integer test, the old accept-any-non-negative behaviour is back, and with it POW_MAX_NUMBER=0 hanging the single thread that serves all seven routes.',
        evidence: `lib/tuning.ts: expected the guard to contain Number.isSafeInteger(parsed), parsed < min and parsed > max; found ${JSON.stringify((/if \(!?Number[\s\S]{0,140}/.exec(tuning) || ['(no match)'])[0].replace(/\s+/g, ' ').slice(0, 160))}`,
        remediation: 'Restore the bounded validator in intEnv(), and keep the console.warn — a silent fallback is how a panic-mode typo survives an incident.',
        file: 'lib/tuning.ts',
      }));
    }

    // ---- each dangerous knob ---------------------------------------------
    // Whitespace is normalised first because MAX_BODY_SIZE's call is split
    // across lines; the line number is recovered separately for the report.
    const flat = tuning.replace(/\s+/g, ' ');
    const lineOf = (name) => {
      const i = tuning.split('\n').findIndex((l) => l.includes(`intEnv('${name}'`));
      return i >= 0 ? i + 1 : null;
    };

    for (const knob of DANGEROUS) {
      checked++;
      const m = new RegExp(`intEnv\\(\\s*'${knob.name}'\\s*,\\s*([0-9_]+)\\s*(?:,\\s*([0-9_]+)\\s*)?(?:,\\s*([0-9_]+)\\s*)?\\)`).exec(flat);
      if (!m) {
        findings.push(finding({
          severity: 'medium',
          title: `${knob.name} is no longer read through intEnv() in lib/tuning.ts`,
          detail: 'Either the knob was renamed or removed, or it is now parsed somewhere this check cannot see. Both mean the floor is unverified.',
          evidence: `lib/tuning.ts: no intEnv('${knob.name}', …) call found`,
          remediation: 'If the knob moved, move this entry with it; if it is gone, delete the entry.',
          file: 'lib/tuning.ts',
        }));
        continue;
      }
      const num = (s) => (s === undefined ? null : Number(String(s).replace(/_/g, '')));
      const min = num(m[2]);
      const max = num(m[3]);
      if (min === null || min < knob.min) {
        findings.push(finding({
          severity: 'high',
          title: `${knob.name} accepts values below ${knob.min}`,
          detail: `One env typo is enough: ${knob.why}.`,
          evidence: `lib/tuning.ts${lineOf(knob.name) ? ':' + lineOf(knob.name) : ''}: ${m[0]} — min is ${min === null ? 'not given (defaults to 0)' : min}, needs to be at least ${knob.min}`,
          remediation: `Pass ${knob.min} as intEnv()'s third argument for ${knob.name}, and say in the comment what the floor protects.`,
          file: 'lib/tuning.ts',
          line: lineOf(knob.name),
        }));
      }
      if (knob.max !== undefined && (max === null || max > knob.max)) {
        findings.push(finding({
          severity: 'medium',
          title: `${knob.name} accepts values above ${knob.max}`,
          detail: `The ceiling is not cosmetic: ${knob.why}.`,
          evidence: `lib/tuning.ts${lineOf(knob.name) ? ':' + lineOf(knob.name) : ''}: ${m[0]} — max is ${max === null ? 'not given (defaults to MAX_SAFE_INTEGER)' : max}, needs to be at most ${knob.max}`,
          remediation: `Pass ${knob.max} as intEnv()'s fourth argument for ${knob.name}.`,
          file: 'lib/tuning.ts',
          line: lineOf(knob.name),
        }));
      }
    }

    // ---- the loop that actually hung --------------------------------------
    // tuning.ts is not the only caller: createChallenge is exported and takes
    // the number from whoever calls it, so the clamp has to live there too.
    checked++;
    const createStart = altcha.indexOf('export function createChallenge');
    const createBody = createStart >= 0 ? altcha.slice(createStart, createStart + 2500) : '';
    if (!createBody) {
      findings.push(finding({
        severity: 'medium',
        title: 'createChallenge() not found in lib/altcha.ts',
        detail: 'The function whose unbounded loop took the API down cannot be located, so its bound cannot be verified.',
        evidence: 'lib/altcha.ts: no "export function createChallenge" in the file',
        remediation: 'Point this check at wherever the challenge is now built.',
        file: 'lib/altcha.ts',
      }));
    } else {
      const bounded = /for\s*\(\s*let\s+draw\s*=\s*0\s*;\s*draw\s*<\s*MAX_SAMPLING_DRAWS/.test(createBody);
      const clamped = /Number\.isSafeInteger\(maxnumber\)\s*&&\s*maxnumber\s*>=\s*1/.test(createBody);
      const spins = /while\s*\(\s*true\s*\)/.test(createBody);
      if (!bounded || !clamped || spins) {
        findings.push(finding({
          severity: 'high',
          title: 'createChallenge’s rejection sampling is no longer provably terminating',
          detail: 'This is the loop that hung. A caller-supplied maxnumber must be clamped before any arithmetic depends on it, AND the draw loop must have a hard iteration bound — belt and braces, because the function is exported and does not get to assume lib/tuning.ts validated anything.',
          evidence: `lib/altcha.ts createChallenge(): bounded-draw-loop=${bounded}, maxnumber-clamp=${clamped}, contains-while(true)=${spins}`,
          remediation: 'Restore the `for (let draw = 0; draw < MAX_SAMPLING_DRAWS; draw++)` loop and the `Number.isSafeInteger(maxnumber) && maxnumber >= 1` span clamp.',
          file: 'lib/altcha.ts',
          line: altcha.slice(0, createStart).split('\n').length,
        }));
      }
    }

    return { findings, checked };
  },
});
