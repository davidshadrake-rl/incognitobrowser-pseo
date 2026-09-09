'use client';

import Link from 'next/link';
import { ToolPage } from '@/components/ToolPage';
import { renderToolEngine } from '@/components/tools/registry';
import { IS_PRO_DEPLOYMENT, FREE_BASE_URL } from '@/lib/tiers';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { ResultProvider } from '@/components/tools/ResultContext';
import { FunnelSurfaces } from '@/components/FunnelSurfaces';
import type { NextStepsData } from '@/components/NextSteps';

interface ToolData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  toolType: string;
  description: string;
  toolEngine?: string;
  /**
   * Where the work happens. Defaults to 'client'. The cookie/tracker
   * scanner is 'server' — it fetches the target URL through our API,
   * so claiming "client-side" on it would be a false privacy claim.
   */
  processing?: 'client' | 'server';
  /** 'pro' engines live on the Pro deployment only (clean split, 2026-09-08). */
  tier?: 'free' | 'pro';
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

export function ToolPageClient({ data, nicheName, nextSteps, proWebUrl }: { data: ToolData; nicheName: string; nextSteps?: NextStepsData | null; proWebUrl?: string }) {
  // If the tool has an engine, render the dedicated component
  if (data.toolEngine) {
    const engine = renderToolEngine(data.toolEngine);
    if (engine) {
      return (
        <ResultProvider>
        <article className="max-w-3xl mx-auto">
          <nav className="mb-6 flex items-center gap-2 text-sm text-t2">
            <Link href="/tools" className="hover:text-white transition-colors">Tools</Link>
            <span>/</span>
            <span className="text-white">{nicheName}</span>
          </nav>

          <header className="mb-8">
            <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
            <div className="flex flex-wrap items-center gap-1.5 mb-4">
              <Badge label={data.toolType} />
              <Badge variant={IS_PRO_DEPLOYMENT ? 'pro' : 'free'} />
              <Badge variant={data.processing === 'server' ? 'server' : 'client'} />
              {IS_PRO_DEPLOYMENT && (
                <a href={`${FREE_BASE_URL}/tools`} className="text-meta text-t2 hover:text-t1 underline underline-offset-4" title="The free privacy tools on the marketing site">← Free tools</a>
              )}
            </div>
            <p className="text-t2">{data.description}</p>
          </header>

          {/* Interactive tool */}
          <div className="mb-8">
            {engine}
          </div>

          {/* Result moment: CTA, shareable scorecard, what to do now */}
          <FunnelSurfaces engine={data.toolEngine} niche={data.niche} title={data.title} nextSteps={nextSteps} proWebUrl={proWebUrl} />

          {/* Educational content */}
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
        </ResultProvider>
      );
    }
  }

  // Fallback: use generic form-based ToolPage
  return (
    <ToolPage
      data={data}
      nicheName={nicheName}
      renderTool={() => (
        <div className="bg-s0 border border-b1 rounded-lg p-6 text-center text-t2">
          Tool analysis complete. For enhanced privacy protection, try Incognito Browser.
        </div>
      )}
    />
  );
}
