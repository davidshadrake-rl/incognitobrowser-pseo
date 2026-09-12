/**
 * Per-page funnel, Phase A step 5: the interactive review page.
 *
 * Generates one self-contained HTML file from funnel-drafts/records.json: every
 * page's five-step funnel as the visitor would see it, with filters, and
 * Approve / Flag / Comment per page. Decisions live in the artifact's shared
 * database (capability `db`) — collection `reviews`, one document per topic,
 * one entry per page — so the owner and the CTO review the same state and it
 * can be read back with the Artifact tool's read_db.
 *
 * Usage: npx tsx scripts/funnels/review-page.ts <out.html> [--only-drafted]
 */
import fs from 'fs';
import path from 'path';
import { validate } from './validate';
import { PAIRINGS } from './assemble-data';

const out = process.argv[2];
if (!out) throw new Error('usage: review-page.ts <out.html> [--only-drafted]');
const onlyDrafted = process.argv.includes('--only-drafted');

type Rec = {
  id: string; url: string; site: string; type: string; topic: string | null; topicName: string | null; title: string;
  published: boolean; check: { engine: string; tier: string; name: string } | null; proTool: { name: string; path: string } | null;
  placement: string; handoff: { topic: string | null; from: string }; noFunnel?: string; note?: string;
  units: Array<{ key: string; label: string; text: string; detail?: string }>;
  funnel?: { step1: { unitKey: string; label: string; quote: string }; step2: { engine: string; heading: string; instruction: string; button: string }; step3: { red: string; amber: string; green: string }; step4: { line: string }; step5: { label: string } };
};
const all = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'funnel-drafts', 'records.json'), 'utf-8')) as Rec[];
const { errors, warnings } = validate(all as never);
const issues = new Map<string, string[]>();
for (const e of [...errors.map((x) => `error: ${x}`), ...warnings.map((x) => `note: ${x}`)]) {
  const url = e.replace(/^(error|note): /, '').split(':')[0];
  issues.set(url, [...(issues.get(url) ?? []), e.replace(`${url}: `, '')]);
}

const pages = all
  .filter((r) => !r.noFunnel && (!onlyDrafted || r.funnel))
  .map((r) => ({
    id: r.id, key: r.id.replace(/\./g, '_'), url: r.url, site: r.site, type: r.type, topic: r.topic, topicName: r.topicName,
    title: r.title, published: r.published, placement: r.placement, check: r.check, proTool: r.proTool, handoff: r.handoff,
    funnel: r.funnel ?? null, note: r.note ?? null, issues: issues.get(r.url) ?? [],
  }));
const noFunnel = all.filter((r) => r.noFunnel).map((r) => ({ id: r.id, key: r.id.replace(/\./g, '_'), url: r.url, why: r.noFunnel }));
const pairings = Object.entries(PAIRINGS).map(([topic, p]) => ({ topic, engine: p.engine, why: p.why, pages: all.filter((r) => r.topic === topic && r.check?.engine === p.engine).length }));
const LIVE = 'https://incognitobrowser-pseo.vercel.app';
const PRO_LIVE = 'https://incognitobrowser-pro.vercel.app';
const data = JSON.stringify({ pages, noFunnel, pairings, live: LIVE, proLive: PRO_LIVE, total: all.length }).replace(/</g, '\\u003c');

const html = `<title>Per-Page Funnel Review</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">
<style>
  :root {
    --ground:#111214; --surface:#191b1c; --raised:#22232b; --line:#ffffff24; --line-strong:#ffffff4d;
    --t1:#fff; --t2:#b8b8d4; --t3:#8c8ca6; --pro:#41b4f6; --pro-ink:#06121a; --pro-dim:#41b4f61f;
    --ok:#4ade80; --ok-dim:#4ade801f; --warn:#facc15; --warn-dim:#facc151f; --danger:#f87171; --danger-dim:#f871711f;
    --mono:"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
    --sans:"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) {
    --ground:#f4f4f8; --surface:#fff; --raised:#ececf3; --line:#16161d1f; --line-strong:#16161d40;
    --t1:#16161d; --t2:#43435a; --t3:#6a6a82; --pro:#0a78ba; --pro-ink:#fff; --pro-dim:#0a78ba14;
    --ok:#15803d; --ok-dim:#15803d14; --warn:#a16207; --warn-dim:#a1620714; --danger:#b91c1c; --danger-dim:#b91c1c14; } }
  :root[data-theme="light"] {
    --ground:#f4f4f8; --surface:#fff; --raised:#ececf3; --line:#16161d1f; --line-strong:#16161d40;
    --t1:#16161d; --t2:#43435a; --t3:#6a6a82; --pro:#0a78ba; --pro-ink:#fff; --pro-dim:#0a78ba14;
    --ok:#15803d; --ok-dim:#15803d14; --warn:#a16207; --warn-dim:#a1620714; --danger:#b91c1c; --danger-dim:#b91c1c14; }
  * { box-sizing: border-box; }
  body { background: var(--ground); color: var(--t2); font-family: var(--sans); font-size: 15px; line-height: 1.55; }
  .wrap { max-width: 1240px; margin: 0 auto; padding: 28px 20px 80px; }
  h1, h2, h3 { font-family: var(--mono); color: var(--t1); margin: 0; }
  h1 { font-size: 24px; font-weight: 600; }
  .sub { color: var(--t3); margin-top: 6px; max-width: 80ch; }
  .bar { position: sticky; top: 0; z-index: 5; background: var(--ground); padding: 12px 0; border-bottom: 1px solid var(--line); margin-top: 16px; display: grid; gap: 10px; }
  .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  select, input[type=search], textarea { font: inherit; color: var(--t1); background: var(--surface); border: 1px solid var(--line-strong); border-radius: 8px; padding: 7px 10px; }
  input[type=search] { min-width: 240px; flex: 1; }
  button { font-family: var(--mono); font-size: 13px; border-radius: 8px; padding: 7px 12px; border: 1px solid var(--line-strong); background: var(--surface); color: var(--t1); cursor: pointer; }
  button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid var(--pro); outline-offset: 2px; }
  button[aria-pressed=true].ok { background: var(--ok-dim); border-color: var(--ok); color: var(--ok); }
  button[aria-pressed=true].fl { background: var(--warn-dim); border-color: var(--warn); color: var(--warn); }
  .tabs { display: flex; gap: 6px; }
  .tabs button[aria-selected=true] { background: var(--raised); border-color: var(--t3); }
  .meter { display: flex; gap: 14px; font-family: var(--mono); font-size: 13px; color: var(--t3); font-variant-numeric: tabular-nums; }
  .meter b { color: var(--t1); }
  .sync { font-family: var(--mono); font-size: 12px; color: var(--t3); }
  .cards { display: grid; gap: 14px; margin-top: 14px; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; }
  .card.approved { border-left: 4px solid var(--ok); }
  .card.flagged { border-left: 4px solid var(--warn); }
  .head { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: baseline; }
  .head h3 { font-size: 15px; font-weight: 600; }
  .head a { font-family: var(--mono); font-size: 12px; color: var(--t3); word-break: break-all; }
  .chip { font-family: var(--mono); font-size: 11px; letter-spacing: .03em; border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 6px; color: var(--t2); }
  .chip.pro { border-color: var(--pro); color: var(--pro); background: var(--pro-dim); }
  .chip.err { border-color: var(--danger); color: var(--danger); background: var(--danger-dim); }
  .steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; margin-top: 12px; }
  @media (max-width: 1000px) { .steps { grid-template-columns: 1fr 1fr; } }
  @media (max-width: 620px) { .steps { grid-template-columns: 1fr; } }
  .st { border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font-size: 13.5px; min-width: 0; }
  .st.s4 { border-color: var(--pro); background: var(--pro-dim); }
  .st .n { font-family: var(--mono); font-size: 11px; color: var(--t3); text-transform: uppercase; letter-spacing: .06em; }
  .st .k { font-family: var(--mono); font-size: 11px; color: var(--t3); margin-top: 4px; }
  .st .q { color: var(--t1); font-weight: 500; margin-top: 2px; }
  .st .btn { display: inline-block; margin-top: 8px; font-family: var(--mono); font-size: 12px; padding: 4px 8px; border-radius: 6px; background: var(--t1); color: var(--ground); }
  .st .btn.pro { background: var(--pro); color: var(--pro-ink); }
  .sev { display: grid; grid-template-columns: 10px 1fr; gap: 6px; margin-top: 4px; }
  .sev i { width: 8px; height: 8px; border-radius: 50%; margin-top: 6px; }
  .params { font-family: var(--mono); font-size: 11px; color: var(--t3); word-break: break-all; margin-top: 6px; }
  .pending { color: var(--t3); font-style: italic; }
  .foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: flex-start; margin-top: 12px; }
  .foot textarea { flex: 1; min-width: 240px; min-height: 38px; resize: vertical; font-size: 13.5px; }
  .issues { margin-top: 10px; font-size: 12.5px; color: var(--danger); font-family: var(--mono); }
  .issues .note { color: var(--t3); }
  .notebox { margin-top: 8px; font-size: 12.5px; color: var(--t3); }
  .more { margin: 18px auto 0; display: block; }
  .empty { color: var(--t3); padding: 30px 0; text-align: center; }
  table { border-collapse: collapse; width: 100%; font-size: 14px; }
  th, td { text-align: left; vertical-align: top; padding: 10px 12px; border-bottom: 1px solid var(--line); }
  th { font-family: var(--mono); font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: var(--t3); font-weight: 500; }
  .tbl { overflow-x: auto; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; margin-top: 14px; }
</style>
<div class="wrap">
  <h1>Per-page funnel review</h1>
  <p class="sub">Every page's five steps, as a visitor would see them: <b>1</b> the page's problem → <b>2</b> a free check inside the page → <b>3</b> their result → <b>4</b> what Pro does about it → <b>5</b> the upgrade page. Approve what's right, flag what isn't and say why. Your marks save for everyone reviewing.</p>
  <div class="bar">
    <div class="row">
      <div class="tabs" role="tablist">
        <button role="tab" aria-selected="true" data-tab="pages">Pages</button>
        <button role="tab" aria-selected="false" data-tab="pairings">Checks for no-tool topics</button>
        <button role="tab" aria-selected="false" data-tab="nofunnel">Pages without a funnel</button>
      </div>
      <div class="meter" aria-live="polite"><span>approved <b id="m-ok">0</b></span><span>flagged <b id="m-fl">0</b></span><span>to review <b id="m-todo">0</b></span><span id="m-total"></span></div>
      <span class="sync" id="sync">Connecting…</span>
    </div>
    <div class="row" id="filters">
      <label class="sr" hidden for="f-type">Type</label><select id="f-type" aria-label="Page type"><option value="">All page types</option></select>
      <select id="f-topic" aria-label="Topic"><option value="">All topics</option></select>
      <select id="f-status" aria-label="Status"><option value="">Any status</option><option value="todo">To review</option><option value="approved">Approved</option><option value="flagged">Flagged</option><option value="issues">Has validator issues</option></select>
      <input type="search" id="f-q" placeholder="Search title, URL or funnel text" aria-label="Search">
      <button id="bulk">Approve all shown</button>
    </div>
  </div>
  <div id="view"></div>
</div>
<script type="application/json" id="data">${data}</script>
<script>
(() => {
  const D = JSON.parse(document.getElementById('data').textContent);
  const $ = (s, el = document) => el.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let reviews = {};
  let db = null;
  let tab = 'pages';
  let shown = 40;
  const docKey = (p) => p.topic || '_site';
  const byKey = new Map(D.pages.map((p) => [p.key, p]));

  const types = [...new Set(D.pages.map((p) => p.type))].sort();
  const topics = [...new Map(D.pages.filter((p) => p.topic).map((p) => [p.topic, p.topicName])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  for (const t of types) $('#f-type').insertAdjacentHTML('beforeend', '<option value="' + esc(t) + '">' + esc(t) + '</option>');
  for (const [k, n] of topics) $('#f-topic').insertAdjacentHTML('beforeend', '<option value="' + esc(k) + '">' + esc(n) + '</option>');
  $('#m-total').textContent = 'of ' + D.pages.length + ' funnels';

  function statusOf(key) { return (reviews[key] && reviews[key].s) || ''; }
  function filtered() {
    const t = $('#f-type').value, tp = $('#f-topic').value, st = $('#f-status').value, q = $('#f-q').value.trim().toLowerCase();
    return D.pages.filter((p) => {
      if (t && p.type !== t) return false;
      if (tp && p.topic !== tp) return false;
      const s = statusOf(p.key);
      if (st === 'todo' && s) return false;
      if (st === 'approved' && s !== 'approved') return false;
      if (st === 'flagged' && s !== 'flagged') return false;
      if (st === 'issues' && !p.issues.length) return false;
      if (q) {
        const hay = (p.title + ' ' + p.url + ' ' + JSON.stringify(p.funnel || {})).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }
  function meter() {
    let ok = 0, fl = 0;
    for (const p of D.pages) { const s = statusOf(p.key); if (s === 'approved') ok++; else if (s === 'flagged') fl++; }
    $('#m-ok').textContent = ok; $('#m-fl').textContent = fl; $('#m-todo').textContent = D.pages.length - ok - fl;
  }
  function live(p) { return (p.site === 'pro' ? D.proLive : D.live) + p.url; }
  function card(p) {
    const r = reviews[p.key] || {};
    const f = p.funnel;
    const isPro = (e) => ['cookie-analyzer', 'browser-privacy', 'url-analyzer', 'metadata-viewer'].includes(e);
    const steps = f ? [
      '<div class="st"><div class="n">1 · Problem</div><div class="k">' + esc(f.step1.label) + '</div><div class="q">“' + esc(f.step1.quote) + '”</div></div>',
      '<div class="st"><div class="n">2 · Free check</div><div class="q">' + esc(f.step2.heading) + '</div><div>' + esc(f.step2.instruction) + '</div><span class="btn">' + esc(f.step2.button) + '</span>' + (isPro(f.step2.engine) ? ' <span class="chip pro">Pro · free for now</span>' : '') + '<div class="k">' + esc(p.placement) + '</div></div>',
      '<div class="st"><div class="n">3 · Their result</div><div class="sev"><i style="background:var(--danger)"></i><span>' + esc(f.step3.red) + '</span></div><div class="sev"><i style="background:var(--warn)"></i><span>' + esc(f.step3.amber) + '</span></div><div class="sev"><i style="background:var(--ok)"></i><span>' + esc(f.step3.green) + '</span></div></div>',
      '<div class="st s4"><div class="n">4 · What Pro does</div><div>' + esc(f.step4.line) + '</div>' + (p.proTool ? '<div class="k">Pro tool: ' + esc(p.proTool.name) + '</div>' : '') + '</div>',
      '<div class="st"><div class="n">5 · Upgrade page</div><span class="btn pro">' + esc(f.step5.label) + '</span><div class="params">?topic=' + esc(p.handoff.topic || 'none') + '&amp;from=' + esc(p.handoff.from) + '&amp;result=&lt;severity&gt;</div></div>',
    ].join('') : '<div class="st pending" style="grid-column:1/-1">Not drafted yet.</div>';
    return '<article class="card ' + esc(r.s || '') + '" data-key="' + esc(p.key) + '">' +
      '<div class="head"><h3>' + esc(p.title) + '</h3><a href="' + esc(live(p)) + '" target="_blank" rel="noopener">' + esc(p.url) + ' ↗</a>' +
      '<span class="chip">' + esc(p.type) + '</span>' + (p.topicName ? '<span class="chip">' + esc(p.topicName) + '</span>' : '') +
      (p.site === 'pro' ? '<span class="chip pro">Pro site</span>' : '') + (p.published ? '' : '<span class="chip">draft page</span>') +
      (p.issues.some((x) => x.startsWith('error')) ? '<span class="chip err">validator issue</span>' : '') + '</div>' +
      '<div class="steps">' + steps + '</div>' +
      (p.note ? '<div class="notebox">Writer’s note: ' + esc(p.note) + '</div>' : '') +
      (p.issues.length ? '<div class="issues">' + p.issues.map((x) => '<div class="' + (x.startsWith('note') ? 'note' : '') + '">' + esc(x) + '</div>').join('') + '</div>' : '') +
      '<div class="foot"><button class="ok" data-act="approved" aria-pressed="' + (r.s === 'approved') + '">Approve</button><button class="fl" data-act="flagged" aria-pressed="' + (r.s === 'flagged') + '">Flag</button>' +
      '<textarea placeholder="What should change? (saved when you leave the box)" aria-label="Comment for ' + esc(p.url) + '">' + esc(r.c || '') + '</textarea></div></article>';
  }
  function renderPages() {
    const list = filtered();
    $('#bulk').textContent = 'Approve all ' + list.length + ' shown';
    $('#bulk').disabled = !db || !list.length;
    if (!list.length) { $('#view').innerHTML = '<p class="empty">No funnels match these filters.</p>'; return; }
    $('#view').innerHTML = '<div class="cards">' + list.slice(0, shown).map(card).join('') + '</div>' +
      (list.length > shown ? '<button class="more" id="more">Show 40 more (' + (list.length - shown) + ' left)</button>' : '');
    const m = $('#more'); if (m) m.onclick = () => { shown += 40; render(); };
  }
  function renderPairings() {
    $('#view').innerHTML = '<p class="sub">Eight topics have no free tool that fits, so their pages use the nearest real check. Approve or flag each pairing; it applies to every page in that topic.</p><div class="tbl"><table><thead><tr><th>Topic</th><th>Check</th><th>Why it fits</th><th>Pages</th><th>Decision</th></tr></thead><tbody>' +
      D.pairings.map((x) => { const k = 'pairing_' + x.topic, r = reviews[k] || {}; return '<tr data-key="' + esc(k) + '"><td>' + esc(x.topic) + '</td><td>' + esc(x.engine) + '</td><td>' + esc(x.why) + '</td><td>' + x.pages + '</td><td class="foot" style="margin:0"><button class="ok" data-act="approved" aria-pressed="' + (r.s === 'approved') + '">Approve</button><button class="fl" data-act="flagged" aria-pressed="' + (r.s === 'flagged') + '">Flag</button><textarea aria-label="Comment for ' + esc(x.topic) + '">' + esc(r.c || '') + '</textarea></td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function renderNoFunnel() {
    $('#view').innerHTML = '<p class="sub">These pages get no funnel. Approve to confirm, or flag if one should have one.</p><div class="tbl"><table><thead><tr><th>Page</th><th>Why no funnel</th><th>Decision</th></tr></thead><tbody>' +
      D.noFunnel.map((x) => { const k = 'nofunnel_' + x.key, r = reviews[k] || {}; return '<tr data-key="' + esc(k) + '"><td><a href="' + esc(D.live + x.url) + '" target="_blank" rel="noopener">' + esc(x.url) + '</a></td><td>' + esc(x.why) + '</td><td class="foot" style="margin:0"><button class="ok" data-act="approved" aria-pressed="' + (r.s === 'approved') + '">Approve</button><button class="fl" data-act="flagged" aria-pressed="' + (r.s === 'flagged') + '">Flag</button><textarea aria-label="Comment for ' + esc(x.url) + '">' + esc(r.c || '') + '</textarea></td></tr>'; }).join('') + '</tbody></table></div>';
  }
  function render() {
    meter();
    $('#filters').hidden = tab !== 'pages';
    if (tab === 'pages') renderPages(); else if (tab === 'pairings') renderPairings(); else renderNoFunnel();
    for (const b of document.querySelectorAll('[data-act]')) b.disabled = !db;
  }
  function docFor(key) {
    if (key.startsWith('pairing_')) return '_pairings';
    if (key.startsWith('nofunnel_')) return '_nofunnel';
    const p = byKey.get(key); return p ? docKey(p) : '_site';
  }
  async function write(entries) {
    // entries: [[key, patch]] — grouped into one merge per topic document.
    const groups = new Map();
    for (const [key, patch] of entries) {
      const next = Object.assign({}, reviews[key] || {}, patch, { t: new Date().toISOString() });
      reviews[key] = next;
      const d = docFor(key);
      if (!groups.has(d)) groups.set(d, {});
      groups.get(d)[key] = next;
    }
    render();
    $('#sync').textContent = 'Saving…';
    try {
      for (const [d, body] of groups) {
        const ref = db.doc('reviews/' + d);
        try { await ref.update(body); }
        catch (e) {
          if (e && e.code === 'invalid_argument') { const snap = await ref.get(); if (!snap.exists) await ref.set(body); else throw e; }
          else throw e;
        }
      }
      $('#sync').textContent = 'Saved';
    } catch (e) {
      $('#sync').textContent = e && e.code === 'quota_exceeded' ? 'Not saved: storage is full' : 'Not saved — try again';
    }
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-act]');
    if (b && db) {
      const host = b.closest('[data-key]'); const key = host.dataset.key; const cur = (reviews[key] || {}).s;
      write([[key, { s: cur === b.dataset.act ? '' : b.dataset.act }]]);
      return;
    }
    const t = ev.target.closest('[role=tab]');
    if (t) { tab = t.dataset.tab; for (const x of document.querySelectorAll('[role=tab]')) x.setAttribute('aria-selected', String(x === t)); render(); }
  });
  document.addEventListener('focusout', (ev) => {
    const ta = ev.target.closest('textarea'); if (!ta || !db) return;
    const key = ta.closest('[data-key]').dataset.key; const val = ta.value.trim();
    if (val !== ((reviews[key] || {}).c || '')) write([[key, { c: val }]]);
  });
  $('#bulk').onclick = () => {
    const list = filtered().filter((p) => statusOf(p.key) !== 'approved');
    if (!list.length || !db) return;
    if (!confirm('Approve ' + list.length + ' funnels?')) return;
    write(list.map((p) => [p.key, { s: 'approved' }]));
  };
  for (const id of ['#f-type', '#f-topic', '#f-status']) $(id).onchange = () => { shown = 40; render(); };
  let qt; $('#f-q').oninput = () => { clearTimeout(qt); qt = setTimeout(() => { shown = 40; render(); }, 200); };
  render();

  (async () => {
    db = window.claude && window.claude.use ? await window.claude.use('db') : null;
    if (!db) { $('#sync').textContent = 'Read-only here: decisions can’t be saved in this view'; render(); return; }
    db.collection('reviews').onSnapshot((snap) => {
      const next = {};
      for (const d of snap.docs) Object.assign(next, d.data() || {});
      reviews = next; $('#sync').textContent = 'Saved decisions loaded'; render();
    }, () => { $('#sync').textContent = 'Lost connection — reload to keep reviewing'; });
    render();
  })();
})();
</script>
`;
fs.writeFileSync(out, html);
console.log(`review page: ${pages.length} funnels (${pages.filter((p) => p.funnel).length} drafted), ${noFunnel.length} no-funnel, ${pairings.length} pairings → ${out} (${(html.length / 1024).toFixed(0)} KB)`);
