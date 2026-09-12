/**
 * Per-page funnel: fold drafted funnels (funnel-drafts/<batch>/*.json, each an
 * array of { id, funnel, note? }) into funnel-drafts/records.json. A later
 * draft for the same id replaces an earlier one, so a rework batch simply
 * overrides what it fixes.
 *
 * Usage: npx tsx scripts/funnels/merge.ts funnel-drafts/pilot [more dirs…]
 */
import fs from 'fs';
import path from 'path';

const RECORDS = path.join(process.cwd(), 'funnel-drafts', 'records.json');
const records = JSON.parse(fs.readFileSync(RECORDS, 'utf-8')) as Array<{ id: string; funnel?: unknown; note?: string }>;
const byId = new Map(records.map((r) => [r.id, r]));

let merged = 0;
const unknown: string[] = [];
for (const dir of process.argv.slice(2)) {
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
    const rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as Array<{ id: string; funnel: unknown; note?: string }>;
    for (const row of rows) {
      const rec = byId.get(row.id);
      if (!rec) { unknown.push(`${f}:${row.id}`); continue; }
      rec.funnel = row.funnel;
      if (row.note) rec.note = row.note; else delete rec.note;
      merged++;
    }
  }
}
fs.writeFileSync(RECORDS, JSON.stringify(records, null, 2) + '\n');
console.log(`merged ${merged} funnels into ${path.relative(process.cwd(), RECORDS)}`);
if (unknown.length) console.log(`  ${unknown.length} rows name no known record:`, unknown.slice(0, 10).join(', '));
