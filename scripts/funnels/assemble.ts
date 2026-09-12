/**
 * Per-page funnel, Phase A step 2: one DRAFT record per page.
 *
 * Every page runs the same five-step funnel (owner, 2026-09-10):
 *   1 the page's problem  2 a free check (opens inside the page)
 *   3 the visitor's result  4 what the Pro subscription does about it
 *   5 the upgrade page, with the page's context attached.
 * This script fills the parts code can decide — which page, which topic,
 * which check, which Pro tool, where it sits, the handoff context — and
 * lists each page's own candidate units (steps, items, criteria, sections,
 * inputs, terms) for the wording pass to quote from. It writes nothing the
 * site reads: drafts go to funnel-drafts/ for review.
 *
 * Usage: npx tsx scripts/funnels/assemble.ts [--verify-out out]
 */
import fs from 'fs';
import path from 'path';
import { getContentFiles, getContentItem, getGlossaryFiles, getGlossaryItem, isPublished, nicheForGlossaryTerm, type EditableContent } from '../../lib/content';
import { getAllSites, isSitePublished } from '../../lib/sites';
import { getAllNiches, getAllContentTypes } from '../../lib/taxonomy';
import { PROOF_COPY, proofToolFor } from '../../lib/proof-route';
import { NICHE_HOOK } from '../../lib/cta-copy';
import { PRO_ENGINES, tierOfEngine } from '../../lib/tiers';

const ROOT = process.cwd();
const OUT_DIR = path.join(ROOT, 'funnel-drafts');

import { TOPIC_GROUP, GROUP_PRO, PRO_NAMES, PAIRINGS } from './assemble-data';

type PageType = 'home' | 'index' | 'topic-hub' | 'type-hub' | 'tool-hub' | 'guide' | 'checklist' | 'comparison' | 'template' | 'calculator' | 'glossary' | 'tool' | 'pro-tool' | 'report-card' | 'utility';

interface Unit { key: string; label: string; text: string; detail?: string }
interface Check { engine: string; tier: 'free' | 'pro'; name: string; gives: string; needs: string; origin: 'same-topic' | 'fallback' | 'pairing' | 'self' | 'card' }
export interface DraftRecord {
  id: string;
  url: string;
  site: 'free' | 'pro';
  type: PageType;
  topic: string | null;
  topicName: string | null;
  topicGroup: string | null;
  title: string;
  published: boolean;
  source: string | null;
  units: Unit[];
  facts?: Record<string, unknown>;
  check: Check | null;
  proTool: { engine: string; name: string; path: string } | null;
  placement: string;
  handoff: { topic: string | null; from: PageType };
  noFunnel?: string;
}

const clip = (s: unknown, n = 280) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
const idOf = (url: string) => (url === '/' ? 'home' : url.replace(/^\//, '').replace(/\//g, '~'));

const niches = getAllNiches();
const nicheName = new Map(niches.map((n) => [n.id, n.name]));
const typeName = new Map(getAllContentTypes().map((t) => [t.slug, t.name]));

function freeCheck(niche: string): Check | null {
  const pairing = PAIRINGS[niche];
  if (pairing) {
    const e = pairing.engine;
    const free = PROOF_COPY[e];
    return free
      ? { engine: e, tier: 'free', name: free.name, gives: free.gives, needs: free.needs, origin: 'pairing' }
      : { engine: e, tier: 'pro', name: PRO_NAMES[e], gives: pairing.why, needs: 'Free for now on the web.', origin: 'pairing' };
  }
  const r = proofToolFor(niche);
  if (!r) return null;
  return { engine: r.engine, tier: 'free', name: r.title, gives: r.gives, needs: r.needs, origin: r.sameNiche ? 'same-topic' : 'fallback' };
}

function proToolFor(niche: string | null): DraftRecord['proTool'] {
  if (!niche) return null;
  const group = TOPIC_GROUP[niche];
  if (!group) return null;
  const { engine, fallback } = GROUP_PRO[group];
  // Prefer the topic's own Pro page for that engine; else the neutral one.
  for (const slug of getContentFiles('tools', niche)) {
    const t = getContentItem<{ toolEngine?: string }>('tools', niche, slug);
    if (t?.toolEngine === engine) return { engine, name: PRO_NAMES[engine], path: `/tools/${niche}/${slug}` };
  }
  return { engine, name: PRO_NAMES[engine], path: `/tools/${fallback[0]}/${fallback[1]}` };
}

function base(url: string, type: PageType, extra: Partial<DraftRecord>): DraftRecord {
  const topic = extra.topic ?? null;
  return {
    id: idOf(url), url, site: 'free', type, topic,
    topicName: topic ? nicheName.get(topic) ?? topic : null,
    topicGroup: topic ? TOPIC_GROUP[topic] ?? null : null,
    title: '', published: true, source: null, units: [],
    check: topic ? freeCheck(topic) : null,
    proTool: proToolFor(topic),
    placement: 'top of the page, under the hero',
    handoff: { topic, from: type },
    ...extra,
  };
}

const records: DraftRecord[] = [];

// Home, indexes, utility pages. Their only unit used to be a heading
// ("Free privacy tools and guides", "Guides"), which states no risk to quote
// (pilot check, 2026-09-10), so the hero's own sentences are units too, read
// from the page source so a quote can't drift from what ships.
function pageSource(rel: string): string {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf-8'); } catch { return ''; }
}
function heroDescription(rel: string): string | null {
  const hero = /<PageHero([\s\S]*?)\/>/.exec(pageSource(rel))?.[1] ?? '';
  return /description="([^"]+)"/.exec(hero)?.[1] ?? null;
}
const homeSrc = pageSource('app/page.tsx');
const homeHeadline = /<h1[^>]*>\s*([^<{]+?)\s*<\/h1>/.exec(homeSrc)?.[1];
const homeLede = /<p className="prose-ib text-lede[^"]*">\s*([^<{]+?)\s*<\/p>/.exec(homeSrc)?.[1];
records.push(base('/', 'home', {
  title: 'Privacy Resources',
  units: [
    { key: 'home', label: 'Home', text: 'Free privacy tools and guides' },
    ...(homeHeadline ? [{ key: 'headline', label: 'Headline', text: homeHeadline }] : []),
    ...(homeLede ? [{ key: 'intro', label: 'Intro', text: homeLede }] : []),
  ],
}));
for (const t of ['guides', 'checklists', 'comparisons', 'templates', 'calculators', 'glossary', 'tools']) {
  const intro = heroDescription(`app/${t}/page.tsx`);
  records.push(base(`/${t}`, 'index', {
    title: typeName.get(t) ?? t,
    units: [{ key: 'index', label: 'Index', text: typeName.get(t) ?? t }, ...(intro ? [{ key: 'intro', label: 'Intro', text: intro }] : [])],
  }));
}
records.push(base('/site', 'index', { title: 'Website Privacy Report Cards', units: [{ key: 'index', label: 'Index', text: 'Website privacy report cards' }] }));
for (const [url, why] of [
  ['/editorial-standards', 'Explains how pages are checked; a sales step would undercut it.'],
  ['/site/methodology', 'Explains how report cards are graded.'],
  ['/comparisons/methodology', 'Explains how comparisons are scored.'],
]) records.push(base(url, 'utility', { title: url, noFunnel: why, check: null, proTool: null }));
for (const f of fs.readdirSync(path.join(ROOT, 'data', 'authors')).filter((x) => x.endsWith('.json'))) {
  records.push(base(`/authors/${f.replace('.json', '')}`, 'utility', { title: 'Author profile', noFunnel: 'Author profile; not linked from content pages.', check: null, proTool: null }));
}

// Topic hubs and type-by-topic hubs
for (const n of niches) {
  const counts = Object.fromEntries(['guides', 'checklists', 'comparisons', 'templates', 'calculators'].map((t) => [t, getContentFiles(t, n.id).length]));
  records.push(base(`/topics/${n.id}`, 'topic-hub', { topic: n.id, title: n.name, units: [{ key: 'hook', label: 'The topic', text: n.name, detail: NICHE_HOOK[n.id] }], facts: counts }));
  for (const t of ['guides', 'checklists', 'comparisons', 'templates', 'calculators']) {
    records.push(base(`/${t}/${n.id}`, 'type-hub', { topic: n.id, title: `${typeName.get(t)} · ${n.name}`, units: [{ key: 'hub', label: typeName.get(t) ?? t, text: n.name, detail: NICHE_HOOK[n.id] }], facts: { count: counts[t], type: t } }));
  }
}

// Content detail pages
type AnyItem = EditableContent & Record<string, any>;
function unitsFor(type: string, d: AnyItem): Unit[] {
  if (type === 'guides') {
    const s = d.steps ?? [];
    return s.map((x: any, i: number) => ({ key: `step-${i + 1}`, label: `Step ${i + 1} of ${s.length}`, text: clip(x.title, 160), detail: clip([x.description, ...(x.actions ?? []).slice(0, 3)].join(' · ')) }));
  }
  if (type === 'checklists') {
    const items = (d.sections ?? []).flatMap((s: any) => s.items ?? []);
    return items.map((x: any, i: number) => ({ key: String(x.id ?? `item-${i + 1}`), label: `Item ${i + 1} of ${items.length}${x.priority ? ` · ${x.priority}` : ''}`, text: clip(x.task, 160), detail: clip([x.why, x.howTo].filter(Boolean).join(' · ')) }));
  }
  if (type === 'comparisons') {
    const f = d.features ?? [];
    return f.map((x: any, i: number) => ({ key: `criterion-${i + 1}`, label: `Criterion ${i + 1} of ${f.length} · ${(d.products ?? []).length} products`, text: clip(x.name, 120), detail: clip(x.description) }));
  }
  if (type === 'templates') {
    const s = d.sections ?? [];
    return s.map((x: any, i: number) => ({ key: `section-${i + 1}`, label: `Section ${i + 1} of ${s.length}`, text: clip(x.heading, 120), detail: clip(x.content, 200) }));
  }
  if (type === 'calculators') {
    const s = d.inputs ?? [];
    return s.map((x: any, i: number) => ({ key: `input-${i + 1}`, label: `Input ${i + 1} of ${s.length}`, text: clip(x.label, 120), detail: clip(x.helpText) }));
  }
  return [];
}
const TYPE_OF: Record<string, PageType> = { guides: 'guide', checklists: 'checklist', comparisons: 'comparison', templates: 'template', calculators: 'calculator' };
const PLACEMENT: Record<string, string> = {
  guides: 'inside the matched step', checklists: 'under the matched item', comparisons: 'under the feature table',
  templates: 'after the preview, outside the copied text', calculators: 'after the estimate',
};
for (const t of Object.keys(TYPE_OF)) {
  for (const f of getContentFiles(t)) {
    const [niche, slug] = f.split('/');
    const d = getContentItem<AnyItem>(t, niche, slug);
    if (!d) continue;
    records.push(base(`/${t}/${niche}/${slug}`, TYPE_OF[t], {
      topic: niche, title: clip(d.title, 160), published: isPublished(d), source: `data/${t}/${f}.json`,
      units: unitsFor(t, d), placement: PLACEMENT[t],
    }));
  }
}

// Glossary
for (const term of getGlossaryFiles()) {
  const g = getGlossaryItem<AnyItem>(term);
  if (!g) continue;
  const niche = nicheForGlossaryTerm(term) ?? null;
  records.push(base(`/glossary/${term}`, 'glossary', {
    topic: niche, title: clip(g.term, 120), published: isPublished(g), source: `data/glossary/${term}.json`,
    units: [{ key: 'term', label: 'The term', text: clip(g.term, 120), detail: clip(g.definition) }], placement: 'after “Why it matters”',
  }));
}

// Tool pages (free site and Pro site)
for (const f of getContentFiles('tools')) {
  const [niche, slug] = f.split('/');
  const d = getContentItem<AnyItem>('tools', niche, slug);
  if (!d?.toolEngine) continue;
  const pro = tierOfEngine(d.toolEngine) === 'pro';
  const copy = PROOF_COPY[d.toolEngine];
  const rec = base(`/tools/${niche}/${slug}`, pro ? 'pro-tool' : 'tool', {
    topic: niche, title: clip(d.title, 120), published: isPublished(d), source: `data/tools/${f}.json`,
    units: [{ key: 'tool', label: 'This tool', text: clip(d.title, 120), detail: clip(d.description) }],
    check: { engine: d.toolEngine, tier: pro ? 'pro' : 'free', name: copy?.name ?? PRO_NAMES[d.toolEngine] ?? d.title, gives: copy?.gives ?? clip(d.description), needs: copy?.needs ?? '', origin: 'self' },
    placement: 'the page is the check',
  });
  rec.site = pro ? 'pro' : 'free';
  records.push(rec);
}
// Tool hubs per niche (only niches that list a tool of that tier)
for (const n of niches) {
  const tools = getContentFiles('tools', n.id).map((s) => getContentItem<AnyItem>('tools', n.id, s)).filter(Boolean) as AnyItem[];
  for (const tier of ['free', 'pro'] as const) {
    if (!tools.some((t) => tierOfEngine(t.toolEngine) === tier)) continue;
    const r = base(`/tools/${n.id}`, 'tool-hub', { topic: n.id, title: `Tools · ${n.name}`, units: [{ key: 'hub', label: 'Tools', text: n.name, detail: NICHE_HOOK[n.id] }] });
    r.site = tier;
    if (tier === 'pro') r.id = `pro~${r.id}`;
    records.push(r);
  }
}
{
  const r = base('/tools', 'index', { title: 'Pro tools', units: [{ key: 'index', label: 'Index', text: 'Pro tools' }] });
  r.site = 'pro'; r.id = 'pro~tools'; records.push(r);
}

// Report cards
for (const s of getAllSites()) {
  const niche = (s.category as { niche?: string })?.niche ?? 'ad-tracking';
  const grade = s.grade as { grade: string; score: number; headline: string };
  const scan = s.scan as { summary: Record<string, number>; trackers: Array<{ name: string }> };
  records.push(base(`/site/${s.domain}`, 'report-card', {
    topic: niche, title: s.domain, published: isSitePublished(s), source: `data/sites/${s.domain}.json`,
    facts: { domain: s.domain, grade: grade.grade, score: grade.score, headline: grade.headline, category: (s.category as { label?: string })?.label, trackingCookies: scan.summary.trackingCookies, trackers: scan.trackers.map((t) => t.name).slice(0, 5), scannedAt: s.scannedAt },
    check: { engine: 'report-card', tier: 'free', name: 'This report card', gives: 'The grade and the trackers this site loads before you click anything.', needs: '', origin: 'card' },
    placement: 'under the grade',
  }));
}

// Pro-engine sanity: the pairing and group tables only name engines that exist.
for (const e of [...Object.values(PAIRINGS).map((p) => p.engine), ...Object.values(GROUP_PRO).map((g) => g.engine)]) {
  if (!PROOF_COPY[e] && !PRO_ENGINES.has(e)) throw new Error(`unknown engine ${e}`);
}

// Optional cross-check against a build's page list.
const vi = process.argv.indexOf('--verify-out');
if (vi !== -1) {
  const outDir = path.join(ROOT, process.argv[vi + 1] ?? 'out');
  const built = new Set<string>();
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !e.name.startsWith('_next')) walk(p);
      else if (e.name === 'index.html') built.add('/' + path.relative(outDir, path.dirname(p)).split(path.sep).join('/'));
    }
  };
  walk(outDir);
  const have = new Set(records.filter((r) => r.site === 'free').map((r) => (r.url === '/' ? '/' : r.url)));
  const normBuilt = new Set([...built].map((u) => (u === '/' ? '/' : u.replace(/\/$/, ''))));
  const missing = [...normBuilt].filter((u) => !have.has(u === '' ? '/' : u)).sort();
  const extra = [...have].filter((u) => !normBuilt.has(u)).sort();
  console.log(`build pages: ${normBuilt.size} · free records: ${have.size} · built but no record: ${missing.length} · record but not built: ${extra.length}`);
  if (missing.length) console.log('  built, no record:', missing.slice(0, 30).join('  '));
  if (extra.length) console.log('  record, not built:', extra.slice(0, 30).join('  '));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'records.json'), JSON.stringify(records, null, 2) + '\n');
const byType = records.reduce<Record<string, number>>((m, r) => ((m[`${r.site}:${r.type}`] = (m[`${r.site}:${r.type}`] ?? 0) + 1), m), {});
console.log(`${records.length} records`, byType);
console.log('no free check:', records.filter((r) => !r.check && !r.noFunnel).map((r) => r.url).slice(0, 20));
