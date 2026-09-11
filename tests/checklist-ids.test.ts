/**
 * Checklist item ids — ChecklistPage keys the saved ticks by item id, so two
 * items sharing an id tick and untick together, and progress (done / total)
 * can never reach 100%. Found live on the student-privacy campus checklist
 * (two "campus-2" items: stuck at 96%, "All done" never showed). The same
 * goes one level up: each checklist's ticks are saved under its own key.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'data', 'checklists');

interface Checklist { niche?: string; slug?: string; sections?: Array<{ items?: Array<{ id?: string }> }> }

const files = fs.readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .flatMap((d) => fs.readdirSync(path.join(ROOT, d.name)).filter((f) => f.endsWith('.json')).map((f) => `${d.name}/${f}`));

describe('checklist item ids', () => {
  it('finds every checklist file (sanity check on the test itself)', () => {
    expect(files.length).toBeGreaterThanOrEqual(80);
  });

  it.each(files)('%s: every item has an id, unique within the checklist', (rel) => {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')) as Checklist;
    const ids = (data.sections || []).flatMap((s) => (s.items || []).map((i) => i.id));
    expect(ids.length, 'checklist has no items').toBeGreaterThan(0);
    expect(ids.filter((id) => !id), 'items without an id').toEqual([]);
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, 'duplicate item ids').toEqual([]);
  });

  it('no two checklists share a saved-ticks key (checklist-<niche>-<slug>)', () => {
    // The key uses the JSON's own "slug", which drifted from the file name on
    // 38 checklists; two pairs ended up with the same key, so ticking an item
    // on one workplace checklist ticked it on the other.
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const rel of files) {
      const data = JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf-8')) as Checklist;
      const key = `checklist-${data.niche}-${data.slug}`;
      if (owner.has(key)) clashes.push(`${key}: ${owner.get(key)} and ${rel}`);
      else owner.set(key, rel);
    }
    expect(clashes).toEqual([]);
  });
});
