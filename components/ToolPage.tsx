'use client';

import { useState } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { Badge } from './ui/Badge';
import { Icon } from './ui/Icon';
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

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
        <ArticleByline
          author={(data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author}
          editor={(data as unknown as { editor?: { name: string; profileUrl?: string } | null }).editor}
          reviewedAt={(data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt}
        />
        <div className="flex flex-wrap items-center gap-1.5 mb-4">
          <Badge label={data.toolType} />
          <Badge variant="free" />
        </div>
        <p className="text-t2">{data.description}</p>
      </header>

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

      <div className="space-y-6">
        {data.educational.howItWorks && (
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">How This Tool Works</h2>
            <p className="text-t2">{data.educational.howItWorks}</p>
          </section>
        )}

        {data.educational.tips && data.educational.tips.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Tips</h2>
            <ul className="space-y-2">
              {data.educational.tips.map((tip, i) => (
                <li key={i} className="flex items-start text-sm text-t2">
                  <Icon name="check" size={16} className="text-ok mr-2 mt-0.5" />
                  {tip}
                </li>
              ))}
            </ul>
          </section>
        )}

        {data.educational.commonMistakes && data.educational.commonMistakes.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Common Mistakes to Avoid</h2>
            <ul className="space-y-2">
              {data.educational.commonMistakes.map((mistake, i) => (
                <li key={i} className="flex items-start text-sm text-t2">
                  <Icon name="x" size={16} className="text-danger mr-2 mt-0.5" />
                  {mistake}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </article>
  );
}
