/**
 * Per-page funnel, Phase B step 1: turn the reviewed drafts into the one file
 * the site renders from.
 *
 * funnel-drafts/ is kept out of the repo (it is public, and the drafts carry
 * review notes), so the site never reads it. This writes data/funnels.json: per page
 * URL, the five steps as the visitor sees them, plus the two links the page
 * needs — the free check, and the upgrade with this page's context attached.
 *
 * Re-run it after any merge:
 *   npx tsx scripts/funnels/merge.ts funnel-drafts/<batch> [...]
 *   npx tsx scripts/funnels/export.ts
 *
 * It refuses to write when validate.ts finds an error, so a draft that broke a
 * rule can never reach the site by way of a forgotten step.
 */
import fs from 'fs';
import path from 'path';
import { validate } from './validate';
import { ENGINE_CANONICAL } from '../../components/tools/registry';

const ROOT = process.cwd();
const RECORDS = path.join(ROOT, 'funnel-drafts', 'records.json');
const OUT = path.join(ROOT, 'data', 'funnels.json');

interface Step2 { engine: string; heading: string; instruction: string; button: string }
interface DraftRecord {
  id: string;
  url: string;
  type: string;
  topic: string | null;
  funnel?: {
    step1: { unitKey: string; label: string; quote: string };
    step2: Step2;
    step3: { red: string; amber: string; green: string };
    step4: { line: string };
    step5: { label: string };
  };
  handoff?: { topic?: string; from?: string };
}

/**
 * Where a given engine's free tool page lives. The visitor's own topic first,
 * so a dating-privacy page sends them to the dating-privacy metadata checker
 * and not the canonical one; the canonical page is the fallback.
 */
function toolIndex(): Map<string, Array<{ niche: string; slug: string }>> {
  const byEngine = new Map<string, Array<{ niche: string; slug: string }>>();
  const toolsDir = path.join(ROOT, 'data', 'tools');
  for (const niche of fs.readdirSync(toolsDir)) {
    const dir = path.join(toolsDir, niche);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const data = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
      const engine = data.toolEngine;
      // A draft page is not a place to send anyone.
      if (!engine || data.editorial?.status !== 'published') continue;
      if (!byEngine.has(engine)) byEngine.set(engine, []);
      byEngine.get(engine)!.push({ niche, slug: file.replace(/\.json$/, '') });
    }
  }
  return byEngine;
}

function checkTarget(engine: string, topic: string | null, index: ReturnType<typeof toolIndex>) {
  const pages = index.get(engine) ?? [];
  const own = topic ? pages.find((p) => p.niche === topic) : undefined;
  const canonical = ENGINE_CANONICAL[engine];
  return own
    ?? (canonical && pages.find((p) => p.niche === canonical.niche && p.slug === canonical.slug))
    ?? pages[0]
    ?? null;
}

function main() {
  const records = JSON.parse(fs.readFileSync(RECORDS, 'utf-8')) as DraftRecord[];
  const { checked, errors } = validate(records as never);
  if (errors.length) {
    console.error(`${errors.length} validation errors — nothing written. Fix them first:`);
    for (const e of errors.slice(0, 20)) console.error('  ', e);
    process.exit(1);
  }

  const index = toolIndex();
  const out: Record<string, unknown> = {};
  const noCheckPage: string[] = [];
  for (const r of records) {
    if (!r.funnel) continue;
    const target = checkTarget(r.funnel.step2.engine, r.topic, index);
    if (!target) noCheckPage.push(`${r.url} (${r.funnel.step2.engine})`);
    // The check page gets the page's context, so the result it shows can speak
    // for the page the visitor came from (lib/handoff.ts reads these).
    const q = new URLSearchParams();
    if (r.handoff?.topic) q.set('topic', r.handoff.topic);
    q.set('from', r.type);
    out[r.url] = {
      type: r.type,
      topic: r.topic,
      step1: { label: r.funnel.step1.label, quote: r.funnel.step1.quote },
      // The tool page as (niche, slug) plus the context to carry: lib/funnels.ts
      // turns it into a link, which is a relative path for a free engine and an
      // absolute Pro-deployment URL for a Pro one — a free build does not
      // render Pro tool pages, so a relative link there would dangle.
      step2: { ...r.funnel.step2, target, query: q.toString() },
      step3: r.funnel.step3,
      step4: r.funnel.step4,
      step5: { label: r.funnel.step5.label },
    };
  }

  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`);
  console.log(`${Object.keys(out).length} funnels written to data/funnels.json (${checked} checked, 0 errors)`);
  if (noCheckPage.length) {
    console.log(`${noCheckPage.length} with no published tool page for their engine — they render steps 1, 4 and 5 only:`);
    for (const n of noCheckPage.slice(0, 10)) console.log('  ', n);
  }
}

main();
