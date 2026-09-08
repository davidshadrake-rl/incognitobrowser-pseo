'use client';

import { useState, useMemo } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { ArticleByline } from './ArticleByline';
import { CheckYoursNow } from './CheckYoursNow';
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
    if (value >= 80) return 'text-red-400';
    if (value >= 60) return 'text-yellow-400';
    if (value >= 40) return 'text-blue-400';
    return 'text-green-400';
  };

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Calculators', href: '/calculators' },
        { label: nicheName, href: `/calculators/${data.niche}` },
        { label: data.title },
      ]} />

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
        <ArticleByline
          author={(data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author}
          editor={(data as unknown as { editor?: { name: string; profileUrl?: string } | null }).editor}
          reviewedAt={(data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt}
        />
        <p className="text-[#B8B8D4]">{data.description}</p>
      </header>
      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-5">
          <h2 className="font-semibold text-white mb-4">Your Settings</h2>
          <div className="space-y-4">
            {data.inputs.map(input => (
              <div key={input.id}>
                <label className="block text-sm font-medium text-[#B8B8D4] mb-1">{input.label}</label>
                {input.type === 'number' && (
                  <input
                    type="number"
                    value={Number(inputValues[input.id])}
                    min={input.min}
                    max={input.max}
                    step={input.step}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: Number(e.target.value) })}
                    className="w-full px-3 py-2 bg-[#191b1c] border border-white/10 rounded-md text-sm text-white"
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
                    <div className="text-sm text-[#B8B8D4] text-center">{String(inputValues[input.id])}</div>
                  </div>
                )}
                {input.type === 'select' && input.options && (
                  <select
                    value={String(inputValues[input.id])}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                    className="w-full px-3 py-2 bg-[#191b1c] border border-white/10 rounded-md text-sm text-white"
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
                    className="h-4 w-4 rounded border-white/30"
                  />
                )}
                {input.helpText && <p className="text-xs text-[#B8B8D4]/60 mt-1">{input.helpText}</p>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="bg-white/5 border border-white/10 rounded-lg p-5 mb-6">
            <h2 className="font-semibold text-white mb-4">Results</h2>
            <div className="space-y-4">
              {data.outputFields.map(field => (
                <div key={field.id} className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
                  <div className="text-sm text-[#B8B8D4]/60">{field.label}</div>
                  <div className={`text-2xl font-bold ${
                    field.format === 'score' ? getScoreColor(Number(results[field.id])) : 'text-white'
                  }`}>
                    {formatValue(field, results[field.id])}
                  </div>
                  {field.description && <p className="text-xs text-[#B8B8D4]/60 mt-1">{field.description}</p>}
                </div>
              ))}
            </div>
          </div>

          {data.educational.interpretation && (
            <div className="border border-white/10 rounded-lg p-5 bg-[#0a0a0a]">
              <h3 className="font-semibold text-white mb-3">How to Read Your Score</h3>
              <div className="space-y-2">
                {data.educational.interpretation.map((interp, i) => (
                  <div key={i} className="flex items-center gap-3 text-sm">
                    <div className="w-3 h-3 rounded-full" style={{ backgroundColor: interp.color }} />
                    <span className="font-medium text-white">{interp.range}:</span>
                    <span className="text-[#B8B8D4]">{interp.label} &mdash; {interp.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {data.educational.tips && data.educational.tips.length > 0 && (
        <section className="mt-10">
          <h2 className="text-xl font-semibold text-white mb-4">Tips for Improvement</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {data.educational.tips.map((tip, i) => (
              <div key={i} className="bg-green-500/10 border border-green-500/20 rounded-lg p-4 text-sm text-green-300">
                {tip}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.educational.methodology && (
        <section className="mt-8 text-sm text-[#B8B8D4]/60">
          <h3 className="font-medium text-white/70 mb-1">Methodology</h3>
          <p>{data.educational.methodology}</p>
        </section>
      )}
    </article>
  );
}
