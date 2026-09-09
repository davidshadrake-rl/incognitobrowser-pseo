'use client';

import { ToolPage } from '@/components/ToolPage';
import { renderToolEngine, ENGINE_META, ENGINE_CANONICAL } from '@/components/tools/registry';
import { IS_PRO_DEPLOYMENT, FREE_BASE_URL, type Tier } from '@/lib/tiers';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/Icon';
import { PageHero } from '@/components/ui/PageHero';
import { Diagram } from '@/components/ui/Diagram';
import { Breadcrumbs } from '@/components/ui/Breadcrumbs';
import { ResultProvider } from '@/components/tools/ResultContext';
import { FunnelSurfaces } from '@/components/FunnelSurfaces';
import { ENGINE_ICON, type Diagram as DiagramId, type Family } from '@/lib/visuals';
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

export function ToolPageClient({
  data,
  nicheName,
  niche,
  nextSteps,
  proWebUrl,
  diagram = 'tracking',
  family = 'trace',
  tier = 'free',
}: {
  data: ToolData;
  nicheName: string;
  /** The niche slug (page.tsx's own `niche` param) — used for the canonical-page dedupe check and hub links. */
  niche: string;
  nextSteps?: NextStepsData | null;
  proWebUrl?: string;
  diagram?: DiagramId;
  family?: Family;
  tier?: Tier;
}) {
  // If the tool has an engine, render the dedicated component
  if (data.toolEngine) {
    const engine = renderToolEngine(data.toolEngine);
    if (engine) {
      const meta = ENGINE_META[data.toolEngine];
      const canonical = ENGINE_CANONICAL[data.toolEngine];
      const isCanonicalPage = !!canonical && canonical.niche === niche && canonical.slug === data.slug;
      const tips = data.educational.tips ?? [];
      const mistakes = data.educational.commonMistakes ?? [];
      // Dedupe rule (DESIGN-SPEC section 7): most niche shells for an engine
      // share the exact same copy-pasted tips/mistakes as the engine's
      // canonical niche. Hide the redundant panel everywhere except the
      // canonical page itself, which always renders its own tips.
      const isDuplicateOfCanonical = !!meta && !isCanonicalPage && tips.join('') === meta.canonicalTips.join('');
      const showNotes = (tips.length > 0 || mistakes.length > 0) && !isDuplicateOfCanonical;
      const howItWorks = data.educational.howItWorks
        ? data.educational.howItWorks.replace(/^This tool /, '').replace(/^\w/, (c) => c.toUpperCase())
        : '';

      return (
        <ResultProvider>
        <article className="max-w-4xl mx-auto">
          <Breadcrumbs items={[
            { label: 'Tools', href: '/tools' },
            { label: nicheName, href: `/tools/${niche}` },
            { label: data.title },
          ]} />

          <PageHero
            icon={ENGINE_ICON[data.toolEngine] ?? 'hat'}
            kicker={`${nicheName} · ${data.toolType}`}
            title={data.title}
            description={data.description}
            badges={
              <>
                <Badge variant={tier === 'pro' ? 'pro' : 'free'} />
                <Badge variant={data.processing === 'server' ? 'server' : 'client'} />
              </>
            }
            action={IS_PRO_DEPLOYMENT ? (
              <a
                href={`${FREE_BASE_URL}/tools`}
                className="mt-3 inline-block text-meta text-t2 hover:text-t1 underline underline-offset-4"
                title="The free privacy tools on the marketing site"
              >
                ← Free tools on the main site
              </a>
            ) : undefined}
            figure={meta?.figure ?? undefined}
            figureFamily={tier === 'free' ? family : undefined}
            diagram={diagram}
            tier={tier}
          />

          {/* Interactive tool — the 8 heaviest engines wrap their own result
              markup in ConsoleFrame; the other 9 render their existing markup. */}
          <div className="mb-8">
            {engine}
          </div>

          {/* Result moment: CTA, shareable scorecard, what to do now */}
          <FunnelSurfaces engine={data.toolEngine} niche={niche} title={data.title} nextSteps={nextSteps} proWebUrl={proWebUrl} />

          {/* Numbered collapsed sections (DESIGN-SPEC 5.4, "Below the result") */}
          <div className="mt-10">
            <details className="panel">
              <summary>
                <span className="folio">01</span> How it works <Icon name="chevron" size={16} />
              </summary>
              <div className="panel-body">
                <div className="grid md:grid-cols-[1fr_200px] gap-6">
                  <div className="min-w-0">
                    {meta && (
                      <dl className="grid grid-cols-3 gap-3 mb-4">
                        <div>
                          <dt className="text-kicker uppercase text-t3 mb-1">Input</dt>
                          <dd className="text-row text-t2">{meta.io[0]}</dd>
                        </div>
                        <div>
                          <dt className="text-kicker uppercase text-t3 mb-1">Check</dt>
                          <dd className="text-row text-t2">{meta.io[1]}</dd>
                        </div>
                        <div>
                          <dt className="text-kicker uppercase text-t3 mb-1">Output</dt>
                          <dd className="text-row text-t2">{meta.io[2]}</dd>
                        </div>
                      </dl>
                    )}
                    {howItWorks && <p className="prose-ib">{howItWorks}</p>}
                  </div>
                  <div className="hidden md:block">
                    <Diagram id={diagram} pro={tier === 'pro'} />
                  </div>
                </div>
              </div>
            </details>

            {showNotes && (
              <details className="panel">
                <summary>
                  <span className="folio">02</span> Notes ({tips.length + mistakes.length}) <Icon name="chevron" size={16} />
                </summary>
                <div className="panel-body">
                  <ul className="space-y-2">
                    {tips.map((tip, i) => (
                      <li key={`tip-${i}`} className="flex items-start gap-2 prose-ib text-row">
                        <Icon name="check" size={16} className="text-ok mt-0.5 shrink-0" />
                        {tip}
                      </li>
                    ))}
                    {mistakes.map((mistake, i) => (
                      <li key={`mistake-${i}`} className="flex items-start gap-2 prose-ib text-row">
                        <Icon name="x" size={16} className="text-danger mt-0.5 shrink-0" />
                        {mistake}
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            )}

            {meta?.scoring && (
              <details className="panel">
                <summary>
                  <span className="folio">03</span> Scoring <Icon name="chevron" size={16} />
                </summary>
                <div className="panel-body">
                  <p className="prose-ib text-row">{meta.scoring}</p>
                </div>
              </details>
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
