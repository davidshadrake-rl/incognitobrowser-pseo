/**
 * Per-page funnel numbers: which pages' funnels get read, run and clicked.
 *
 * Reads the day counters from POST /stats (app/stats/route.ts) over a range of
 * days and adds up the per-page keys lib/event-schema.ts writes:
 *   evt:<day>:page:funnel_view:<path>
 *   evt:<day>:page:funnel_run:<path>
 *   evt:<day>:page:result_shown:<path>:sev-<colour>
 *   evt:<day>:page:funnel_click:<path>:sev-<colour>:<target>
 * No person is ever counted, only events on a page.
 *
 * Usage:
 *   STATS_TOKEN=… npx tsx scripts/funnels/stats.ts [--days 14] [--base https://incognitobrowser-pseo.vercel.app] [--worst 40]
 *
 * Prints one row per page, worst run-to-click first among pages with enough
 * views to judge (the ones to rewrite next), then a CSV to stdout with --csv.
 */
const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DAYS = Number(arg('days', '14'));
const BASE = arg('base', 'https://incognitobrowser-pseo.vercel.app').replace(/\/$/, '');
const WORST = Number(arg('worst', '40'));
const MIN_VIEWS = Number(arg('min-views', '20'));
const CSV = args.includes('--csv');

interface Row { page: string; views: number; runs: number; results: number; clicks: number; bySeverity: Record<string, number> }

async function day(d: string): Promise<Record<string, number>> {
  const token = process.env.STATS_TOKEN;
  if (!token) throw new Error('Set STATS_TOKEN (the same value the Vercel project has).');
  const res = await fetch(`${BASE}/stats`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ day: d }),
  });
  if (res.status === 404) throw new Error(`${BASE}/stats is off: STATS_TOKEN isn't set on that deployment.`);
  if (!res.ok) throw new Error(`${BASE}/stats answered ${res.status} for ${d}`);
  const body = (await res.json()) as { counts: Record<string, number>; storage: string };
  if (body.storage !== 'redis') throw new Error(`${BASE} stores no events (no REDIS_URL): nothing to read.`);
  return body.counts;
}

async function main() {
  const rows = new Map<string, Row>();
  const row = (page: string) => {
    if (!rows.has(page)) rows.set(page, { page, views: 0, runs: 0, results: 0, clicks: 0, bySeverity: {} });
    return rows.get(page)!;
  };
  const today = new Date();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const counts = await day(d);
    for (const [key, n] of Object.entries(counts)) {
      const m = /^page:(funnel_view|funnel_run|result_shown|funnel_click):(\/[^:]*)(?::sev-(\w+))?(?::([\w-]+))?$/.exec(key);
      if (!m) continue;
      const [, event, page, sev] = m;
      const r = row(page);
      if (event === 'funnel_view') r.views += n;
      else if (event === 'funnel_run') r.runs += n;
      else if (event === 'result_shown') { r.results += n; if (sev) r.bySeverity[sev] = (r.bySeverity[sev] ?? 0) + n; }
      else r.clicks += n;
    }
  }
  const all = [...rows.values()];
  if (CSV) {
    console.log('page,views,runs,results,clicks,run_rate,click_rate,red,amber,green,info');
    for (const r of all) {
      const s = r.bySeverity;
      console.log([r.page, r.views, r.runs, r.results, r.clicks, r.views ? (r.runs / r.views).toFixed(3) : '', r.runs ? (r.clicks / r.runs).toFixed(3) : '', s.red ?? 0, s.amber ?? 0, s.green ?? 0, s.info ?? 0].join(','));
    }
    return;
  }
  const judged = all.filter((r) => r.views >= MIN_VIEWS);
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  console.log(`${DAYS} days · ${all.length} funnel pages with any events · ${judged.length} with ${MIN_VIEWS}+ views\n`);
  console.log('views  ran  clicked  page');
  for (const r of judged.sort((a, b) => a.clicks / (a.runs || 1) - b.clicks / (b.runs || 1)).slice(0, WORST)) {
    console.log(`${String(r.views).padStart(5)}  ${pct(r.runs, r.views).padStart(4)}  ${pct(r.clicks, r.runs).padStart(7)}  ${r.page}`);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
