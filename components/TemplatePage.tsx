'use client';

import { useState } from 'react';
import { Badge } from './ui/Badge';
import { Breadcrumbs } from './ui/Breadcrumbs';

interface Placeholder {
  key: string;
  label: string;
  defaultValue: string;
}

interface TemplateSection {
  heading: string;
  content: string;
  placeholders?: Placeholder[];
}

interface TemplateData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  description: string;
  templateType: string;
  sections: TemplateSection[];
  useCases: string[];
}

export function TemplatePage({ data, nicheName }: { data: TemplateData; nicheName: string }) {
  const allPlaceholders = data.sections.flatMap(s => s.placeholders || []);
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(allPlaceholders.map(p => [p.key, p.defaultValue]))
  );
  const [copied, setCopied] = useState(false);

  const fillTemplate = (content: string) => {
    let result = content;
    for (const [key, value] of Object.entries(values)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value || `[${key}]`);
    }
    return result;
  };

  const getFullText = () => {
    return data.sections.map(s => `${s.heading}\n\n${fillTemplate(s.content)}`).join('\n\n---\n\n');
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(getFullText());
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Templates', href: '/templates' },
        { label: nicheName, href: `/templates/${data.niche}` },
        { label: data.title },
      ]} />

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge label={data.templateType} />
        </div>
        <p className="text-[#B8B8D4]">{data.description}</p>
      </header>

      {allPlaceholders.length > 0 && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-5 mb-8">
          <h2 className="font-semibold text-white mb-3">Customize Your Template</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {allPlaceholders.map(p => (
              <div key={p.key}>
                <label className="block text-sm font-medium text-[#B8B8D4] mb-1">{p.label}</label>
                <input
                  type="text"
                  value={values[p.key] || ''}
                  onChange={(e) => setValues({ ...values, [p.key]: e.target.value })}
                  placeholder={p.defaultValue}
                  className="w-full px-3 py-2 bg-[#191b1c] border border-white/10 rounded-md text-sm text-white"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xl font-semibold text-white">Template Preview</h2>
          <button onClick={handleCopy} className="btn-primary text-xs">
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
        <div className="border border-white/10 rounded-lg divide-y divide-white/10 bg-[#0a0a0a]">
          {data.sections.map((section, i) => (
            <div key={i} className="p-5">
              <h3 className="font-semibold text-white mb-2">{section.heading}</h3>
              <div className="text-[#B8B8D4] whitespace-pre-wrap text-sm leading-relaxed">
                {fillTemplate(section.content)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {data.useCases.length > 0 && (
        <section className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-5">
          <h2 className="font-semibold text-blue-400 mb-3">When to Use This Template</h2>
          <ul className="space-y-2">
            {data.useCases.map((uc, i) => (
              <li key={i} className="flex items-start text-sm text-blue-300">
                <span className="mr-2">&#8226;</span>
                {uc}
              </li>
            ))}
          </ul>
        </section>
      )}
    </article>
  );
}
