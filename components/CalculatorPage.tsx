'use client';

import { useState, useMemo } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { Badge } from './ui/Badge';
import { ArticleByline } from './ArticleByline';
import { CheckYoursNow } from './CheckYoursNow';
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

export function CalculatorPage({ data, nicheName, proofRoute }: { data: CalculatorData; nicheName: string; proofRoute?: ProofRoute | null }) {
  const [inputValues, setInputValues] = useState<Record<string, number | string | boolean>>(
    Object.fromEntries(data.inputs.map(i => [i.id, i.defaultValue]))
  );

  const results = useMemo(() => {
    try {
      const fn = new Function('inputs', data.formula);
      return fn(inputValues) as Record<string, number | string>;
    } catch {
      return {} as Record<string, number | string>;
    }
  }, [inputValues, data.formula]);

  const formatValue = (field: OutputField, value: number | string) => {
    if (value === undefined || value === null) return '-';
    switch (field.format) {
      case 'percentage': return `${Number(value).toFixed(1)}%`;
      case 'score': return `${Number(value).toFixed(0)}/100`;
      case 'currency': return `$${Number(value).toLocaleString()}`;
      case 'number': return Number(value).toLocaleString();
      default: return String(value);
    }
  };

  const getScoreColor = (value: number) => {
    if (value >= 80) return 'text-danger';
    if (value >= 60) return 'text-warn';
    if (value >= 40) return 'text-info';
    return 'text-ok';
  };

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
            <Badge label={`${data.inputs.length} inputs`} />
            <Badge label={`${data.outputFields.length} results`} />
          </>
        }
        action={
          <ArticleByline
            author={(data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author}
            reviewed={(data as unknown as { reviewed?: boolean }).reviewed}
            reviewedAt={(data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt}
          />
        }
        diagram={diagramForNiche(data.niche)}
      />

      <p className="prose-ib text-lede mb-8">{data.description}</p>

      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-s0 border border-b1 rounded-[12px] p-5">
          <h2 className="font-mono text-h3 font-semibold text-t1 mb-4">Your settings</h2>
          <div className="space-y-4">
            {data.inputs.map(input => (
              <div key={input.id}>
                <label className="block text-row font-medium text-t2 mb-1">{input.label}</label>
                {input.type === 'number' && (
                  <input
                    type="number"
                    value={Number(inputValues[input.id])}
                    min={input.min}
                    max={input.max}
                    step={input.step}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: Number(e.target.value) })}
                    className="w-full px-3 py-2 rounded-[8px] text-row"
                  />
                )}
                {input.type === 'range' && (
                  <div>
                    <input
                      type="range"
                      value={Number(inputValues[input.id])}
                      min={input.min}
                      max={input.max}
                      step={input.step}
                      onChange={e => setInputValues({ ...inputValues, [input.id]: Number(e.target.value) })}
                      className="w-full"
                    />
                    <div className="text-row text-t2 text-center tnum">{String(inputValues[input.id])}</div>
                  </div>
                )}
                {input.type === 'select' && input.options && (
                  <select
                    value={String(inputValues[input.id])}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                    className="w-full px-3 py-2 rounded-[8px] text-row"
                  >
                    {input.options.map(opt => (
                      <option key={String(opt.value)} value={String(opt.value)}>{opt.label}</option>
                    ))}
                  </select>
                )}
                {input.type === 'checkbox' && (
                  <input
                    type="checkbox"
                    checked={!!inputValues[input.id]}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.checked })}
                    className="h-4 w-4 rounded border-b2"
                  />
                )}
                {input.helpText && <p className="text-meta text-t3 mt-1">{input.helpText}</p>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="bg-s1 border border-b1 rounded-[12px] p-5 mb-6">
            <h2 className="font-mono text-h3 font-semibold text-t1 mb-4">Results</h2>
            <div className="space-y-4">
              {data.outputFields.map(field => (
                <div key={field.id} className="bg-s0 border border-b1 rounded-lg p-4">
                  <div className="text-meta text-t3">{field.label}</div>
                  <div className={`text-2xl font-bold tnum ${
                    field.format === 'score' ? getScoreColor(Number(results[field.id])) : 'text-t1'
                  }`}>
                    {formatValue(field, results[field.id])}
                  </div>
                  {field.description && <p className="text-meta text-t3 mt-1">{field.description}</p>}
                </div>
              ))}
            </div>
          </div>

          {data.educational.interpretation && (
            <div className="border border-b1 rounded-[12px] p-5 bg-s0">
              <h3 className="font-mono text-h3 font-semibold text-t1 mb-3">How to read your score</h3>
              <div className="space-y-2">
                {data.educational.interpretation.map((interp, i) => (
                  <div key={i} className="flex items-center gap-3 text-row">
                    <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: interp.color }} />
                    <span className="font-medium text-t1">{interp.range}:</span>
                    <span className="prose-ib text-row">{interp.label} &mdash; {interp.description}</span>
                  </div>
                ))}
              </div>
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
    </article>
  );
}
