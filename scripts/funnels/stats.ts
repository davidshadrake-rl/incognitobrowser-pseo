/**
 * Per-page funnel numbers: which pages' funnels get read, run and clicked.
 *
 * Reads the day counters from POST /stats (app/stats/route.ts) over a range of
 * days and adds up the keys lib/event-schema.ts writes:
 *   evt:<day>:page:funnel_view:<path>                            the entry card was seen (components/ToolEntryCard.tsx)
 *   evt:<day>:page:funnel_run:<path>                             its button was pressed
 *   evt:<day>:page:result_shown:<path>:sev-<colour>
 *   evt:<day>:page:cta_click:<path>:sev-<colour>:<target>        the result card's upgrade button (funnel_click on older days)
 *   evt:<day>:cta_click:<tool>:<platform>:<target>:b-<benefit>   which Pro benefit the clicked ask sold
 *   evt:<day>:result_card_placed:<tool>:<platform>:r-<reason>    what bringing the result card on screen did (lib/place-result.ts)
 * The benefit and the reason are counted per tool, not per page: the page key
 * doesn't carry them. No person is ever counted, only events on a page.
 *
 * Usage:
 *   STATS_TOKEN=… npx tsx scripts/funnels/stats.ts [--days 14] [--base https://incognitobrowser-pseo.vercel.app] [--worst 40] [--min-views 20]
 *
 * Prints one row per page, worst run-to-click first among pages with enough
 * views to judge (the ones to rewrite next), then clicks by benefit and card
 * placements per tool. --csv prints the per-page rows as CSV instead.
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

const COLOURS = ['red', 'amber', 'green', 'info'] as const;
const REASONS = ['scrolled', 'in-view', 'own-scroll', 'hidden', 'on-load'] as const;

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
  // "<benefit> <tool>" → clicks, and tool → reason → placements.
  const byBenefit = new Map<string, number>();
  const placed = new Map<string, Record<string, number>>();
  const today = new Date();
  for (let i = 0; i < DAYS; i++) {
    const d = new Date(today.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const counts = await day(d);
    for (const [key, n] of Object.entries(counts)) {
      let m = /^page:(funnel_view|funnel_run|result_shown|cta_click|funnel_click):(\/[^:]*)(?::sev-(\w+))?(?::([\w-]+))?$/.exec(key);
      if (m) {
        const [, event, page, sev] = m;
        const r = row(page);
        if (event === 'funnel_view') r.views += n;
        else if (event === 'funnel_run') r.runs += n;
        else if (event === 'result_shown') { r.results += n; if (sev) r.bySeverity[sev] = (r.bySeverity[sev] ?? 0) + n; }
        else r.clicks += n;
        continue;
      }
      if ((m = /^(?:cta_click|funnel_click):([\w-]+):[\w-]+:[\w-]+:b-([\w-]+)$/.exec(key))) {
        const k = `${m[2]} ${m[1]}`;
        byBenefit.set(k, (byBenefit.get(k) ?? 0) + n);
        continue;
      }
      if ((m = /^result_card_placed:([\w-]+):[\w-]+:r-([\w-]+)$/.exec(key))) {
        const t = placed.get(m[1]) ?? {};
        t[m[2]] = (t[m[2]] ?? 0) + n;
        placed.set(m[1], t);
      }
    }
  }
  const all = [...rows.values()];
  if (CSV) {
    console.log(`page,views,runs,results,clicks,run_rate,click_rate,${COLOURS.join(',')}`);
    for (const r of all) {
      console.log([r.page, r.views, r.runs, r.results, r.clicks, r.views ? (r.runs / r.views).toFixed(3) : '', r.runs ? (r.clicks / r.runs).toFixed(3) : '', ...COLOURS.map((c) => r.bySeverity[c] ?? 0)].join(','));
    }
    return;
  }
  const judged = all.filter((r) => r.views >= MIN_VIEWS);
  const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
  const col = (v: number | string, w: number) => String(v).padStart(w);
  console.log(`${DAYS} days · ${all.length} funnel pages with any events · ${judged.length} with ${MIN_VIEWS}+ views\n`);
  console.log(['views', ' runs', '  ran', 'results', ...COLOURS.map((c) => c.padStart(5)), 'clicks', 'clicked', 'page'].join('  '));
  for (const r of judged.sort((a, b) => a.clicks / (a.runs || 1) - b.clicks / (b.runs || 1)).slice(0, WORST)) {
    console.log([col(r.views, 5), col(r.runs, 5), col(pct(r.runs, r.views), 5), col(r.results, 7), ...COLOURS.map((c) => col(r.bySeverity[c] ?? 0, 5)), col(r.clicks, 6), col(pct(r.clicks, r.runs), 7), r.page].join('  '));
  }

  console.log('\nUpgrade clicks by the Pro benefit the card sold (every tool page, every target)');
  console.log('clicks  benefit           tool');
  for (const [k, n] of [...byBenefit].sort((a, b) => b[1] - a[1])) {
    const [benefit, tool] = k.split(' ');
    console.log(`${col(n, 6)}  ${benefit.padEnd(16)}  ${tool}`);
  }

  console.log('\nResult card placements per tool (own-scroll: the visitor had scrolled away; hidden: the upgrade band was hidden, as for Pro inside the app)');
  console.log([...REASONS.map((r) => col(r, 10)), 'tool'].join('  '));
  for (const [tool, t] of [...placed].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log([...REASONS.map((r) => col(t[r] ?? 0, 10)), tool].join('  '));
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
