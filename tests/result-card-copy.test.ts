/**
 * The result card's words (lib/card-copy.ts), wherever they come from: the
 * built-in CARD_COPY and DEFAULT_CARD_COPY, a report card's scan-aware line
 * (reportCardCopy), and every page's funnel answers (data/funnels.json v2,
 * and the per-engine files in public/funnels/cta that ?from= pages read).
 *
 * Owner rules, 2026-09-16: the card sits on the result, on a 360px phone, so
 * every slot has a length limit (CARD_LIMITS); the meaning is one sentence
 * and never points "above" or "below" (the card moves); a free fix never
 * names Pro; the Pro line starts with its verb and sells exactly ONE of
 * data/brand.json's `pro` outcomes, and the button asks for that same one
 * without saying it already happened. Nothing may be a never-claim, a price,
 * a date or an overclaim word: every line also goes through the funnel
 * validator (scripts/funnels/validate.ts), so the card and the funnels are
 * held to one rule.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import brand from '../data/brand.json';
import {
  BENEFIT_FEATURE,
  BENEFIT_PATTERN,
  benefitOf,
  CARD_COPY,
  CARD_LIMITS,
  DEFAULT_CARD_COPY,
  GATE_COPY,
  PRO_LINE,
  reportCardCopy,
  type Benefit,
} from '../lib/card-copy';
import type { PageFunnel, ResultCopy } from '../lib/funnel-types';
import { severityFromGrade } from '../lib/severity';
import type { Grade } from '../lib/site-grade';
import { validate, type FunnelV2 } from '../scripts/funnels/validate';

type Sev = 'red' | 'amber' | 'green' | 'info';
interface Entry { where: string; engine: string; severity: Sev; copy: ResultCopy }

/** The colours each engine reports, read from its code on 2026-09-16 (see the comments in CARD_COPY). */
const ENGINE_SEVERITIES: Record<string, Sev[]> = {
  'whats-my-ip': ['red', 'info'],
  'useragent-analyzer': ['amber', 'info'],
  'password-strength': ['red', 'amber', 'green'],
  'screenshot-leak-checker': ['red', 'amber', 'green'],
  'cookie-analyzer': ['red', 'amber', 'green'],
  'privacy-quiz': ['red', 'amber', 'green'],
  'permission-checker': ['amber', 'green', 'info'],
  'email-pixel-detector': ['red', 'amber', 'green'],
  'dns-leak-test': ['red', 'amber', 'green', 'info'],
  'link-unwrapper': ['red', 'amber', 'green'],
  'browser-privacy': ['red', 'amber', 'green'],
  'url-analyzer': ['red', 'amber', 'green'],
  'metadata-viewer': ['red', 'amber', 'green', 'info'],
  'ad-blocker-test': ['red', 'amber', 'green'],
};

/** No brand.json pro outcome answers these results, so Pro is offered "Separately," and never as the fix. */
const UNRELATED_TO_PRO = ['password-strength', 'permission-checker', 'url-analyzer'];

const ONE_SENTENCE = (s: string) => !/[.!?]\s+\S/.test(s.trim());
const POINTS = /\b(above|below)\b/i;
const PRO_VERB = /^(?:Separately, [a-z]+s|[A-Z][a-z]+s)\b/;
const NAMES_PRO_FIRST = /^(?:Incognito\s+)?Pro\b/;
/** The free app's own features (brand.json `features`): a Pro line may name one only as free. */
const FREE_FEATURE = /\bblocks? (?:the )?ads\b|\bad[- ]?block(?:er|ing)\b|\bwipes?\b|\bAgent Cloaking\b|\bJavaScript\b/i;
/** A button is pressed before anything has happened. */
const ALREADY_HAPPENED = /\b(blocked|cleaned|stripped|hidden|protected|fixed|done|stopped|safe)\b/i;
/** What What's My IP and the DNS leak test must say plainly: Pro changes neither, and has no VPN. */
const NO_VPN = /\b(?:doesn't|does not)\s+(?:change\s+your\s+IP\s+address\s+or\s+)?include\s+a\s+VPN\b/;
const KEEPS_ADDRESS: Record<string, RegExp> = {
  'whats-my-ip': /\b(?:doesn't|does not)\s+change\s+your\s+IP\s+address\b/,
  'dns-leak-test': /\b(?:doesn't|does not)\s+change\s+your\s+DNS\b/,
};

const PRO_FEATURE_IDS = new Set(brand.pro.features.map((f) => f.id));

/**
 * Every rule a machine can check on one answer. The built-in buttons also
 * name their benefit ("Block trackers with Pro"); a page's own button may
 * say less ("Clean the rest with Pro"), but never ask for another benefit.
 */
function problems({ where, engine, copy }: Entry, builtInButton = false): string[] {
  const out: string[] = [];
  const say = (why: string, text?: string) => out.push(`${where}: ${why}${text === undefined ? '' : `: "${text}"`}`);
  const { meaning, free, pro, button } = copy;

  if (!meaning?.trim()) say('no meaning');
  else {
    if (meaning.length > CARD_LIMITS.meaning) say(`meaning is ${meaning.length} characters (max ${CARD_LIMITS.meaning})`, meaning);
    if (!ONE_SENTENCE(meaning)) say('meaning is more than one sentence', meaning);
    if (POINTS.test(meaning)) say('meaning points above or below', meaning);
  }

  if (free !== undefined) {
    if (!free.trim()) say('free is empty');
    if (free.length > CARD_LIMITS.free) say(`free is ${free.length} characters (max ${CARD_LIMITS.free})`, free);
    if (/\bPro\b/.test(free)) say('free names Pro', free);
  }

  if (!pro?.trim()) say('no Pro line');
  else {
    if (pro.length > CARD_LIMITS.pro) say(`pro is ${pro.length} characters (max ${CARD_LIMITS.pro})`, pro);
    if (NAMES_PRO_FIRST.test(pro) || !PRO_VERB.test(pro)) say('pro does not start with its verb', pro);
    const sold = (Object.keys(BENEFIT_PATTERN) as Benefit[]).filter((b) => BENEFIT_PATTERN[b].test(pro));
    if (sold.length !== 1) say(`pro sells ${sold.length ? sold.join(' and ') : 'no Pro outcome'}, not exactly one`, pro);
    const benefit = benefitOf(pro);
    if (!benefit || !PRO_FEATURE_IDS.has(BENEFIT_FEATURE[benefit])) say('pro maps to no data/brand.json pro feature', pro);
    if (FREE_FEATURE.test(pro) && !/\bfree\b/i.test(pro)) say('pro sells a free app feature as Pro', pro);
    if (KEEPS_ADDRESS[engine] && !(KEEPS_ADDRESS[engine].test(pro) && NO_VPN.test(pro))) say("pro doesn't say Pro changes no address and has no VPN", pro);

    if (!button?.trim()) say('no button');
    else {
      if (button.length > CARD_LIMITS.button) say(`button is ${button.length} characters (max ${CARD_LIMITS.button})`, button);
      const asks = benefitOf(button);
      if (asks ? asks !== benefit : builtInButton) say(`button asks for ${asks ?? 'no benefit'}, the Pro line sells ${benefit}`, button);
      if (ALREADY_HAPPENED.test(button)) say('button says it already happened', button);
    }
  }
  return out;
}

/**
 * Run answers through the funnel validator, each as the only answer of a
 * page that links out to its check (so the validator asks for exactly that
 * answer). Its banned words, never-claims, names and unbacked Pro claims
 * apply to the card as they do to every funnel.
 */
function validatorErrors(entries: Entry[]): string[] {
  const seen = new Set<string>();
  const records = entries.flatMap((e) => {
    // The validator also fails a page whose text repeats another's; the same answer on two pages is fine here.
    const key = `${e.copy.meaning} ${e.copy.pro}`;
    if (seen.has(key)) return [];
    seen.add(key);
    const funnel: FunnelV2 = {
      v: 2,
      step1: { unitKey: '', label: 'Copy', quote: 'The words under test' },
      stakes: 'The words under test.',
      check: { engine: 'cookie-analyzer', button: 'Run it' },
      results: { [e.severity]: e.copy },
    };
    return [{ id: e.where, url: e.where, type: 'guide', topic: null, title: e.where, units: [], check: null, funnel }];
  });
  return validate(records as never).errors;
}

const builtIn: Entry[] = [
  { where: 'DEFAULT_CARD_COPY', engine: '', severity: 'red', copy: DEFAULT_CARD_COPY },
  ...Object.entries(CARD_COPY).flatMap(([engine, bySeverity]) =>
    (Object.entries(bySeverity) as Array<[Sev, ResultCopy]>).map(([severity, copy]) => ({ where: `CARD_COPY['${engine}'].${severity}`, engine, severity, copy })),
  ),
];

const GRADES: Grade[] = ['A', 'B', 'C', 'D', 'F'];
const SCANS = [
  { trackingCookies: 0, trackers: 0 },
  { trackingCookies: 0, trackers: 3 },
  { trackingCookies: 1, trackers: 1 },
  { trackingCookies: 0, trackers: 0, pixels: 1 },
  { trackingCookies: 14, trackers: 12, pixels: 3 },
];
const reportCards: Entry[] = GRADES.flatMap((grade) =>
  [severityFromGrade(grade), 'red', 'amber', 'green', 'info'].flatMap((severity) =>
    SCANS.map((scan) => ({
      where: `reportCardCopy(${grade}, ${severity}, ${JSON.stringify(scan)})`,
      engine: 'report-card',
      severity: severity as Sev,
      copy: reportCardCopy(grade, severity as Sev, scan),
    })),
  ),
);

const ROOT = path.join(__dirname, '..');
const funnels = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'funnels.json'), 'utf-8')) as Record<string, PageFunnel>;
const funnelAnswers: Entry[] = Object.entries(funnels).flatMap(([page, f]) =>
  f.v === 2
    ? (Object.entries(f.results) as Array<[Sev, ResultCopy]>).map(([severity, copy]) => ({ where: `data/funnels.json ${page} ${severity}`, engine: f.check.engine, severity, copy }))
    : [],
);
const CTA_DIR = path.join(ROOT, 'public', 'funnels', 'cta');
const ctaAnswers: Entry[] = (fs.existsSync(CTA_DIR) ? fs.readdirSync(CTA_DIR) : [])
  .filter((f) => f.endsWith('.json'))
  .flatMap((file) => {
    const engine = file.replace(/\.json$/, '');
    const pages = JSON.parse(fs.readFileSync(path.join(CTA_DIR, file), 'utf-8')) as Record<string, { results: Partial<Record<Sev, ResultCopy>> }>;
    return Object.entries(pages).flatMap(([page, p]) =>
      (Object.entries(p.results) as Array<[Sev, ResultCopy]>).map(([severity, copy]) => ({ where: `public/funnels/cta/${file} ${page} ${severity}`, engine, severity, copy })),
    );
  });

describe("the result card's built-in words", () => {
  it('every engine that shows a card has words for exactly the colours it reports', () => {
    expect(Object.keys(CARD_COPY).sort()).toEqual(Object.keys(ENGINE_SEVERITIES).sort());
    for (const [engine, severities] of Object.entries(ENGINE_SEVERITIES)) {
      expect(Object.keys(CARD_COPY[engine]).sort(), engine).toEqual([...severities].sort());
    }
  });

  it("every slot keeps the card's limits and rules", () => {
    expect(builtIn.flatMap((e) => problems(e, true))).toEqual([]);
  });

  it("a report card's line keeps them for every grade, colour and scan", () => {
    expect(reportCards.flatMap((e) => problems(e, true))).toEqual([]);
  });

  it('each default Pro line sells its own benefit, and the benefits are exactly brand.json pro features', () => {
    for (const b of Object.keys(PRO_LINE) as Benefit[]) {
      expect(benefitOf(PRO_LINE[b]), PRO_LINE[b]).toBe(b);
      expect(problems({ where: `PRO_LINE['${b}']`, engine: '', severity: 'red', copy: { meaning: 'A result.', pro: PRO_LINE[b], button: DEFAULT_BUTTON[b] } }, true)).toEqual([]);
    }
    expect(Object.values(BENEFIT_FEATURE).sort()).toEqual([...PRO_FEATURE_IDS].sort());
  });

  it('no banned word, never-claim or unbacked Pro claim, by the funnel validator', () => {
    expect(validatorErrors([...builtIn, ...reportCards])).toEqual([]);
  });

  it("a result no Pro outcome answers offers Pro 'Separately,', never as the fix", () => {
    for (const engine of UNRELATED_TO_PRO) {
      for (const [severity, copy] of Object.entries(CARD_COPY[engine])) expect(copy!.pro, `${engine} ${severity}`).toMatch(/^Separately, /);
    }
  });

  it("What's My IP and the DNS leak test say plainly that Pro changes neither and includes no VPN", () => {
    for (const engine of Object.keys(KEEPS_ADDRESS)) {
      for (const [severity, copy] of Object.entries(CARD_COPY[engine])) {
        expect(copy!.pro, `${engine} ${severity}`).toMatch(KEEPS_ADDRESS[engine]);
        expect(copy!.pro, `${engine} ${severity}`).toMatch(NO_VPN);
      }
    }
  });

  it('the Metadata Viewer sells whole-folder cleaning, not the one-photo viewer', () => {
    for (const copy of Object.values(CARD_COPY['metadata-viewer'])) {
      expect(benefitOf(copy!.pro)).toBe('photo-cleaning');
      expect(copy!.pro).toMatch(/whole folder/);
    }
  });
});

describe("page funnels' answers, shown in the same card", () => {
  it('data/funnels.json v2 answers keep the limits and rules', () => {
    expect(funnelAnswers.length).toBeGreaterThan(0);
    expect(funnelAnswers.flatMap((e) => problems(e))).toEqual([]);
  });

  it('data/funnels.json v2 answers pass the funnel validator', () => {
    expect(validatorErrors(funnelAnswers)).toEqual([]);
  });

  it('the ?from= files in public/funnels/cta keep them too', () => {
    expect(ctaAnswers.flatMap((e) => problems(e))).toEqual([]);
    expect(validatorErrors(ctaAnswers)).toEqual([]);
  });
});

const DEFAULT_BUTTON: Record<Benefit, string> = {
  'tracker-blocking': 'Block trackers with Pro',
  'hides-ad-boxes': 'Hide empty ad boxes with Pro',
  'photo-cleaning': 'Clean whole folders with Pro',
};

/**
 * Gate copy (lib/card-copy.ts GATE_COPY, owner 2026-09-18): the words shown
 * when a visitor attempts one of the three restricted actions on the Pro
 * tools. Reuses the exact same `problems()` checks as every other Pro line
 * on the site — a gate can never say more than the result card already
 * says — mapping `stake` onto `meaning` since it plays the same role.
 */
describe('gate copy (lib/card-copy.ts GATE_COPY)', () => {
  for (const [action, gate] of Object.entries(GATE_COPY)) {
    it(`${action}: holds to the same rules as every other Pro line`, () => {
      const entry: Entry = {
        where: `GATE_COPY['${action}']`,
        engine: '',
        severity: 'red',
        copy: { meaning: gate.stake, free: gate.free, pro: gate.pro, button: gate.button },
      };
      expect(problems(entry, true)).toEqual([]);
      expect(gate.headline.trim(), 'headline is empty').not.toBe('');
      expect(gate.headline.length, `headline is ${gate.headline.length} characters (max ${CARD_LIMITS.headline})`).toBeLessThanOrEqual(CARD_LIMITS.headline);
      expect(benefitOf(gate.pro), `${action}'s pro line sells a different benefit than it declares`).toBe(gate.benefit);
    });
  }
});
