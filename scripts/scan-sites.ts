/**
 * Site Privacy Report Cards — offline batch scanner.
 *
 * Reads a candidate list (domain|finalHost per line, from the dev-time
 * liveness probe), fetches each homepage with redirects FOLLOWED (a report
 * card is about the site a visitor lands on), analyzes it with the exact
 * same lib/scanner.ts code the public /scan-url API uses, grades it with
 * lib/site-grade.ts, and writes data/sites/<host>.json.
 *
 * Runs on a dev machine, not on Vercel: results are committed so builds
 * are deterministic and the site never scans at request time.
 *
 * Re-run monthly. If a previous result exists, the prior summary+grade is
 * kept in `history` so pages can show "changed since last scan".
 *
 * Usage:
 *   npx tsx scripts/scan-sites.ts <candidates.psv> [--limit 500] [--concurrency 8]
 */
import fs from 'node:fs';
import path from 'node:path';
import { analyzeScan, readCappedText, isBlockedHostname } from '../lib/scanner';
import { gradeSite } from '../lib/site-grade';
import { categorize } from '../lib/site-categories';

/**
 * Report-card domains are URL path segments and filenames: lowercase, no
 * "www.". Two cards once shipped as Princeton.EDU and WWW.garmin.com, so
 * /site/princeton.edu was a 404 and a later garmin.com scan would have
 * duplicated the page (audit 2026-09-08). Guarded by tests/sites-data.test.ts.
 */
function normalizeDomain(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, '');
}

const OUT_DIR = path.resolve(__dirname, '..', 'data', 'sites');

const args = process.argv.slice(2);
const input = args.find((a) => !a.startsWith('--'));
const opt = (name: string, def: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : def;
};
const LIMIT = opt('limit', 500);
const CONCURRENCY = opt('concurrency', 8);
if (!input) {
  console.error('usage: scan-sites.ts <candidates.psv> [--limit N] [--concurrency N]');
  process.exit(1);
}

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
// Same caps as the public API's defaults (lib/tuning.ts), so a report card
// and a live scan of the same page see the same thing.
const LIMITS = { maxCookies: 100, maxScriptMatches: 5000, maxThirdPartyDomains: 50 };
const MAX_BODY = 5 * 1024 * 1024;
const TIMEOUT_MS = 12_000;

// Dedupe by final host, preserve rank order.
const seen = new Set<string>();
const hosts: string[] = [];
for (const line of fs.readFileSync(input, 'utf8').split('\n')) {
  const [, final] = line.trim().split('|');
  if (!final || seen.has(final) || isBlockedHostname(final)) continue;
  seen.add(final);
  hosts.push(final);
}
console.log(`candidates: ${hosts.length} unique hosts; target ${LIMIT}`);

fs.mkdirSync(OUT_DIR, { recursive: true });

async function scanOne(host: string) {
  const targetUrl = `https://${host}/`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(targetUrl, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'en-US,en;q=0.9' },
    });
    if (response.status !== 200) return null;
    const ctype = response.headers.get('content-type') || '';
    if (!/text\/html/i.test(ctype)) return null;
    const finalUrl = new URL(response.url || targetUrl);
    const html = await readCappedText(response, MAX_BODY);
    if (!/<html|<!doctype html/i.test(html.slice(0, 2000))) return null;
    const scan = analyzeScan(finalUrl.toString(), finalUrl, response, html, LIMITS);
    const grade = gradeSite(scan);
    const titleMatch = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : host;
    return { host, finalUrl: finalUrl.toString(), title, scan, grade };
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

let done = 0;
let written = 0;
let idx = 0;
const startedAt = new Date().toISOString();

async function worker() {
  while (written < LIMIT && idx < hosts.length) {
    const host = hosts[idx++];
    const r = await scanOne(host);
    done++;
    if (!r) continue;
    if (written >= LIMIT) break;
    const file = path.join(OUT_DIR, `${host}.json`);
    let history: unknown[] = [];
    if (fs.existsSync(file)) {
      try {
        const prev = JSON.parse(fs.readFileSync(file, 'utf8'));
        history = [...(prev.history || []), { scannedAt: prev.scannedAt, grade: prev.grade?.grade, score: prev.grade?.score, summary: prev.scan?.summary }].slice(-12);
      } catch { /* ignore */ }
    }
    const doc = {
      domain: normalizeDomain(host), // lowercase, no www. — the filename and the URL path derive from this
      finalUrl: r.finalUrl,
      title: r.title,
      category: categorize(host),
      scannedAt: startedAt,
      grade: r.grade,
      scan: {
        status: r.scan.status,
        cookies: r.scan.cookies.map(({ raw, ...c }) => c), // never persist raw cookie values
        trackers: r.scan.trackers,
        inlineTrackers: r.scan.inlineTrackers,
        thirdPartyDomains: r.scan.thirdPartyDomains,
        security: r.scan.security,
        summary: r.scan.summary,
      },
      history,
      editorial: { status: 'published', reviewedAt: startedAt, reviewedBy: 'David Shadrake', notes: 'Automated report card from our own scanner; methodology published on the page.' },
      author: null,
    };
    fs.writeFileSync(file, JSON.stringify(doc, null, 2) + '\n');
    written++;
    if (written % 25 === 0) console.log(`  ${written} written (${done} tried) — latest ${host} → ${r.grade.grade} ${r.grade.score}`);
  }
}

async function main() {
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`done: ${written} report cards written, ${done} hosts tried, ${hosts.length - idx} untried`);
}
main().catch((e) => { console.error(e); process.exit(1); });
