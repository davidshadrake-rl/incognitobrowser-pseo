'use client';

import { useState } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { Badge } from './ui/Badge';
import { Icon } from './ui/Icon';
import { PageHero } from './ui/PageHero';
import { ArticleByline } from './ArticleByline';

interface ToolInput {
  id: string;
  label: string;
  type: 'text' | 'url' | 'email' | 'textarea' | 'select' | 'number';
  placeholder: string;
  options?: Array<{ value: string; label: string }>;
  validation?: string;
}

interface ToolData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  description: string;
  inputs: ToolInput[];
  educational: {
    howItWorks?: string;
    tips?: string[];
    commonMistakes?: string[];
  };
}

interface ToolPageProps {
  data: ToolData;
  nicheName: string;
  renderTool: (inputs: Record<string, string>) => React.ReactNode;
}

export function ToolPage({ data, nicheName, renderTool }: ToolPageProps) {
  const [inputValues, setInputValues] = useState<Record<string, string>>(
    Object.fromEntries(data.inputs.map(i => [i.id, '']))
  );
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Tools', href: '/tools' },
        { label: nicheName, href: `/tools/${data.niche}` },
        { label: data.title },
      ]} />

      <PageHero
        icon="hat"
        kicker={`${nicheName} · ${data.toolType}`}
        title={data.title}
        description={data.description}
        badges={
          <>
            <Badge label={data.toolType} />
            <Badge variant="free" />
          </>
        }
        action={
          <ArticleByline
            author={(data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author}
            editor={(data as unknown as { editor?: { name: string; profileUrl?: string } | null }).editor}
            reviewedAt={(data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt}
          />
        }
      />

      <form onSubmit={handleSubmit} className="bg-s0 border border-b1 rounded-lg p-6 mb-8">
        <div className="space-y-4">
          {data.inputs.map(input => {
            // Tighten mobile keyboard + autofill behavior based on input type.
            const isUrl = input.type === 'url';
            const isEmail = input.type === 'email';
            const extraProps =
              isUrl || isEmail
                ? { autoCapitalize: 'none' as const, autoCorrect: 'off', spellCheck: false, autoComplete: isUrl ? 'url' : 'email', inputMode: isUrl ? ('url' as const) : ('email' as const) }
                : {};
            return (
              <div key={input.id}>
                <label htmlFor={input.id} className="block text-sm font-medium text-t2 mb-1">
                  {input.label}
                </label>
                {input.type === 'textarea' ? (
                  <textarea
                    id={input.id}
                    name={input.id}
                    value={inputValues[input.id]}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                    placeholder={input.placeholder}
                    rows={4}
                    className="w-full px-3 py-2 bg-s0 border border-b1 rounded-md text-sm text-white placeholder-white/20"
                  />
                ) : input.type === 'select' && input.options ? (
                  <select
                    id={input.id}
                    name={input.id}
                    value={inputValues[input.id]}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                    className="w-full px-3 py-2 bg-s0 border border-b1 rounded-md text-sm text-white"
                  >
                    <option value="">Select...</option>
                    {input.options.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={input.id}
                    name={input.id}
                    type={input.type}
                    value={inputValues[input.id]}
                    onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                    placeholder={input.placeholder}
                    className="w-full px-3 py-2 bg-s0 border border-b1 rounded-md text-sm text-white placeholder-white/20"
                    {...extraProps}
                  />
                )}
              </div>
            );
          })}
          <button type="submit" className="btn-primary w-full py-3">
            Analyze
          </button>
        </div>
      </form>

      {submitted && <div className="mb-8">{renderTool(inputValues)}</div>}

      <div>
        {data.educational.howItWorks && (
          <details className="panel">
            <summary>
              <span className="folio">01</span> How it works <Icon name="chevron" size={16} />
            </summary>
            <div className="panel-body">
              <p className="prose-ib">{data.educational.howItWorks.replace(/^This tool /, '').replace(/^\w/, (c) => c.toUpperCase())}</p>
            </div>
          </details>
        )}

        {((data.educational.tips && data.educational.tips.length > 0) || (data.educational.commonMistakes && data.educational.commonMistakes.length > 0)) && (
          <details className="panel">
            <summary>
              <span className="folio">02</span> Notes ({(data.educational.tips?.length ?? 0) + (data.educational.commonMistakes?.length ?? 0)}) <Icon name="chevron" size={16} />
            </summary>
            <div className="panel-body">
              <ul className="space-y-2">
                {data.educational.tips?.map((tip, i) => (
                  <li key={`tip-${i}`} className="flex items-start gap-2 prose-ib text-row">
                    <Icon name="check" size={16} className="text-ok mt-0.5 shrink-0" />
                    {tip}
                  </li>
                ))}
                {data.educational.commonMistakes?.map((mistake, i) => (
                  <li key={`mistake-${i}`} className="flex items-start gap-2 prose-ib text-row">
                    <Icon name="x" size={16} className="text-danger mt-0.5 shrink-0" />
                    {mistake}
                  </li>
                ))}
              </ul>
            </div>
          </details>
        )}
      </div>
    </article>
  );
}
