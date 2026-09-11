/**
 * Every calculator in data/calculators must produce a number.
 *
 * Regression guard for the bug where CalculatorPage ran each formula as
 * `new Function('inputs', formula)`: 30 of the 44 formulas name their inputs
 * directly (`browsing_frequency * 2`), threw on the first reference, and the
 * page showed "-" in every result field whatever the visitor entered. One
 * more (encrypted-messaging) ended in an object literal with no `return`.
 *
 * Once they ran, a second class showed: a formula's own Risk Level or grade
 * disagreeing with the legend row the page tags "Your result" (facial-
 * recognition printed "A+" at Critical Risk; seven more used cut-offs other
 * than their legend's). Sampled answers check every level against its row.
 * The samples include decimals typed into number boxes, stored as the page
 * stores them: typed as is, 2.5 extensions scored browser-privacy 79.5,
 * Medium Risk by its formula but printed 80 on the Low Risk row.
 *
 * These tests call the component's own runCalculator, so they exercise the
 * code the page runs, not a copy of it.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  CalculatorPage,
  bandFor,
  legendFieldOf,
  numberAnswer,
  parseBands,
  runCalculator,
  shownNumber,
  toneOf,
} from '../components/CalculatorPage';

interface CalcInput {
  id: string;
  label: string;
  type: 'number' | 'select' | 'range' | 'checkbox';
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  minLabel?: string;
  maxLabel?: string;
  options?: Array<{ value: string | number; label: string }>;
}

interface Calculator {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  description: string;
  inputs: CalcInput[];
  outputFields: Array<{ id: string; label: string; format: 'percentage' | 'score' | 'grade' | 'text' | 'number' | 'currency' }>;
  formula: string;
  educational: { interpretation?: Array<{ range: string; label: string; description: string; color: string }> };
}

const DIR = path.join(__dirname, '..', 'data', 'calculators');

function loadAll(): Array<{ file: string; data: Calculator }> {
  const out: Array<{ file: string; data: Calculator }> = [];
  for (const niche of fs.readdirSync(DIR)) {
    const nicheDir = path.join(DIR, niche);
    if (!fs.statSync(nicheDir).isDirectory()) continue;
    for (const f of fs.readdirSync(nicheDir)) {
      if (!f.endsWith('.json')) continue;
      out.push({ file: `${niche}/${f}`, data: JSON.parse(fs.readFileSync(path.join(nicheDir, f), 'utf-8')) });
    }
  }
  return out;
}

const defaultsOf = (c: Calculator) => Object.fromEntries(c.inputs.map((i) => [i.id, i.defaultValue]));

/** The values a visitor can pick for one input, as the page stores them (selects hand back strings). */
function choicesFor(input: CalcInput): Array<number | string | boolean> {
  switch (input.type) {
    case 'select': return (input.options ?? []).map((o) => String(o.value));
    case 'checkbox': return [true, false];
    case 'range':
    case 'number': return [input.min ?? 0, input.max ?? 100];
  }
}

/** Small seeded PRNG (mulberry32), so a failing sample is the same on every run. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * What a visitor might type into a number box, decimals and values past
 * either end included, as the page stores it.
 */
function typedChoicesFor(input: CalcInput): number[] {
  if (input.type !== 'number') return [];
  const min = input.min ?? 0;
  const max = input.max ?? 100;
  return [min + 0.4, min + 0.5, (min + max) / 2 + 0.3, max - 0.5, max + 2.7, min - 1.5].map((typed) => numberAnswer(input, typed));
}

/** One answer a visitor could give: any option, either checkbox state, any slider stop, anything typed into a number box. */
function randomChoice(input: CalcInput, rand: () => number): number | string | boolean {
  switch (input.type) {
    case 'select': {
      const opts = input.options ?? [];
      return String(opts[Math.floor(rand() * opts.length)].value);
    }
    case 'checkbox': return rand() < 0.5;
    case 'range':
    case 'number': {
      const min = input.min ?? 0;
      const max = input.max ?? 100;
      if (input.type === 'number' && rand() < 0.5) return numberAnswer(input, min - 1 + rand() * (max - min + 2));
      const step = input.step ?? 1;
      const stops = Math.floor((max - min) / step);
      return Number((min + Math.floor(rand() * (stops + 1)) * step).toFixed(6));
    }
  }
}

/** Every answer set the agreement check runs: the defaults, each single change from them (typed decimals too), then seeded random sets. */
function sampleAnswers(c: Calculator, count: number): Array<Record<string, number | string | boolean>> {
  const defaults = defaultsOf(c);
  const out: Array<Record<string, number | string | boolean>> = [defaults];
  for (const input of c.inputs) {
    for (const choice of [...choicesFor(input), ...typedChoicesFor(input)]) out.push({ ...defaults, [input.id]: choice });
  }
  const rand = seeded([...c.slug].reduce((h, ch) => Math.imul(h ^ ch.charCodeAt(0), 16777619), 2166136261));
  for (let n = 0; n < count; n++) out.push(Object.fromEntries(c.inputs.map((i) => [i.id, randomChoice(i, rand)])));
  return out;
}

// Words a verdict is written with that don't change which verdict it is:
// "Low Risk", "Low" and "LOW" are one verdict, as are "Excellent Security"
// and "A - Excellent".
const FILLER_WORDS = new Set(['risk', 'security', 'privacy', 'protection', 'success']);

/**
 * A level value or legend label split into the letter grade it states and
 * its verdict words: "Low Risk (Grade A)" is A + "low", "A - Excellent" is
 * A + "excellent", "Very High" is "very high", "B+" is just the grade.
 */
function verdictOf(text: string): { grade?: string; words: string } {
  const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w && !FILLER_WORDS.has(w)).join(' ');
  const t = text.trim();
  const graded = t.match(/^([A-F][+-]?)(?:\s*[-–—]\s*(.*))?$/);
  if (graded) return { grade: graded[1], words: words(graded[2] ?? '') };
  const stated = t.match(/^(.*?)\s*\((?:grade\s+)?([A-F][+-]?)\)$/i);
  if (stated) return { grade: stated[2].toUpperCase(), words: words(stated[1]) };
  // "Minimal - Well Protected": the verdict is the part before the dash.
  const dashed = t.match(/^(.*?)\s+[-–—]\s+/);
  return { words: words(dashed ? dashed[1] : t) };
}

/** A+ best … F worst. */
function gradeRank(grade: string): number {
  return 'ABCDF'.indexOf(grade[0]) * 3 + (grade[1] === '+' ? 0 : grade[1] === '-' ? 2 : 1);
}

/** Output fields that state a verdict of their own: a grade, or text named as a level / category. */
function levelFieldsOf(c: Calculator) {
  const legendField = legendFieldOf(c.outputFields);
  return c.outputFields.filter((f) => f !== legendField
    && (f.format === 'grade' || (f.format === 'text' && /level|category|grade/i.test(f.id))));
}

function assertRealOutputs(c: Calculator, result: Record<string, unknown> | null, context: string) {
  expect(result, `${context}: formula threw or left a field empty`).not.toBeNull();
  for (const field of c.outputFields) {
    const v = result![field.id];
    const numeric = ['percentage', 'score', 'number', 'currency'].includes(field.format);
    if (numeric) {
      expect(Number.isFinite(Number(v)) && v !== '' && v !== null, `${context}: ${field.id}=${String(v)}`).toBe(true);
    } else {
      expect(typeof v === 'number' ? Number.isFinite(v) : typeof v === 'string' && v.trim().length > 0, `${context}: ${field.id}=${String(v)}`).toBe(true);
    }
  }
}

const calculators = loadAll();

describe('data/calculators', () => {
  it('loads all 44 calculators', () => {
    expect(calculators.length).toBe(44);
  });

  for (const { file, data } of calculators) {
    describe(file, () => {
      it('every input id can be passed to the formula as a parameter name', () => {
        for (const input of data.inputs) {
          expect(input.id, file).toMatch(/^[A-Za-z_$][\w$]*$/);
          expect(input.id, file).not.toBe('inputs');
        }
      });

      it('produces a real value in every output field with its own defaults', () => {
        assertRealOutputs(data, runCalculator(data.formula, defaultsOf(data), data.outputFields), `${file} defaults`);
      });

      it('still produces a result for every option and at both ends of every slider', () => {
        const defaults = defaultsOf(data);
        for (const input of data.inputs) {
          for (const choice of choicesFor(input)) {
            const result = runCalculator(data.formula, { ...defaults, [input.id]: choice }, data.outputFields);
            assertRealOutputs(data, result, `${file} ${input.id}=${String(choice)}`);
          }
        }
      });

      it('looks up answers with ?? so an answer scored 0 is not replaced by the fallback', () => {
        // `{'never': 0, ...}[answer] || 25` scored the safest answer as 25,
        // and so did a named map: `sharingScores[answer] || 10` with never: 0.
        // Any bracket lookup followed by || is caught, inline or named.
        expect(data.formula, file).not.toMatch(/\]\s*\|\|/);
      });

      it('rating sliders label both ends or neither', () => {
        for (const input of data.inputs) {
          expect(!!input.minLabel, `${file} ${input.id}`).toBe(!!input.maxLabel);
        }
      });

      if (data.educational.interpretation?.length) {
        it('has a legend the page can colour the result from', () => {
          const rows = data.educational.interpretation!;
          const bands = parseBands(rows);
          expect(bands.length, `${file}: every legend range parses`).toBe(rows.length);
          for (const row of rows) expect(toneOf(row.color), `${file}: colour "${row.color}" maps to a token`).not.toBe('neutral');
          const field = legendFieldOf(data.outputFields);
          expect(field, `${file}: has a score or percentage field for the legend`).toBeDefined();
          const result = runCalculator(data.formula, defaultsOf(data), data.outputFields)!;
          expect(bandFor(bands, Number(result[field!.id])), `${file}: default result falls in a legend row`).toBeDefined();
        });

        it('never paints a Moderate / Medium legend row as danger', () => {
          // Orange maps to danger, and six files once used it for a Moderate
          // row, so a middling result was drawn red. "Medium-High" is a High row.
          for (const row of data.educational.interpretation!) {
            const words = verdictOf(row.label).words.split(' ');
            if ((words.includes('moderate') || words.includes('medium')) && !words.includes('high')) {
              expect(toneOf(row.color), `${file}: "${row.range} ${row.label}" is ${row.color}`).not.toBe('danger');
            }
          }
        });

        it('uses light green only for the row next to the safest, as the tone map says', () => {
          // Light green maps to ok even on a row labelled Moderate; that only
          // reads right while it sits next to the safest row.
          const rows = data.educational.interpretation!;
          const bySafety = [...parseBands(rows)].sort((a, b) => a.lo - b.lo);
          if (bySafety[0].tone === 'danger') bySafety.reverse();
          bySafety.forEach((band, i) => {
            const row = rows[band.index];
            if (['lightgreen', '#84cc16'].includes(row.color.trim().toLowerCase())) expect(i, `${file}: "${row.range} ${row.label}"`).toBe(1);
          });
        });

        it('every level and grade it prints agrees with the legend row the score falls in', () => {
          // The page tags the legend row the score falls in as "Your result"
          // and prints the formula's own level next to it. They must be one
          // verdict: never "Low Risk" (or "A+") beside the "Critical Risk" row.
          const rows = data.educational.interpretation!;
          const bands = parseBands(rows);
          const field = legendFieldOf(data.outputFields)!;
          const levelFields = levelFieldsOf(data);
          const byRisk = [...bands].sort((a, b) => a.lo - b.lo);
          // Which end is safe comes from the legend's own colours, so a
          // higher-is-better score (password strength, success odds) reads right.
          expect(['ok', 'danger'], `${file}: legend runs from a green end to a red end`).toContain(byRisk[0].tone);
          if (byRisk[0].tone === 'danger') byRisk.reverse();
          const riskOrder = new Map(byRisk.map((b, i) => [b.index, i]));
          const vocabulary = new Set(rows.flatMap((r) => verdictOf(r.label).words.split(' ').filter(Boolean)));

          const seen = new Map(levelFields.map((f) => [f.id, new Map<number, string>()]));
          for (const answers of sampleAnswers(data, 1500)) {
            const result = runCalculator(data.formula, answers, data.outputFields);
            expect(result, `${file} ${JSON.stringify(answers)}`).not.toBeNull();
            const shown = shownNumber(field, result![field.id]);
            const band = bandFor(bands, shown)!;
            const row = verdictOf(rows[band.index].label);
            for (const level of levelFields) {
              const value = String(result![level.id]);
              const context = `${file}: ${field.id}=${shown} is "${rows[band.index].label}" but ${level.id}="${value}" (${JSON.stringify(answers)})`;
              // One value per legend row …
              const byRow = seen.get(level.id)!;
              if (byRow.has(band.index)) expect(value, context).toBe(byRow.get(band.index));
              byRow.set(band.index, value);
              // … written in the row's own words or grade when it uses them.
              const mine = verdictOf(value);
              if (mine.grade && row.grade) expect(mine.grade, context).toBe(row.grade);
              if (mine.words.split(' ').some((w) => vocabulary.has(w))) expect(mine.words, context).toBe(row.words);
            }
          }
          for (const level of levelFields) {
            // … and a different value for each row, graded best to worst from the safe end.
            const values = [...seen.get(level.id)!.entries()].sort((a, b) => riskOrder.get(a[0])! - riskOrder.get(b[0])!).map(([, v]) => v);
            expect(new Set(values).size, `${file}: ${level.id} gives two legend rows the same value: ${values.join(', ')}`).toBe(values.length);
            const grades = values.map((v) => verdictOf(v).grade);
            if (grades.every(Boolean)) {
              const ranks = grades.map((g) => gradeRank(g!));
              expect(ranks, `${file}: ${level.id} grades run ${grades.join(', ')} from the safest legend row`).toEqual([...ranks].sort((a, b) => a - b));
            }
          }
        });
      }
    });
  }
});

describe('answers and verdicts the review caught', () => {
  const calc = (prefix: string) => calculators.find((c) => c.file.startsWith(prefix))!.data;
  const score = (c: Calculator, answers: Record<string, number | string | boolean>) =>
    runCalculator(c.formula, { ...defaultsOf(c), ...answers }, c.outputFields)!;

  it('a safest answer scored 0 in a named map no longer scores as the fallback', () => {
    // `sharingScores[x] || 10` with never: 0 made "Never share files" worse than "Rarely".
    const cloud = calc('cloud-privacy/');
    const cloudRisk = (sharingFrequency: string) =>
      Number(score(cloud, { provider: 'proton-drive', encryptionUsed: 'zero-knowledge', sharingFrequency }).riskScore);
    expect(cloudRisk('never')).toBeLessThan(cloudRisk('rare'));
    expect(cloudRisk('rare')).toBeLessThan(cloudRisk('occasional'));
    // `socialScores[x] || 4` with none: 0 made "Don't use social media" worse than "Light".
    const cookies = calc('cookie-management/');
    const cookieRisk = (socialMediaUse: string) => Number(score(cookies, { socialMediaUse }).riskScore);
    expect(cookieRisk('none')).toBeLessThan(cookieRisk('light'));
    expect(cookieRisk('light')).toBeLessThan(cookieRisk('moderate'));
  });

  it('facial-recognition names the Critical Risk row at the highest exposure, not "A+"', () => {
    const c = calc('facial-recognition/');
    const worst = score(c, { location: 'urban', publicSpaces: 80, socialMedia: 'frequent', workplace: 'extensive', protections: 'none', activism: true });
    expect(Number(worst.riskScore)).toBeGreaterThanOrEqual(70);
    expect(worst.riskLevel).toBe('Critical Risk');
    const least = score(c, { location: 'rural', publicSpaces: 0, socialMedia: 'none', workplace: 'none', protections: 'advanced', activism: false });
    expect(least.riskLevel).toBe('Low Risk');
  });

  it('browser-privacy grades a typed 2.5 extensions as the 3 the box then shows, so level and row agree', () => {
    const c = calc('browser-privacy/');
    const typed = numberAnswer(c.inputs.find((i) => i.id === 'extensionsInstalled')!, 2.5);
    expect(typed).toBe(3);
    // As typed, 2.5 scored 79.5: "Medium Risk" by the formula, printed 80 on the "80-100 Low Risk" row.
    const result = score(c, {
      browserType: 'incognito-browser', trackingProtection: 'strict', thirdPartyCookies: 'blocked',
      extensionsInstalled: typed, incognitoUsage: 'rarely', syncEnabled: true, locationSharing: 'allowed',
    });
    expect(result.privacyScore).toBe(81);
    expect(result.riskLevel).toBe('Low Risk');
  });

  it('gives the same answers the same result every time', () => {
    // social-media-privacy added Math.random() to its exposure figure, so the
    // number changed on every visit and between the served page and the page after load.
    for (const { file, data } of calculators) {
      expect(data.formula, file).not.toMatch(/Math\.random|Date\.now|new Date/);
      const answers = defaultsOf(data);
      const first = runCalculator(data.formula, answers, data.outputFields);
      for (let n = 0; n < 10; n++) expect(runCalculator(data.formula, answers, data.outputFields), file).toEqual(first);
    }
  });
});

describe('bandFor', () => {
  const rows = (ranges: Array<[string, string]>) => ranges.map(([range, color]) => ({ range, color, label: range, description: '' }));

  it('uses the legend, not a fixed higher-is-worse rule', () => {
    // browser-privacy style: higher is better, listed high to low.
    const better = parseBands(rows([['80-100', 'green'], ['60-79', 'yellow'], ['40-59', 'orange'], ['0-39', 'red']]));
    expect(bandFor(better, 92)?.tone).toBe('ok');
    expect(bandFor(better, 12)?.tone).toBe('danger');
    // ad-tracking style: higher is worse.
    const worse = parseBands(rows([['0-25', 'green'], ['26-50', 'yellow'], ['51-75', 'orange'], ['76-100', 'red']]));
    expect(bandFor(worse, 92)?.tone).toBe('danger');
    expect(bandFor(worse, 12)?.tone).toBe('ok');
  });

  it('files values between whole-number edges under the lower row, and out-of-range values at the ends', () => {
    const bands = parseBands(rows([['5-29%', 'darkred'], ['30-44%', 'red'], ['75-95%', 'green']]));
    expect(bandFor(bands, 29.5)?.index).toBe(0);
    expect(bandFor(bands, 2)?.index).toBe(0);
    expect(bandFor(bands, 99)?.index).toBe(2);
    expect(bandFor(bands, Number.NaN)).toBeUndefined();
  });
});

describe('numberAnswer', () => {
  it('rounds a typed number to a whole number when the box has no step', () => {
    expect(numberAnswer({ min: 0, max: 10 }, 2.5)).toBe(3);
    expect(numberAnswer({ min: 0, max: 10 }, 2.4)).toBe(2);
  });

  it('keeps a typed number between the box\'s min and max', () => {
    expect(numberAnswer({ min: 0, max: 10 }, 12.2)).toBe(10);
    expect(numberAnswer({ min: 0, max: 10 }, -3)).toBe(0);
  });

  it('rounds to the box\'s step, counted from min, never past max, without float noise', () => {
    expect(numberAnswer({ min: 1, max: 10, step: 2 }, 4.2)).toBe(5);
    expect(numberAnswer({ min: 0, max: 10, step: 4 }, 10)).toBe(8);
    expect(numberAnswer({ min: 0, max: 1, step: 0.1 }, 0.33)).toBe(0.3);
  });

  it('reads an empty box as 0 and an unreadable one as min', () => {
    expect(numberAnswer({ min: 0, max: 10 }, Number(''))).toBe(0);
    expect(numberAnswer({ min: 2, max: 10 }, Number.NaN)).toBe(2);
  });
});

describe('runCalculator', () => {
  const fields = [{ id: 'score', format: 'score' as const }];

  it('passes answers by name and as inputs.x', () => {
    expect(runCalculator('return { score: a + inputs.b };', { a: 1, b: 2 }, fields)).toEqual({ score: 3 });
  });

  it('returns null for a syntax error, a throw, or a missing / NaN field', () => {
    expect(runCalculator('{ score: 1 }', {}, fields)).toBeNull();
    expect(runCalculator('return { score: missing };', {}, fields)).toBeNull();
    expect(runCalculator('return {};', {}, fields)).toBeNull();
    expect(runCalculator('return { score: 0 / 0 };', {}, fields)).toBeNull();
  });
});

describe('CalculatorPage', () => {
  const sample = calculators.find((c) => c.file.startsWith('ad-tracking/'))!.data;
  const render = (data: Calculator) =>
    renderToStaticMarkup(React.createElement(CalculatorPage, { data, nicheName: 'Ad Tracking', proofRoute: null }));

  it('labels the first result as an example worked out from sample answers', () => {
    const html = render(sample);
    expect(html).toContain('data-calculator-result="example"');
    expect(html).toContain('Example result');
    expect(html).not.toContain('This calculator is unavailable');
  });

  it('says the calculator is unavailable instead of showing dashes when the formula fails', () => {
    const html = render({ ...sample, formula: '{ risk_score: 1 }' });
    expect(html).toContain('data-calculator-result="unavailable"');
    expect(html).toContain('This calculator is unavailable');
  });

  it('prints both ends of a slider, with words on a rating scale', () => {
    const ccpa = calculators.find((c) => c.file.startsWith('ccpa/'))!.data;
    const html = renderToStaticMarkup(React.createElement(CalculatorPage, { data: ccpa, nicheName: 'CCPA', proofRoute: null }));
    expect(html).toContain('None');
    expect(html).toContain('Comprehensive');
  });

  it('links every label to its field', () => {
    const html = render(sample);
    const labels = [...html.matchAll(/<label[^>]*for="([^"]+)"/g)].map((m) => m[1]);
    expect(labels.length).toBe(sample.inputs.length);
    for (const id of labels) expect(html).toContain(`id="${id}"`);
  });
});
