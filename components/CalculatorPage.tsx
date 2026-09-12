'use client';

import { useState, useMemo, useId } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { Badge } from './ui/Badge';
import { EditorialNote } from './EditorialNote';
import { CheckYoursNow } from './CheckYoursNow';
import { PageFunnel } from './PageFunnel';
import type { PageFunnel as Funnel } from '@/lib/funnels';
import { Icon } from './ui/Icon';
import { TYPE_ICON, diagramForNiche } from '@/lib/visuals';
import type { ProofRoute } from '@/lib/proof-route';

interface CalcInput {
  id: string;
  label: string;
  type: 'number' | 'select' | 'range' | 'checkbox';
  defaultValue: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Words for a rating slider's two ends, e.g. "None" / "Comprehensive". */
  minLabel?: string;
  maxLabel?: string;
  options?: Array<{ value: string | number; label: string }>;
  helpText?: string;
}

interface OutputField {
  id: string;
  label: string;
  format: 'percentage' | 'score' | 'grade' | 'text' | 'number' | 'currency';
  description?: string;
}

interface Interpretation {
  range: string;
  label: string;
  description: string;
  color: string;
}

interface CalculatorData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  description: string;
  inputs: CalcInput[];
  outputFields: OutputField[];
  formula: string;
  educational: {
    methodology?: string;
    tips?: string[];
    interpretation?: Interpretation[];
  };
}

type Answers = Record<string, number | string | boolean>;
type Outputs = Record<string, number | string>;

const NUMERIC_FORMATS = new Set<OutputField['format']>(['percentage', 'score', 'number', 'currency']);

/** A value we can show: a finite number (or numeric string) for number formats, non-empty text otherwise. */
function isRealValue(format: OutputField['format'], value: unknown): boolean {
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'string' || !value.trim()) return false;
  return NUMERIC_FORMATS.has(format) ? Number.isFinite(Number(value)) : true;
}

/**
 * Run a calculator's formula against a set of answers.
 *
 * The formulas in data/calculators refer to answers two ways: by bare name
 * (`browsing_frequency * 2`) and as `inputs.x`. They used to run as
 * `new Function('inputs', formula)`, which left every bare name undefined,
 * so 30 of the 44 calculators threw and showed dashes whatever you entered.
 * Each answer is now also passed in as a parameter of its own name.
 *
 * Returns null when the formula throws or leaves any output field without a
 * real value, so the page can say so instead of showing dashes or NaN.
 */
export function runCalculator(
  formula: string,
  answers: Answers,
  fields: Array<Pick<OutputField, 'id' | 'format'>>,
): Outputs | null {
  try {
    const names = Object.keys(answers);
    const out: unknown = new Function('inputs', ...names, formula)(answers, ...names.map((n) => answers[n]));
    if (!out || typeof out !== 'object') return null;
    const values = out as Record<string, unknown>;
    return fields.every((f) => isRealValue(f.format, values[f.id])) ? (values as Outputs) : null;
  } catch {
    return null;
  }
}

export type Tone = 'ok' | 'warn' | 'danger' | 'neutral';

// Legend colours in data/calculators are free-form CSS names and hex values
// ("green", "lightgreen", "#f97316", "darkred"). They map onto the three
// status tokens so the legend dot and the number share one palette. The
// colour sets the tone, not the row's wording: green and light green are the
// safe end and map to ok, and light green is always the row next to the
// safest, even where a legend calls that row Moderate. Yellow marks the
// middle rows (Medium, Moderate, Elevated, Fair) and maps to warn, as Badge
// draws "medium"; orange marks High / Poor rows and maps to danger, as Badge
// draws "high".
const TONE_OF_COLOUR: Record<string, Tone> = {
  green: 'ok', lightgreen: 'ok', '#22c55e': 'ok', '#84cc16': 'ok',
  yellow: 'warn', '#eab308': 'warn', '#f59e0b': 'warn',
  orange: 'danger', '#f97316': 'danger',
  red: 'danger', '#ef4444': 'danger', darkred: 'danger', '#dc2626': 'danger',
};

export function toneOf(colour: string): Tone {
  return TONE_OF_COLOUR[colour.trim().toLowerCase()] ?? 'neutral';
}

// Literal class strings, never interpolated, so Tailwind's scanner sees them.
const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger', neutral: 'text-t1' };
const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', danger: 'bg-danger', neutral: 'bg-t3' };

export interface Band {
  /** Lower edge of the legend row, e.g. 26 for "26-50". */
  lo: number;
  /** Position of the row in the page's legend. */
  index: number;
  tone: Tone;
}

/** Numeric lower edge of each legend row ("0-25", "26-50%", "75-95%"); rows whose range doesn't parse are left out. */
export function parseBands(rows: Interpretation[]): Band[] {
  return rows.flatMap((row, index) => {
    const m = row.range.match(/(\d+(?:\.\d+)?)\s*%?\s*[-–]\s*\d/);
    return m ? [{ lo: Number(m[1]), index, tone: toneOf(row.color) }] : [];
  });
}

/**
 * The legend row a value falls in. Rows are written with whole-number edges
 * (0-25, 26-50), so 25.5 sits between two: it files under the highest row
 * whose lower edge it has reached. Sorting first means a legend listed
 * high-to-low ("80-100 Low Risk" first, for higher-is-better scores) works
 * the same as one listed low-to-high.
 */
export function bandFor(bands: Band[], value: number): Band | undefined {
  if (!Number.isFinite(value) || bands.length === 0) return undefined;
  const sorted = [...bands].sort((a, b) => a.lo - b.lo);
  return sorted.reduce((hit, b) => (value >= b.lo ? b : hit), sorted[0]);
}

/** The output the page's legend describes: its first score or percentage field. */
export function legendFieldOf<T extends Pick<OutputField, 'format'>>(fields: T[]): T | undefined {
  return fields.find((f) => f.format === 'score' || f.format === 'percentage');
}

/** The number as the page prints it, so the colour matches the digits the visitor reads. */
export function shownNumber(field: Pick<OutputField, 'format'>, value: number | string): number {
  const n = Number(value);
  return field.format === 'score' ? Math.round(n) : Math.round(n * 10) / 10;
}

/**
 * A number typed into a box, as the calculator takes it: inside the box's
 * min and max, on its step (whole numbers when it has none), counted from
 * min as the browser counts steps. Typed decimals used to reach the formula
 * as typed: 2.5 extensions in browser-privacy could score 79.5, which the
 * formula called Medium Risk while the page printed 80 and tagged the Low
 * Risk row. The box now shows the value the result was worked out from.
 */
export function numberAnswer(input: Pick<CalcInput, 'min' | 'max' | 'step'>, typed: number): number {
  const inRange = Math.min(input.max ?? Infinity, Math.max(input.min ?? -Infinity, typed));
  const from = input.min ?? 0;
  if (!Number.isFinite(inRange)) return from;
  const step = input.step && input.step > 0 ? input.step : 1;
  let stops = Math.round((inRange - from) / step);
  if (input.max !== undefined && from + stops * step > input.max) stops -= 1;
  // To the step's own decimals, so steps of 0.1 give 0.3, not 0.30000000000000004.
  return Number((from + stops * step).toFixed((String(step).split('.')[1] ?? '').length));
}

function defaultsOf(inputs: CalcInput[]): Answers {
  return Object.fromEntries(inputs.map((i) => [i.id, i.defaultValue]));
}

export function CalculatorPage({ data, nicheName, proofRoute, funnel }: { data: CalculatorData; nicheName: string; proofRoute?: ProofRoute | null; funnel?: Funnel | null }) {
  const [inputValues, setInputValues] = useState<Answers>(() => defaultsOf(data.inputs));
  // The fields start on the page's sample answers. Until the visitor changes
  // one, the result is an example, and is labelled as one rather than
  // presented as their verdict.
  const [touched, setTouched] = useState(false);
  const idPrefix = useId();

  const results = useMemo(
    () => runCalculator(data.formula, inputValues, data.outputFields),
    [inputValues, data.formula, data.outputFields],
  );

  const interpretation = data.educational.interpretation;
  const legendField = legendFieldOf(data.outputFields);
  const bands = useMemo(() => parseBands(interpretation ?? []), [interpretation]);
  const activeBand = touched && results && legendField
    ? bandFor(bands, shownNumber(legendField, results[legendField.id]))
    : undefined;

  const setAnswer = (id: string, value: number | string | boolean) => {
    setInputValues((prev) => ({ ...prev, [id]: value }));
    setTouched(true);
  };
  const resetAnswers = () => {
    setInputValues(defaultsOf(data.inputs));
    setTouched(false);
  };

  const formatValue = (field: OutputField, value: number | string) => {
    switch (field.format) {
      case 'percentage': return `${Number(value).toFixed(1)}%`;
      case 'score': return `${Number(value).toFixed(0)}/100`;
      case 'currency': return `$${Number(value).toLocaleString()}`;
      case 'number': return Number(value).toLocaleString();
      default: return String(value);
    }
  };

  const resultHeading = !results ? 'Result' : touched ? 'Your result' : 'Example result';

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Calculators', href: '/calculators' },
        { label: nicheName, href: `/calculators/${data.niche}` },
        { label: data.title },
      ]} />

      <PageHero
        icon={TYPE_ICON.calculator}
        kicker={`${nicheName} · calculator`}
        title={data.title}
        badges={
          <>
            <Badge label={`${data.inputs.length} settings`} />
            <Badge label={`${data.outputFields.length} results`} />
          </>
        }
        diagram={diagramForNiche(data.niche)}
      />

      <p className="prose-ib text-lede mb-8">{data.description}</p>

      {funnel
        ? <PageFunnel funnel={funnel} niche={data.niche} />
        : proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-s0 border border-b1 rounded-[12px] p-5">
          <div className="flex items-center justify-between gap-2 mb-1">
            <h2 className="font-mono text-h3 font-semibold text-t1">Your settings</h2>
            {touched && (
              <button type="button" onClick={resetAnswers} className="btn-ghost text-xs">Reset to example</button>
            )}
          </div>
          {!touched && <p className="text-meta text-t3">These start as sample answers. Change them to match you.</p>}
          <div className="space-y-4 mt-4">
            {data.inputs.map(input => {
              const fieldId = `${idPrefix}-${input.id}`;
              const helpId = input.helpText ? `${fieldId}-help` : undefined;
              const min = input.min ?? 0;
              const max = input.max ?? 100;
              const labelled = !!(input.minLabel || input.maxLabel);
              return (
                <div key={input.id}>
                  {input.type === 'checkbox' ? (
                    <label htmlFor={fieldId} className="flex items-center gap-2 text-row font-medium text-t2">
                      <input
                        id={fieldId}
                        type="checkbox"
                        checked={!!inputValues[input.id]}
                        onChange={e => setAnswer(input.id, e.target.checked)}
                        aria-describedby={helpId}
                        className="h-4 w-4 rounded border-b2 shrink-0"
                      />
                      {input.label}
                    </label>
                  ) : (
                    <label htmlFor={fieldId} className="block text-row font-medium text-t2 mb-1">{input.label}</label>
                  )}
                  {input.type === 'number' && (
                    <input
                      id={fieldId}
                      type="number"
                      value={Number(inputValues[input.id])}
                      min={input.min}
                      max={input.max}
                      step={input.step}
                      onChange={e => setAnswer(input.id, numberAnswer(input, Number(e.target.value)))}
                      aria-describedby={helpId}
                      className="w-full px-3 py-2 rounded-[8px] text-row"
                    />
                  )}
                  {input.type === 'range' && (
                    <div>
                      <input
                        id={fieldId}
                        type="range"
                        value={Number(inputValues[input.id])}
                        min={input.min}
                        max={input.max}
                        step={input.step}
                        onChange={e => setAnswer(input.id, Number(e.target.value))}
                        aria-describedby={helpId}
                        aria-valuetext={labelled
                          ? `${inputValues[input.id]} on a scale from ${min}${input.minLabel ? ` (${input.minLabel})` : ''} to ${max}${input.maxLabel ? ` (${input.maxLabel})` : ''}`
                          : undefined}
                        className="w-full"
                      />
                      {/* Both ends are printed, so a bare "3" has a scale to be read against. */}
                      <div className="flex items-baseline justify-between gap-3 text-meta text-t3 tnum">
                        <span className="flex-1">{input.minLabel ?? min}</span>
                        <span className="text-row font-semibold text-t1 whitespace-nowrap">
                          {labelled ? `${inputValues[input.id]} of ${max}` : String(inputValues[input.id])}
                        </span>
                        <span className="flex-1 text-right">{input.maxLabel ?? max}</span>
                      </div>
                    </div>
                  )}
                  {input.type === 'select' && input.options && (
                    <select
                      id={fieldId}
                      value={String(inputValues[input.id])}
                      onChange={e => setAnswer(input.id, e.target.value)}
                      aria-describedby={helpId}
                      className="w-full px-3 py-2 rounded-[8px] text-row"
                    >
                      {input.options.map(opt => (
                        <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
                      ))}
                    </select>
                  )}
                  {input.helpText && <p id={helpId} className="text-meta text-t3 mt-1">{input.helpText}</p>}
                </div>
              );
            })}
          </div>
        </div>

        <div>
          <div className="bg-s1 border border-b1 rounded-[12px] p-5 mb-6" data-calculator-result={!results ? 'unavailable' : touched ? 'yours' : 'example'}>
            <h2 className="font-mono text-h3 font-semibold text-t1">{resultHeading}</h2>
            {results && !touched && (
              <p className="text-meta text-t3 mt-1">Worked out from the sample answers, not yours. Change any setting to see your own.</p>
            )}
            {results ? (
              <div className="space-y-4 mt-4">
                {data.outputFields.map(field => {
                  // Only the field the legend describes gets a colour, and only
                  // once it is the visitor's own result: other numbers have no
                  // scale on the page to say whether high is good or bad.
                  const tone: Tone = field === legendField && activeBand ? activeBand.tone : 'neutral';
                  return (
                    <div key={field.id} className="bg-s0 border border-b1 rounded-lg p-4">
                      <div className="text-meta text-t3">{field.label}</div>
                      <div className={`text-2xl font-bold tnum ${touched ? TONE_TEXT[tone] : 'text-t2'}`}>
                        {formatValue(field, results[field.id])}
                      </div>
                      {field.description && <p className="text-meta text-t3 mt-1">{field.description}</p>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div role="status" className="mt-4 bg-s0 border border-b1 rounded-lg p-4">
                <p className="font-semibold text-t1">This calculator is unavailable</p>
                <p className="text-row text-t3 mt-1">
                  {touched
                    ? "It couldn't work out a result from these settings. Change one back, or reset to the example."
                    : "It can't work out a result at the moment. The tips and methodology below still apply."}
                </p>
              </div>
            )}
          </div>

          {interpretation && (
            <div className="border border-b1 rounded-[12px] p-5 bg-s0">
              <h3 className="font-mono text-h3 font-semibold text-t1 mb-3">
                {legendField ? `How to read the ${legendField.label}` : 'How to read your result'}
              </h3>
              <ul className="space-y-2">
                {interpretation.map((interp, i) => {
                  const active = activeBand?.index === i;
                  return (
                    <li key={i} className={`flex items-start gap-3 text-row rounded-md${active ? ' bg-s1 -mx-2 px-2 py-1' : ''}`}>
                      <span aria-hidden="true" className={`w-3 h-3 mt-1 rounded-full shrink-0 ${TONE_DOT[toneOf(interp.color)]}`} />
                      <span>
                        <span className="font-medium text-t1">{interp.range}:</span>{' '}
                        <span className="prose-ib text-row">{interp.label} &mdash; {interp.description}</span>
                        {active && <span className="ml-2 text-kicker uppercase text-t1 whitespace-nowrap">Your result</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>

      {data.educational.tips && data.educational.tips.length > 0 && (
        <details className="panel mt-10" open>
          <summary>
            <span>Tips for improvement</span>
            <Icon name="chevron" size={16} />
          </summary>
          <div className="panel-body grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.educational.tips.map((tip, i) => (
              <div key={i} className="flex items-start gap-2 bg-ok-dim border border-ok/30 rounded-lg p-4 text-row text-ok">
                <Icon name="star" size={14} className="mt-0.5 shrink-0" />
                <span>{tip}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {data.educational.methodology && (
        <section className="mt-8">
          <h3 className="text-kicker uppercase text-t3 mb-1">Methodology</h3>
          <p className="prose-ib text-row">{data.educational.methodology}</p>
        </section>
      )}

      <EditorialNote reviewed={(data as unknown as { reviewed?: boolean }).reviewed} />
    </article>
  );
}
