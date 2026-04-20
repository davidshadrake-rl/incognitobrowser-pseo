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

// Escape a string for use in a RegExp.
function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Human-readable label for an auto-synthesized placeholder: "YOUR_NAME" -> "Your Name".
function prettifyKey(key: string) {
  return key
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TemplatePage({ data, nicheName }: { data: TemplateData; nicheName: string }) {
  // Start with whatever the JSON declared, de-duplicated by key.
  const declared = new Map(
    data.sections.flatMap(s => s.placeholders || []).map(p => [p.key, p])
  );

  // Scan every section's content for [TOKEN] references and synthesize a
  // placeholder for any that weren't declared. This makes the UI resilient
  // to content-generation bugs where a template body mentions [RECIPIENT_NAME]
  // but the placeholders array omits it — otherwise the user sees the raw
  // bracket token with no input to fill.
  for (const section of data.sections) {
    const tokens = section.content.match(/\[[A-Z_][A-Z0-9_]*\]/g) || [];
    for (const token of tokens) {
      const key = token.slice(1, -1);
      if (!declared.has(key)) {
        declared.set(key, {
          key,
          label: prettifyKey(key),
          defaultValue: '',
        });
      }
    }
  }

  const uniquePlaceholders = Array.from(declared.values());

  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(uniquePlaceholders.map(p => [p.key, p.defaultValue]))
  );
  const [copied, setCopied] = useState(false);

  // Template content uses [KEY] bracket syntax (not {{KEY}}).
  // Replace every occurrence with the user-supplied value, falling back to the
  // original bracket token so un-edited spots remain visually marked.
  const fillTemplate = (content: string) => {
    let result = content;
    for (const [key, value] of Object.entries(values)) {
      const pattern = new RegExp(`\\[${escapeRegExp(key)}\\]`, 'g');
      result = result.replace(pattern, value || `[${key}]`);
    }
    return result;
  };

  const getFullText = () => {
    return data.sections.map(s => `${s.heading}\n\n${fillTemplate(s.content)}`).join('\n\n---\n\n');
  };

  const handleCopy = async () => {
    const text = getFullText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for non-secure contexts or older browsers
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Permission denied or API unavailable — silently no-op the success state
    }
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

      {uniquePlaceholders.length > 0 && (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-5 mb-8">
          <h2 className="font-semibold text-white mb-3">Customize Your Template</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {uniquePlaceholders.map(p => (
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
