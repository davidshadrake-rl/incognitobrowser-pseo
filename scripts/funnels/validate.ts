/**
 * Per-page funnel, Phase A step 4: check every drafted funnel before anyone
 * reviews it.
 *
 *   grounding  step 1 quotes the page word for word (the unit it names);
 *   uniqueness the full five-step text is unique site-wide;
 *   claims     no VPN, price, date, person, or data/brand.json never-claim;
 *              step 4 only uses value Pro actually has (PRO_DEFINITION);
 *   fit        step 2 is a check this page's topic may use;
 *   lengths    each step stays short enough to read at a glance.
 *
 * Usage: npx tsx scripts/funnels/validate.ts [funnel-drafts/records.json]
 */
import fs from 'fs';
import path from 'path';

export interface Funnel {
  step1: { unitKey: string; label: string; quote: string };
  step2: { engine: string; heading: string; instruction: string; button: string };
  step3: { red: string; amber: string; green: string };
  step4: { line: string };
  step5: { label: string };
}
interface Rec {
  id: string; url: string; type: string; topic: string | null; title: string;
  units: Array<{ key: string; label: string; text: string; detail?: string }>;
  facts?: Record<string, unknown>;
  check: { engine: string } | null;
  noFunnel?: string;
  funnel?: Funnel;
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

const brand = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'brand.json'), 'utf-8')) as { neverClaim: string[] };
/**
 * Each never-claim as whole-word patterns. Matched as a plain substring,
 * "Tor" failed "history", "visitor", "calculator" and "two-factor" (pilot,
 * 2026-09-10). Every "a / b" or "a or b" alternative counts; a one-word
 * alternative after the first ("works on all platforms / iOS / desktop") is
 * only half a phrase, so it is not checked on its own.
 */
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEVER: Array<[RegExp, string]> = brand.neverClaim.flatMap((n) =>
  n.split(/ \/ | or /)
    .map((alt) => alt.trim())
    .filter((alt, i) => i === 0 || alt.includes(' '))
    .map((alt) => [new RegExp(`(?<![\\w-])${escapeRe(alt)}(?![\\w-])`, 'i'), n] as [RegExp, string]),
);
const PEOPLE = fs.readdirSync(path.join(process.cwd(), 'data', 'authors'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => (JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'authors', f), 'utf-8')) as { name: string }).name);

const BANNED: Array<[RegExp, string]> = [
  [/\$|€|£|\bper (month|year)\b|\/mo\b|\bpricing\b|\bprice\b/i, 'price'],
  [/\b(January|February|March|April|May|June|July|August|September|October|November|December)\b|\b20\d\d\b/, 'date'],
  [/\b(safe to|guarantee|compliant|compliance-ready|legitimate|100%)\b/i, 'overclaim word'],
  [/\bfree for now\b/i, '"free for now" belongs to the Pro badge only'],
];
/** Things Pro is NOT confirmed to do (lib/cta-copy.ts header). */
const UNBACKED = /strips? (metadata|location)[^.]* automatically|automatic(ally)? strip|cleans? links|blocks? (webrtc|canvas)|audits? permissions|\bvpn\b/i;
/**
 * The network group's honesty line may name a VPN only to say Pro doesn't
 * include one ("…takes a VPN or Private DNS, which Pro doesn't include").
 * Those exact denial forms are removed before UNBACKED is tested; any other
 * VPN mention in step 4 still fails (pilot recheck, 2026-09-11).
 */
const VPN_DENIAL = /\b(?:a\s+)?VPN\b(?:\s+or\s+[\w-]+(?:\s+DNS)?)?,?\s+(?:which|that)\s+(?:Incognito\s+)?Pro\s+(?:doesn't|does not)\s+include\b|\b(?:Incognito\s+)?Pro\s+(?:doesn't|does not)\s+include\s+a\s+VPN\b/gi;
/** Step 4 must name something Pro or the free app really has. */
const BACKED = /ad and tracker blocking|tracker blocking|privacy tools|Cookie (&|and) Tracker Scanner|cookie scanner|Browser Fingerprint Checker|fingerprint audit|URL Safety Checker|link checker|Photo Metadata Viewer|metadata viewer|wipes? (your )?(history|cookies|sessions)|Agent Cloaking|ad blocker/i;

const LIMITS = { quote: 200, heading: 90, instruction: 220, button: 50, result: 170, line: 300, label: 70 };

export function validate(records: Rec[]) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();
  let checked = 0;

  for (const r of records) {
    if (r.noFunnel) continue;
    const f = r.funnel;
    if (!f) continue;
    checked++;
    const where = r.url;

    // grounding. A report card has no units: its quote is the card's headline.
    const unit = r.units.find((u) => u.key === f.step1.unitKey);
    const headline = typeof r.facts?.headline === 'string' ? r.facts.headline : null;
    if (r.type === 'report-card' && headline) {
      if (!norm(headline).includes(norm(f.step1.quote))) errors.push(`${where}: step1 quote is not the card's headline: "${f.step1.quote}"`);
    } else if (r.units.length && !unit) errors.push(`${where}: step1 unit "${f.step1.unitKey}" is not one of this page's units`);
    else if (unit && !norm(`${unit.text} ${unit.detail ?? ''}`).includes(norm(f.step1.quote))) errors.push(`${where}: step1 quote is not on the page: "${f.step1.quote}"`);

    // fit
    if (r.check && f.step2.engine !== r.check.engine) warnings.push(`${where}: step2 uses ${f.step2.engine}, assembler chose ${r.check.engine}`);

    // claims + lengths
    const texts: Array<[string, string, number]> = [
      ['step1.quote', f.step1.quote, LIMITS.quote],
      ['step2.heading', f.step2.heading, LIMITS.heading],
      ['step2.instruction', f.step2.instruction, LIMITS.instruction],
      ['step2.button', f.step2.button, LIMITS.button],
      ['step3.red', f.step3.red, LIMITS.result],
      ['step3.amber', f.step3.amber, LIMITS.result],
      ['step3.green', f.step3.green, LIMITS.result],
      ['step4.line', f.step4.line, LIMITS.line],
      ['step5.label', f.step5.label, LIMITS.label],
    ];
    for (const [k, v, max] of texts) {
      if (!v || !v.trim()) { errors.push(`${where}: ${k} is empty`); continue; }
      if (v.length > max) errors.push(`${where}: ${k} is ${v.length} chars (max ${max})`);
      if (k === 'step1.quote') continue; // the page's own words; judged by the page's own review
      for (const [re, why] of BANNED) if (re.test(v)) errors.push(`${where}: ${k} has a banned ${why}: "${v}"`);
      for (const [re, n] of NEVER) if (re.test(v)) errors.push(`${where}: ${k} makes a never-claim (${n})`);
      for (const p of PEOPLE) if (v.includes(p)) errors.push(`${where}: ${k} names a person`);
    }
    if (UNBACKED.test(f.step4.line.replace(VPN_DENIAL, ' '))) errors.push(`${where}: step4 claims something Pro isn't confirmed to do: "${f.step4.line}"`);
    if (!BACKED.test(f.step4.line)) errors.push(`${where}: step4 names nothing Pro or the app really has: "${f.step4.line}"`);

    // uniqueness of the whole funnel
    const whole = norm([f.step1.quote, f.step2.instruction, f.step3.red, f.step3.amber, f.step3.green, f.step4.line, f.step5.label].join(' | '));
    const dup = seen.get(whole);
    if (dup) errors.push(`${where}: funnel text is identical to ${dup}`);
    else seen.set(whole, where);
  }
  warnings.push(...samenessWarnings(records));
  return { checked, errors, warnings };
}

/**
 * Near-copies: the pilot's reviewers found funnels that differ only by the
 * domain or topic name (report cards at 0.75 alike, 37 amber lines with one
 * opener, the same step-5 label on 9 cards). Each funnel's steps 2–5 are
 * reduced to word pairs with the page's own names masked, and pairs of the
 * same page type are compared; step-5 labels and step-3 openers are checked
 * for reuse. Warnings, not errors: the reviewers decide.
 */
const SIMILAR = 0.6;
function samenessWarnings(records: Rec[]): string[] {
  const out: string[] = [];
  const drafted = records.filter((r) => !r.noFunnel && r.funnel);
  const masked = (r: Rec) => {
    const f = r.funnel!;
    let t = [f.step2.heading, f.step2.instruction, f.step3.red, f.step3.amber, f.step3.green, f.step4.line, f.step5.label].join(' ').toLowerCase();
    const names = [String(r.facts?.domain ?? ''), String(r.facts?.domain ?? '').replace(/\.[a-z.]+$/, ''), r.title, r.topic ?? '']
      .map((n) => n.toLowerCase().trim()).filter((n) => n.length > 2).sort((a, b) => b.length - a.length);
    for (const n of names) t = t.split(n).join(' ');
    const words = t.replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2);
    return new Set(words.slice(1).map((w, i) => `${words[i]} ${w}`));
  };
  const byType = new Map<string, Array<{ r: Rec; s: Set<string> }>>();
  for (const r of drafted) byType.set(r.type, [...(byType.get(r.type) ?? []), { r, s: masked(r) }]);
  for (const list of byType.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i].s, b = list[j].s;
        let inter = 0;
        for (const x of a) if (b.has(x)) inter++;
        const jac = inter / (a.size + b.size - inter || 1);
        if (jac >= SIMILAR) out.push(`${list[i].r.url}: ${Math.round(jac * 100)}% alike (masked) with ${list[j].r.url}`);
      }
    }
  }
  const labels = new Map<string, string[]>();
  const openers = new Map<string, string[]>();
  for (const r of drafted) {
    const label = norm(r.funnel!.step5.label);
    labels.set(label, [...(labels.get(label) ?? []), r.url]);
    for (const k of ['red', 'amber', 'green'] as const) {
      const opener = norm(r.funnel!.step3[k]).split(' ').slice(0, 5).join(' ');
      openers.set(`${k}: ${opener}`, [...(openers.get(`${k}: ${opener}`) ?? []), r.url]);
    }
  }
  for (const [label, urls] of labels) if (urls.length > 1) out.push(`${urls[0]}: step5 label "${label}" is also on ${urls.slice(1).join(', ')}`);
  for (const [opener, urls] of openers) if (urls.length > 3) out.push(`${urls[0]}: step3 ${opener.split(':')[0]} opener "${opener.split(': ')[1]}…" is shared by ${urls.length} pages`);
  return out;
}

if (require.main === module) {
  const file = process.argv[2] ?? 'funnel-drafts/records.json';
  const records = JSON.parse(fs.readFileSync(file, 'utf-8')) as Rec[];
  const { checked, errors, warnings } = validate(records);
  const pending = records.filter((r) => !r.noFunnel && !r.funnel).length;
  console.log(`${records.length} records · ${checked} funnels checked · ${pending} not drafted yet · ${errors.length} errors · ${warnings.length} warnings`);
  for (const e of errors.slice(0, 60)) console.log('  ERROR', e);
  for (const w of warnings.slice(0, 20)) console.log('  warn ', w);
  process.exitCode = errors.length ? 1 : 0;
}
