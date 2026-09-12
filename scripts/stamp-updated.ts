/**
 * Stamp editorial.updatedAt on content pages whose text changed after review.
 *
 * Content pages give JSON-LD dateModified, og modified_time and the sitemap's
 * lastModified as `editorial.updatedAt ?? editorial.reviewedAt`, and
 * datePublished as reviewedAt. reviewedAt is when a reviewer signed the page
 * off, so an edit must never move it: that would claim a review nobody did.
 * An edit is recorded here instead, as an ISO date in editorial.updatedAt.
 *
 * A page counts as changed when its file, minus the `editorial` block, differs
 * from the same file at git revision --since: committed since then, or edited
 * in the working tree now. A file that did not exist there counts as changed.
 * `editorial` is left out of the comparison so that a stamp, a review or a
 * status change alone is never a text change, and so that a second run with
 * the same arguments changes nothing.
 *
 * Per changed file, editorial.updatedAt is set to --date, right after
 * reviewedAt. Nothing else is touched (not reviewedAt, not any other key), and
 * the file keeps its format: 2-space JSON, trailing newline. Left alone:
 *   - an updatedAt already on --date or later (the stamp never moves back);
 *   - a page reviewed on a day after --date (its review is newer than the edit);
 *   - a file with no editorial block, or not in the standard format (listed,
 *     so it can be stamped by hand).
 *
 * Usage:
 *   npx tsx scripts/stamp-updated.ts [--since <rev>] [--date <YYYY-MM-DD>] [--dry-run] [--list]
 *
 * The defaults are the first pass, made on 2026-09-11: pages edited since
 * fbde55b ("no VPN claims"), by the brand scrub and the calculator, comparison
 * and tool-copy fixes that followed it. A later pass must give both flags:
 * --since the commit the previous pass was made on, --date the day of the pass.
 *
 * Tool pages are content too: app/tools/[niche]/[slug] gives the same Article
 * JSON-LD and the sitemap the same lastModified, so data/tools is stamped with
 * the other six types.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const CONTENT_TYPES = ['guides', 'checklists', 'templates', 'calculators', 'comparisons', 'glossary', 'tools'] as const;
export type ContentType = (typeof CONTENT_TYPES)[number];

export const DEFAULT_SINCE = 'fbde55b';
export const DEFAULT_DATE = '2026-09-11';

type JsonObject = Record<string, unknown>;

const isObject = (v: unknown): v is JsonObject => !!v && typeof v === 'object' && !Array.isArray(v);

/** Everything in a content file except its `editorial` block, as one comparable string. */
export function pageText(json: JsonObject): string {
  const rest = { ...json };
  delete rest.editorial;
  return JSON.stringify(rest);
}

/** The text of `now` differs from `before` (null: the file did not exist then). */
export function textChanged(before: JsonObject | null, now: JsonObject): boolean {
  return before === null || pageText(before) !== pageText(now);
}

export type StampOutcome = 'stamped' | 'kept' | 'reviewed-later' | 'no-editorial';

/**
 * `json` with editorial.updatedAt = `date`, placed right after reviewedAt (or
 * last, when there is no reviewedAt). Every other key keeps its value and its
 * place. Returns the input object itself for every outcome but 'stamped'.
 */
export function stampUpdatedAt(json: JsonObject, date: string): { json: JsonObject; outcome: StampOutcome } {
  const editorial = json.editorial;
  if (!isObject(editorial)) return { json, outcome: 'no-editorial' };
  // ISO dates and timestamps order correctly as strings.
  const current = editorial.updatedAt;
  if (typeof current === 'string' && current >= date) return { json, outcome: 'kept' };
  const reviewedAt = editorial.reviewedAt;
  if (typeof reviewedAt === 'string' && reviewedAt.slice(0, 10) > date) return { json, outcome: 'reviewed-later' };

  const next: JsonObject = {};
  let placed = false;
  for (const [key, value] of Object.entries(editorial)) {
    if (key === 'updatedAt') continue;
    next[key] = value;
    if (key === 'reviewedAt') {
      next.updatedAt = date;
      placed = true;
    }
  }
  if (!placed) next.updatedAt = date;
  // `editorial` already exists in json, so it keeps its position.
  return { json: { ...json, editorial: next }, outcome: 'stamped' };
}

/** How a file is written everywhere in data/: 2-space JSON and a trailing newline. */
export const serialize = (json: JsonObject): string => JSON.stringify(json, null, 2) + '\n';

// --- main ------------------------------------------------------------------------

interface TypeCount {
  files: number;
  changed: number;
  stamped: number;
  kept: number;
  reviewedLater: number;
  skipped: number;
}

function main() {
  const args = process.argv.slice(2);
  const opt = (name: string) => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const since = opt('since') ?? DEFAULT_SINCE;
  const date = opt('date') ?? DEFAULT_DATE;
  const dryRun = args.includes('--dry-run');
  const list = args.includes('--list');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(new Date(date).getTime())) {
    throw new Error(`--date must be an ISO date (YYYY-MM-DD), got "${date}"`);
  }

  const root = path.resolve(__dirname, '..');
  const git = (gitArgs: string[]) =>
    execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
  // A bad revision must stop the run: read as "no such file", it would stamp every page.
  let rev: string;
  try {
    rev = git(['rev-parse', '--verify', '--quiet', `${since}^{commit}`]).trim();
  } catch {
    throw new Error(`--since: no such commit "${since}"`);
  }

  const counts = {} as Record<ContentType, TypeCount>;
  const skipped: string[] = [];
  const stamped: string[] = [];
  for (const type of CONTENT_TYPES) {
    const dir = `data/${type}`;
    const c: TypeCount = { files: 0, changed: 0, stamped: 0, kept: 0, reviewedLater: 0, skipped: 0 };
    counts[type] = c;
    const atRev = new Set(git(['ls-tree', '-r', '--name-only', rev, '--', dir]).split('\n').filter(Boolean));
    const files = git(['ls-files', '--cached', '--others', '--exclude-standard', '--', dir])
      .split('\n')
      .filter((f) => f.endsWith('.json') && fs.existsSync(path.join(root, f)));
    for (const rel of [...new Set(files)].sort()) {
      c.files++;
      const file = path.join(root, rel);
      const raw = fs.readFileSync(file, 'utf8');
      const now = JSON.parse(raw) as JsonObject;
      const before = atRev.has(rel) ? (JSON.parse(git(['show', `${rev}:${rel}`])) as JsonObject) : null;
      if (!textChanged(before, now)) continue;
      c.changed++;
      if (serialize(now) !== raw) {
        // Rewriting would reformat the whole file, not just add one line.
        c.skipped++;
        skipped.push(`${rel} (not 2-space JSON with a trailing newline)`);
        continue;
      }
      const { json, outcome } = stampUpdatedAt(now, date);
      if (outcome === 'kept') c.kept++;
      else if (outcome === 'reviewed-later') c.reviewedLater++;
      else if (outcome === 'no-editorial') {
        c.skipped++;
        skipped.push(`${rel} (no editorial block)`);
      } else {
        c.stamped++;
        stamped.push(rel);
        if (!dryRun) fs.writeFileSync(file, serialize(json));
      }
    }
  }

  const pad = (s: string | number, n: number) => String(s).padStart(n);
  const rows = CONTENT_TYPES.map((t) => [t, counts[t]] as const);
  const total = rows.reduce<TypeCount>(
    (a, [, c]) => ({ files: a.files + c.files, changed: a.changed + c.changed, stamped: a.stamped + c.stamped, kept: a.kept + c.kept, reviewedLater: a.reviewedLater + c.reviewedLater, skipped: a.skipped + c.skipped }),
    { files: 0, changed: 0, stamped: 0, kept: 0, reviewedLater: 0, skipped: 0 },
  );
  const line = (name: string, c: TypeCount) =>
    `${name.padEnd(12)}${pad(c.files, 6)}${pad(c.changed, 9)}${pad(c.stamped, 9)}${pad(c.kept, 6)}${pad(c.reviewedLater, 16)}${pad(c.skipped, 9)}`;
  const out = [
    `${dryRun ? '[dry run] ' : ''}editorial.updatedAt = ${date} for text changed since ${since} (${rev.slice(0, 7)})`,
    '',
    `${'type'.padEnd(12)}${pad('files', 6)}${pad('changed', 9)}${pad('stamped', 9)}${pad('kept', 6)}${pad('reviewed later', 16)}${pad('skipped', 9)}`,
    ...rows.map(([t, c]) => line(t, c)),
    line('total', total),
  ];
  if (skipped.length) out.push('', 'Skipped (stamp by hand):', ...skipped.map((s) => `  ${s}`));
  if (list && stamped.length) out.push('', `${dryRun ? 'Would stamp' : 'Stamped'}:`, ...stamped.map((s) => `  ${s}`));
  process.stdout.write(out.join('\n') + '\n');
}

// Only when run as a script: tests import the functions above.
if (/stamp-updated\.[cm]?[jt]s$/.test(process.argv[1] ?? '')) main();
