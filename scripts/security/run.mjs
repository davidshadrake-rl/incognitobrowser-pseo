#!/usr/bin/env node
/**
 * The security suite runner.
 *
 *   npm run security                     every-commit checks (fast, offline)
 *   npm run security:nightly             + the live probes and droplet posture
 *   npm run security:weekly              + drift and freshness
 *   node scripts/security/run.mjs --all --strict --json reports/sec.json
 *
 * Flags:
 *   --cadence=every-commit|nightly|weekly|on-demand   (repeatable, default every-commit)
 *   --all                  every cadence except on-demand
 *   --only=<id>[,<id>]     run just these checks, whatever their cadence
 *   --opt-in=<id>[,<id>]   allow checks that are withheld by default because
 *                          they put real load on a box that also serves the
 *                          team's WordPress. `--opt-in=all` allows every one.
 *   --strict               a SKIPPED check fails the run
 *   --fail-on=<severity>   exit non-zero at or above this (default: high)
 *   --json=<path>          write the machine-readable report
 *   --origin= / --api=     point at somewhere other than .secrets' SITE_ORIGIN
 *   --quiet                findings and the summary only
 *
 * Exit codes: 0 clean · 1 findings at or above --fail-on · 2 a check crashed
 * (a bug in the check itself) · 3 skipped under --strict.
 *
 * Why a runner rather than "just more vitest": a third of these checks need
 * the network or an ssh session to the droplet, which has no place in the unit
 * suite that gates every build. The offline half DOES live in vitest — see
 * tests/ — precisely because `npm run build` and scripts/deploy-api.sh already
 * run `vitest run`, which makes those checks deploy-blocking for free.
 */
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildContext } from './lib/context.mjs';
import { SEVERITIES } from './lib/harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
/**
 * Accepts BOTH `--json=path` and `--json path`.
 *
 * It only took the `=` form at first, so `--json reports/x.json` parsed as the
 * boolean true and the path became a stray argument — the run worked, printed
 * its summary, and silently wrote no report. install-schedule.sh uses the space
 * form, so every scheduled run would have produced nothing to read, which is
 * precisely the quiet nothing-happened failure this suite exists to catch.
 */
const flag = (name, dflt = null) => {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return dflt;
  const hit = argv[i];
  if (hit.includes('=')) return hit.slice(hit.indexOf('=') + 1);
  const next = argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
};
const list = (name) => String(flag(name, '') || '').split(',').map((s) => s.trim()).filter(Boolean);

const CADENCES = argv.includes('--all')
  ? ['every-commit', 'nightly', 'weekly']
  : (argv.filter((a) => a.startsWith('--cadence=')).map((a) => a.split('=')[1]).filter(Boolean) || []);
if (!CADENCES.length && !argv.includes('--all')) CADENCES.push('every-commit');
const ONLY = list('only');
const OPT_IN = list('opt-in');
const STRICT = Boolean(flag('strict', false));
const QUIET = Boolean(flag('quiet', false));
const FAIL_ON = String(flag('fail-on', 'high'));
const JSON_OUT = flag('json', null);
if (!SEVERITIES.includes(FAIL_ON)) { console.error(`--fail-on must be one of ${SEVERITIES.join('|')}`); process.exit(2); }

const RANK = Object.fromEntries(SEVERITIES.map((s, i) => [s, SEVERITIES.length - i]));
const C = process.stdout.isTTY
  ? { red: (s) => `\x1b[31m${s}\x1b[0m`, yellow: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` }
  : { red: (s) => s, yellow: (s) => s, green: (s) => s, dim: (s) => s, bold: (s) => s };

async function loadChecks() {
  const dir = join(HERE, 'checks');
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort(); } catch { return []; }
  const out = [];
  for (const f of files) {
    const mod = await import(pathToFileURL(join(dir, f)).href);
    const defs = Array.isArray(mod.default) ? mod.default : [mod.default];
    for (const d of defs) if (d && d.id) out.push({ ...d, file: f });
  }
  return out;
}

const all = await loadChecks();
if (!all.length) { console.error('No checks found in scripts/security/checks/.'); process.exit(2); }

const ids = new Set(all.map((c) => c.id));
for (const id of [...ONLY, ...OPT_IN]) {
  if (id !== 'all' && !ids.has(id)) { console.error(`unknown check id: ${id}`); process.exit(2); }
}

const optInAll = OPT_IN.includes('all');
const selected = all.filter((c) => {
  if (ONLY.length) return ONLY.includes(c.id);
  if (!CADENCES.includes(c.cadence)) return false;
  if (c.needsOptIn && !optInAll && !OPT_IN.includes(c.id)) return false;
  return true;
});

// Withheld checks are ANNOUNCED. A suite that quietly drops a third of itself
// and prints "all clear" is the exact failure this project keeps finding.
const withheld = all.filter((c) => c.needsOptIn && !selected.includes(c) && (ONLY.length ? false : CADENCES.includes(c.cadence)));

const ctx = buildContext({ origin: flag('origin', null), api: flag('api', null) });
if (!QUIET) {
  console.log(C.bold(`security suite · ${selected.length} checks · ${ONLY.length ? 'only' : CADENCES.join(', ')} · target ${ctx.origin}`));
  console.log(C.dim(`fail-on=${FAIL_ON}${STRICT ? ' strict' : ''}\n`));
}

const results = [];
for (const c of selected) {
  const started = Date.now();
  try {
    const r = await c.run(ctx);
    const findings = (r && r.findings) || [];
    const checked = (r && typeof r.checked === 'number') ? r.checked : null;
    results.push({ ...meta(c), state: 'ran', findings, checked, ms: Date.now() - started });
  } catch (err) {
    if (err && err.isSkip) {
      results.push({ ...meta(c), state: 'skipped', reason: err.message, findings: [], checked: 0, ms: Date.now() - started });
    } else {
      results.push({ ...meta(c), state: 'error', reason: `${err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err}`, findings: [], checked: 0, ms: Date.now() - started });
    }
  }
  if (!QUIET) print(results[results.length - 1]);
}

function meta(c) {
  return { id: c.id, discipline: c.discipline, cadence: c.cadence, describe: c.describe, file: c.file, needsOptIn: Boolean(c.needsOptIn) };
}

function print(r) {
  const n = r.findings.length;
  // "0 findings over 0 items" is not a pass — it is a check that looked at
  // nothing, and it prints as NOTHING-CHECKED rather than a reassuring tick.
  const vacuous = r.state === 'ran' && n === 0 && r.checked === 0;
  const tag = r.state === 'skipped' ? C.yellow('SKIP')
    : r.state === 'error' ? C.red('ERROR')
    : n ? C.red(`${n} FINDING${n > 1 ? 'S' : ''}`)
    : vacuous ? C.yellow('NOTHING CHECKED')
    : C.green('ok');
  const scope = r.checked === null ? '' : C.dim(` ${r.checked} checked`);
  console.log(`  ${tag.padEnd(22)} ${r.id.padEnd(42)}${scope}${C.dim(` ${r.ms}ms`)}`);
  if (r.reason) console.log(C.dim(`      ${r.reason}`));
  for (const f of r.findings) {
    console.log(`      ${sevColour(f.severity)} ${C.bold(f.title)}`);
    console.log(C.dim(`        where: ${f.file ? `${f.file}${f.line ? ':' + f.line : ''}` : r.id}`));
    console.log(C.dim(`        saw:   ${String(f.evidence).replace(/\n/g, ' ').slice(0, 220)}`));
    if (f.remediation) console.log(C.dim(`        fix:   ${String(f.remediation).replace(/\n/g, ' ').slice(0, 220)}`));
  }
}
function sevColour(s) {
  const t = `[${s}]`;
  return s === 'critical' || s === 'high' ? C.red(t) : s === 'medium' ? C.yellow(t) : C.dim(t);
}

const findings = results.flatMap((r) => r.findings.map((f) => ({ ...f, check: r.id, discipline: r.discipline })));
const skipped = results.filter((r) => r.state === 'skipped');
const errored = results.filter((r) => r.state === 'error');
const vacuous = results.filter((r) => r.state === 'ran' && r.findings.length === 0 && r.checked === 0);
const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, findings.filter((f) => f.severity === s).length]));
const blocking = findings.filter((f) => RANK[f.severity] >= RANK[FAIL_ON]);

console.log('');
console.log(C.bold('summary'));
console.log(`  ran ${results.length - skipped.length - errored.length}/${results.length} · findings ${findings.length} (${SEVERITIES.map((s) => `${s} ${bySeverity[s]}`).join(', ')})`);
if (skipped.length) console.log(C.yellow(`  skipped ${skipped.length}: ${skipped.map((r) => r.id).join(', ')}`));
if (errored.length) console.log(C.red(`  ERRORED ${errored.length}: ${errored.map((r) => r.id).join(', ')} — these are bugs in the checks, not results`));
if (vacuous.length) console.log(C.yellow(`  checked nothing: ${vacuous.map((r) => r.id).join(', ')} — a check that inspected 0 items proved nothing`));
if (withheld.length) console.log(C.dim(`  withheld (need --opt-in): ${withheld.map((r) => r.id).join(', ')}`));

if (JSON_OUT && typeof JSON_OUT === 'string') {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({
    target: ctx.origin, cadences: CADENCES, only: ONLY, optIn: OPT_IN, failOn: FAIL_ON, strict: STRICT,
    counts: { checks: results.length, findings: findings.length, skipped: skipped.length, errored: errored.length, ...bySeverity },
    withheld: withheld.map((r) => r.id),
    results,
  }, null, 2));
  console.log(C.dim(`  report: ${JSON_OUT}`));
}

if (errored.length) { console.log(C.red('\nFAIL — a check crashed')); process.exit(2); }
if (blocking.length) { console.log(C.red(`\nFAIL — ${blocking.length} finding(s) at or above ${FAIL_ON}`)); process.exit(1); }
if (STRICT && skipped.length) { console.log(C.yellow('\nFAIL — checks were skipped and --strict is on')); process.exit(3); }
console.log(C.green(`\nPASS — nothing at or above ${FAIL_ON}`));
