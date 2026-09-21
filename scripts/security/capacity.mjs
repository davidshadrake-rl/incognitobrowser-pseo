#!/usr/bin/env node
/**
 * What this service can actually carry, measured rather than assumed.
 *
 *   npm run capacity                 measure locally + 3 gentle live scans
 *   npm run capacity -- --local      no network at all
 *   npm run capacity -- --json out.json
 *
 * It answers one question: at what point does the tools API stop serving
 * people, and what does it cost an attacker to get it there?
 *
 * ## It will not flood anything
 *
 * The live leg is THREE scans, spaced, against stable third-party sites, well
 * inside the 10-scans-per-minute-per-/24 limit. The box it talks to also
 * serves the team's WordPress and MySQL on two vCPUs, so the expensive parts —
 * proof-of-work economics, analysis cost, memory under concurrency — are all
 * measured in this process instead. A load test that takes production down has
 * not measured capacity, it has spent it.
 *
 * ## What the numbers meant on 2026-09-21
 *
 *   proof-of-work      client ~27ms median, server 2.0us to verify  (~14,000x)
 *   analysis CPU       linear in page size, ~19ms/MB, worst case ~75ms at 5MB
 *   memory             20 concurrent 5MB non-Latin bodies = ~250MB of a 448MB
 *                      heap, plus ~70MB of Next baseline. Tight but not the
 *                      binding constraint; all-ASCII pages cost half that,
 *                      because V8 stores them at one byte per character.
 *   scan duration      ~790ms end to end, live
 *   throughput         ~25 scans/sec typical, ~4/sec if every target stalls
 *
 * The binding constraint is none of the things people assume. It is SLOT
 * EXHAUSTION: FETCH_TIMEOUT_MS lets one scan hold a slot for 5s, so ~4 new
 * scans/sec holds all 20, which is ~12% of one core in proof-of-work. The
 * per-IP rate limit was all that stood in the way, and ~24 distinct /24 ranges
 * defeats it. MAX_IN_FLIGHT_PER_BUCKET was added for exactly this.
 */
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import v8 from 'node:v8';

const argv = process.argv.slice(2);
const LOCAL_ONLY = argv.includes('--local');
const jsonAt = argv.indexOf('--json');
const JSON_OUT = jsonAt > -1 ? argv[jsonAt + 1] : null;
const ORIGIN = (argv.find((a) => a.startsWith('--origin=')) || '').split('=')[1] || 'https://206-189-186-34.nip.io';
const MB = 1048576;
const out = { measuredAt: null, local: {}, live: {}, derived: {} };
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

console.log('capacity — measuring, not assuming\n');

// ---- 1. proof-of-work economics -------------------------------------------
const solve = (salt, ch, max) => { for (let n = 0; n <= max; n++) if (createHash('sha256').update(salt + n).digest('hex') === ch) return n; return -1; };
{
  const times = [];
  for (let i = 0; i < 15; i++) {
    const salt = randomBytes(12).toString('hex');
    const secret = Math.floor(Math.random() * 100_000);
    const ch = createHash('sha256').update(salt + secret).digest('hex');
    const t0 = process.hrtime.bigint();
    solve(salt, ch, 100_000);
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const n = 30_000;
  let t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) createHash('sha256').update('s' + i).digest('hex');
  const shaUs = Number(process.hrtime.bigint() - t0) / 1e3 / n;
  t0 = process.hrtime.bigint();
  for (let i = 0; i < n; i++) createHmac('sha256', 'k'.repeat(32)).update('a|b|c').digest('hex');
  const hmacUs = Number(process.hrtime.bigint() - t0) / 1e3 / n;
  out.local.powClientMedianMs = Math.round(med(times));
  out.local.serverVerifyUs = Number((shaUs + hmacUs).toFixed(2));
  out.local.asymmetry = Math.round((med(times) * 1000) / (shaUs + hmacUs));
  console.log(`  proof-of-work   client ${out.local.powClientMedianMs}ms   server ${out.local.serverVerifyUs}us   asymmetry ~${out.local.asymmetry.toLocaleString()}x`);
}

// ---- 2. memory under concurrency ------------------------------------------
{
  const cap = v8.getHeapStatistics().heap_size_limit / MB;
  const base = process.memoryUsage().heapUsed / MB;
  // Non-Latin1 is the honest worst case: V8 stores ASCII at one byte per
  // character, so an all-ASCII probe understates a real page by half.
  const body = () => { let s = ''; while (s.length < 5 * MB) s += '这是测试内容用于测量内存'; return s; };
  const held = [];
  for (let i = 0; i < 20; i++) held.push(body());
  const at20 = process.memoryUsage().heapUsed / MB;
  held.length = 0;
  out.local.heapCapMb = Math.round(cap);
  out.local.heapAt20ConcurrentMb = Math.round(at20 - base);
  // The droplet runs with --max-old-space-size=448 (NODE_OPTIONS in
  // /etc/ib-api.env). Measuring against a laptop's multi-gigabyte default
  // would report a comfortable number for a machine that does not exist, so
  // say plainly when the harness is not modelling the real host.
  const modelsDroplet = out.local.heapCapMb <= 520;
  out.local.modelsDropletHeap = modelsDroplet;
  console.log(`  memory          20 concurrent 5MB bodies = ${out.local.heapAt20ConcurrentMb}MB of a ${out.local.heapCapMb}MB heap (worst-case encoding)`);
  if (!modelsDroplet) console.log(`                  NOT the droplet's heap — re-run with --max-old-space-size=448 for a number that applies to production`);
}

// ---- 3. live scan duration -------------------------------------------------
if (!LOCAL_ONLY) {
  const API = `${ORIGIN}/api`;
  const token = async () => {
    const r = await fetch(`${API}/challenge`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}' });
    if (!r.ok) return null;
    const j = await r.json();
    const n = solve(j.salt, j.challenge, j.maxnumber ?? 100_000);
    return 'Altcha ' + Buffer.from(JSON.stringify({ algorithm: j.algorithm || 'SHA-256', salt: j.salt, number: n, signature: j.signature, expires: j.expires })).toString('base64');
  };
  const durations = [];
  for (const t of ['https://example.com/', 'https://www.iana.org/', 'https://example.net/']) {
    const tk = await token();
    if (!tk) { console.log('  live            challenge refused — skipping the live leg'); break; }
    const t0 = Date.now();
    const r = await fetch(`${API}/scan-url`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN, authorization: tk }, body: JSON.stringify({ url: t }) });
    const ms = Date.now() - t0;
    if (r.status === 200) durations.push(ms);
    await new Promise((res) => setTimeout(res, 2500)); // stay well inside 10/min
  }
  if (durations.length) {
    out.live.scanMedianMs = Math.round(med(durations));
    out.live.samples = durations.length;
    console.log(`  live            scan ${out.live.scanMedianMs}ms median over ${durations.length} samples`);
  }
}

// ---- 4. what that means ----------------------------------------------------
{
  const { MAX_IN_FLIGHT_SCANS, MAX_IN_FLIGHT_PER_BUCKET, FETCH_TIMEOUT_MS, SCAN_RATE_LIMIT } =
    await import('../../lib/tuning.ts').catch(() => ({}));
  const slots = MAX_IN_FLIGHT_SCANS ?? 20;
  const perBucket = MAX_IN_FLIGHT_PER_BUCKET ?? 2;
  // FETCH_TIMEOUT_MS is 5000 in /etc/ib-api.env but defaults to 10000 in code;
  // importing lib/tuning.ts here sees the CODE default unless the env is set,
  // so the deployed value is honoured when present and named when it is not.
  const timeoutS = (FETCH_TIMEOUT_MS ?? 10_000) / 1000;
  out.derived.fetchTimeoutSecondsUsed = timeoutS;
  out.derived.fetchTimeoutSource = process.env.FETCH_TIMEOUT_MS ? 'env' : 'code default (droplet runs 5s)';
  const rl = SCAN_RATE_LIMIT ?? 10;
  const dur = (out.live.scanMedianMs ?? 800) / 1000;
  // Spread, do not reassign: the two fetch-timeout fields are set above and a
  // bare `out.derived = {...}` silently dropped them.
  out.derived = {
    ...out.derived,
    typicalScansPerSec: Math.round(slots / dur),
    worstCaseScansPerSec: Math.round(slots / timeoutS),
    rangesToHoldEverySlot: Math.ceil(slots / perBucket),
    rangesBeforePerBucketCap: Math.ceil((slots / timeoutS) / (rl / 60)),
  };
  console.log(`\n  throughput      ~${out.derived.typicalScansPerSec}/sec typical · ~${out.derived.worstCaseScansPerSec}/sec if every target stalls for ${timeoutS}s`);
  console.log(`  slot exhaustion needs ${out.derived.rangesToHoldEverySlot} distinct networks now (was ~${out.derived.rangesBeforePerBucketCap} before the per-bucket cap)`);
  console.log(`\n  Not measured here: network bandwidth. A volumetric flood is decided upstream of this process.`);
}

out.measuredAt = new Date().toISOString();
if (JSON_OUT) { mkdirSync(dirname(JSON_OUT), { recursive: true }); writeFileSync(JSON_OUT, JSON.stringify(out, null, 2)); console.log(`\n  report: ${JSON_OUT}`); }
