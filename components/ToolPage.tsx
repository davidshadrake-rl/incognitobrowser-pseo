'use client';

import { useState } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { Badge } from './ui/Badge';

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
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge label={data.toolType} />
          <Badge label="Free" variant="yes" />
        </div>
        <p className="text-[#B8B8D4]">{data.description}</p>
      </header>

      <form onSubmit={handleSubmit} className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 mb-8">
        <div className="space-y-4">
          {data.inputs.map(input => (
            <div key={input.id}>
              <label className="block text-sm font-medium text-[#B8B8D4] mb-1">{input.label}</label>
              {input.type === 'textarea' ? (
                <textarea
                  value={inputValues[input.id]}
                  onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                  placeholder={input.placeholder}
                  rows={4}
                  className="w-full px-3 py-2 bg-[#191b1c] border border-white/10 rounded-md text-sm text-white placeholder-white/20"
                />
              ) : input.type === 'select' && input.options ? (
                <select
                  value={inputValues[input.id]}
                  onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                  className="w-full px-3 py-2 bg-[#191b1c] border border-white/10 rounded-md text-sm text-white"
                >
                  <option value="">Select...</option>
                  {input.options.map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              ) : (
                <input
                  type={input.type}
                  value={inputValues[input.id]}
                  onChange={e => setInputValues({ ...inputValues, [input.id]: e.target.value })}
                  placeholder={input.placeholder}
                  className="w-full px-3 py-2 bg-[#191b1c] border border-white/10 rounded-md text-sm text-white placeholder-white/20"
                />
              )}
            </div>
          ))}
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
            <p className="text-[#B8B8D4]">{data.educational.howItWorks}</p>
          </section>
        )}

        {data.educational.tips && data.educational.tips.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-white mb-3">Tips</h2>
            <ul className="space-y-2">
              {data.educational.tips.map((tip, i) => (
                <li key={i} className="flex items-start text-sm text-[#B8B8D4]">
                  <span className="text-green-400 mr-2">&#10003;</span>
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
                <li key={i} className="flex items-start text-sm text-[#B8B8D4]">
                  <span className="text-red-400 mr-2">&#10007;</span>
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
