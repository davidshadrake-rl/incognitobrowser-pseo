/**
 * Two tripwires on dated facts. Both are honest about being tripwires: as of
 * today neither can fire, because every date they grade is days old. That is
 * the point — they are here so that in six months, when nobody remembers, the
 * clock speaks instead of a person having to.
 *
 * The repo already lives with exactly this discipline: tests/play-proof.test.ts
 * enforces a 90-day re-check on brand.play.checkedOn and is one of the better
 * guards in the codebase. These extend the same rule to the dates it does not
 * cover, and to the editorial dates on statute-bearing pages.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { check, finding, Skip } from '../lib/harness.mjs';

const DAY = 24 * 60 * 60 * 1000;

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.name.endsWith('.json')) acc.push(p);
  }
  return acc;
}

/** Every `checkedOn` in an object tree, with the dotted path that reached it. */
function collectDates(node, key, path = '', out = []) {
  if (node === null || typeof node !== 'object') return out;
  for (const [k, v] of Object.entries(node)) {
    const here = path ? `${path}.${k}` : k;
    if (k === key) out.push([here, v]);
    else if (v && typeof v === 'object') collectDates(v, key, here, out);
  }
  return out;
}

/**
 * data/brand.json is the single source of truth for everything the site says
 * about the Incognito Browser app, and every claim in it is sourced and dated.
 * play-proof.test.ts holds brand.play.checkedOn to 90 days. Nothing holds
 * brand.checkedOn, brand.pro.checkedOn or brand.proNext.checkedOn — so if Pro
 * is pulled from sale, or its feature set changes, roughly 1,400 pages go on
 * asserting the old set with no tripwire at all. brand.pro.purchase ("On sale
 * in the US production build and worldwide") is precisely the kind of fact
 * that stops being true without anyone editing this repo.
 */
const brandFacts = check({
  id: 'cmp-brand-facts-freshness',
  discipline: 'compliance',
  cadence: 'weekly',
  severity: 'low',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Every dated fact in data/brand.json has been re-checked within 90 days, and none is dated in the future — the rule play-proof.test.ts already applies to the Play figures, extended to the rest.',
  async run(ctx) {
    const p = join(ctx.repoRoot, 'data/brand.json');
    if (!existsSync(p)) throw new Skip('data/brand.json not found — this is the file the whole claim regime rests on');
    const brand = JSON.parse(readFileSync(p, 'utf-8'));
    const dates = collectDates(brand, 'checkedOn');
    if (!dates.length) {
      throw new Skip('data/brand.json contains no checkedOn keys at all — the sourced-and-dated discipline has been removed, which is a bigger problem than a stale date');
    }

    const findings = [];
    const today = new Date();
    for (const [path, value] of dates) {
      const where = `brand.${path}`;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        findings.push(finding({
          severity: 'low',
          title: `${where} is not an ISO date`,
          detail: 'A date that cannot be parsed cannot expire, so the fact under it is never re-checked. That is a silent failure, which is the mode this suite exists to remove.',
          evidence: `${where} = ${JSON.stringify(value)} (expected YYYY-MM-DD)`,
          remediation: 'Write it as YYYY-MM-DD.',
          file: 'data/brand.json',
        }));
        continue;
      }
      const when = new Date(`${value}T00:00:00Z`);
      const ageDays = Math.floor((today - when) / DAY);
      if (ageDays < 0) {
        findings.push(finding({
          severity: 'low',
          title: `${where} is dated in the future`,
          detail: 'A future date makes a fact permanently fresh. Usually a typo; always worth catching, because it disables the tripwire it looks like it is setting.',
          evidence: `${where} = ${value}, which is ${-ageDays} day(s) ahead of today (${today.toISOString().slice(0, 10)})`,
          remediation: 'Correct the date to when the fact was actually checked.',
          file: 'data/brand.json',
        }));
      } else if (ageDays > 90) {
        findings.push(finding({
          severity: 'low',
          title: `${where} has not been re-checked in ${ageDays} days`,
          detail: `Everything under this key is asserted on roughly 1,400 pages. If Pro's feature set, its availability, or the app's Play listing has changed since ${value}, those pages are now stating something that was true once. 90 days is the rule the team already lives with for the Play figures.`,
          evidence: `${where} = ${value} (${ageDays} days old; limit 90)`,
          remediation: 'Re-check the facts under this key against their sources, then move the date. Moving the date without re-checking is the one thing that makes this guard worthless.',
          file: 'data/brand.json',
        }));
      }
    }

    // proNext is the Pro the app is about to ship, and the file says plainly
    // that nothing on the site may claim it until the owner says the build is
    // out. tests/pro-next.test.ts guards the claim side. The date side belongs
    // here: a `live: true` flip with a stale check date means someone turned
    // on a set of claims they last verified months ago.
    if (brand.proNext && brand.proNext.live === true) {
      const d = brand.proNext.checkedOn;
      const ageDays = /^\d{4}-\d{2}-\d{2}$/.test(String(d)) ? Math.floor((today - new Date(`${d}T00:00:00Z`)) / DAY) : null;
      if (ageDays === null || ageDays > 30) {
        findings.push(finding({
          severity: 'low',
          title: 'proNext has been switched live on a stale check date',
          detail: 'Flipping proNext.live on turns a set of unshipped feature claims — including a VPN, which data/brand.json neverClaim forbids today — into live copy across the site. That switch should be thrown on a fact checked within the last month, not a months-old note.',
          evidence: `brand.proNext.live = true, brand.proNext.checkedOn = ${JSON.stringify(d)}${ageDays === null ? ' (unparseable)' : ` (${ageDays} days old)`}`,
          remediation: 'Re-confirm the shipped feature set with the owner and redate, or set live back to false until the build is out.',
          file: 'data/brand.json',
        }));
      }
    }

    return { findings, checked: dates.length };
  },
});

/**
 * Statute-bearing content reviewed within 12 months.
 *
 * 151 content files state facts about GDPR, CCPA/CPRA, HIPAA, COPPA, FERPA,
 * PIPEDA or LGPD. US state privacy law in particular moves every legislative
 * session, so a page asserting a threshold, a deadline or a count of states
 * becomes a false statement of law with no signal whatever. The median review
 * age today is about a week, so this fires on nothing — stated plainly so
 * nobody mistakes it for work being done now.
 *
 * SCOPE, and what is left out on purpose:
 *   - data/sites/* (500 scanned third-party sites) is excluded. It is scan
 *     output about other people's cookie banners, not a statement of law, and
 *     it has no editorial dates. Including it would add 500 items to `checked`
 *     that this check is not really grading.
 *   - data/brand.json, data/taxonomy.json and the other top-level config files
 *     are not content pages; brand.json has its own check above.
 */
const statuteAge = check({
  id: 'cmp-statute-content-review-age',
  discipline: 'compliance',
  cadence: 'weekly',
  severity: 'low',
  safeAgainstProd: true,
  needsOptIn: false,
  requires: [],
  describe: 'Content that states facts about GDPR, CCPA, HIPAA, COPPA, FERPA, PIPEDA or LGPD has been editorially reviewed within the last 12 months.',
  async run(ctx) {
    // Content categories only — the things that render as pages making claims.
    const CATEGORIES = ['guides', 'checklists', 'comparisons', 'templates', 'calculators', 'glossary', 'tools'];
    const STATUTE = /\b(GDPR|CCPA|CPRA|HIPAA|COPPA|FERPA|PIPEDA|LGPD)\b/g;

    const files = CATEGORIES.flatMap((c) => walk(join(ctx.repoRoot, 'data', c)));
    if (!files.length) throw new Skip(`no content JSON under data/{${CATEGORIES.join(',')}} — wrong repo, or a partial checkout`);

    const findings = [];
    const stale = [];
    const undated = [];
    const today = new Date();
    let graded = 0;

    for (const p of files) {
      const rel = relative(ctx.repoRoot, p);
      let j;
      try { j = JSON.parse(readFileSync(p, 'utf-8')); } catch { continue; }
      const text = JSON.stringify(j);
      const hits = text.match(STATUTE);
      if (!hits) continue;
      graded += 1;
      const statutes = [...new Set(hits)].sort().join(', ');
      const ed = j.editorial || {};
      const when = ed.updatedAt || ed.reviewedAt || null;
      if (!when) { undated.push(`${rel} [${statutes}]`); continue; }
      const parsed = new Date(when);
      if (Number.isNaN(parsed.getTime())) { undated.push(`${rel} [${statutes}] editorial date = ${JSON.stringify(when)}`); continue; }
      const ageDays = Math.floor((today - parsed) / DAY);
      if (ageDays > 365) stale.push(`${rel} [${statutes}] last reviewed ${String(when).slice(0, 10)} (${ageDays} days)`);
    }

    if (!graded) {
      throw new Skip(`read ${files.length} content files and none named a statute — either the content has changed shape or the walk is pointed at the wrong place; either way this check graded nothing`);
    }
    if (stale.length) {
      findings.push(finding({
        severity: 'low',
        title: `${stale.length} statute-bearing pages have not been reviewed in over a year`,
        detail: 'Each of these states something about a privacy law as fact. US state privacy law changes every legislative session and the GDPR/CCPA guidance around it moves with it, so a page left for a year is a page that may now be wrong in a way no test can detect.',
        evidence: stale.join('\n'),
        remediation: 'Review against the current statute, then move editorial.updatedAt. Grouped by statute, these usually go in one sitting.',
        file: stale[0].split(' ')[0],
      }));
    }
    if (undated.length) {
      findings.push(finding({
        severity: 'low',
        title: `${undated.length} statute-bearing pages carry no editorial review date`,
        detail: 'Without a date there is no way to know whether the statement of law on the page has ever been re-read, and no tripwire can ever fire for it. An undated page is permanently fresh, which is worse than an obviously stale one.',
        evidence: undated.join('\n'),
        remediation: 'Add editorial.reviewedAt (and updatedAt when it changes) the way the rest of data/ does.',
        file: undated[0].split(' ')[0],
      }));
    }
    return { findings, checked: graded };
  },
});

export default [brandFacts, statuteAge];
