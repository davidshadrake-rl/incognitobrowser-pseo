'use client';

import Link from 'next/link';
import { ToolPage } from '@/components/ToolPage';
import { renderToolEngine } from '@/components/tools/registry';

interface ToolData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  description: string;
  toolEngine?: string;
  inputs: Array<{
    id: string;
    label: string;
    type: 'text' | 'url' | 'email' | 'textarea' | 'select' | 'number';
    placeholder: string;
    options?: Array<{ value: string; label: string }>;
  }>;
  educational: {
    howItWorks?: string;
    tips?: string[];
    commonMistakes?: string[];
  };
}

export function ToolPageClient({ data, nicheName }: { data: ToolData; nicheName: string }) {
  // If the tool has an engine, render the dedicated component
  if (data.toolEngine) {
    const engine = renderToolEngine(data.toolEngine);
    if (engine) {
      return (
        <article className="max-w-3xl mx-auto">
          <nav className="mb-6 flex items-center gap-2 text-sm text-[#B8B8D4]">
            <Link href="/tools" className="hover:text-white transition-colors">Tools</Link>
            <span>/</span>
            <span className="text-white">{nicheName}</span>
          </nav>

          <header className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
            <div className="flex flex-wrap gap-2 mb-4">
              <span className="px-2 py-0.5 bg-white/10 rounded text-xs text-[#B8B8D4]">{data.toolType}</span>
              <span className="px-2 py-0.5 bg-green-500/10 rounded text-xs text-green-400">Free</span>
              <span className="px-2 py-0.5 bg-blue-500/10 rounded text-xs text-blue-400">Client-side</span>
            </div>
            <p className="text-[#B8B8D4]">{data.description}</p>
          </header>

          {/* Interactive tool */}
          <div className="mb-8">
            {engine}
          </div>

          {/* Educational content */}
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
  }

  // Fallback: use generic form-based ToolPage
  return (
    <ToolPage
      data={data}
      nicheName={nicheName}
      renderTool={() => (
        <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-6 text-center text-[#B8B8D4]">
          Tool analysis complete. For enhanced privacy protection, try Incognito Browser.
        </div>
      )}
    />
  );
}
