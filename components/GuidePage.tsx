'use client';

import { useState } from 'react';
import { Badge } from './ui/Badge';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { ArticleByline } from './ArticleByline';
import { CheckYoursNow } from './CheckYoursNow';
import type { ProofRoute } from '@/lib/proof-route';

interface GuideStep {
  stepNumber: number;
  title: string;
  description: string;
  actions: string[];
  proTip?: string;
  warning?: string;
}

interface FAQ {
  question: string;
  answer: string;
}

interface GuideData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  difficulty: string;
  estimatedTime: string;
  intro?: string;
  prerequisites: string[];
  steps: GuideStep[];
  faqs: FAQ[];
}

export function GuidePage({ data, nicheName, proofRoute }: { data: GuideData; nicheName: string; proofRoute?: ProofRoute | null }) {
  const [activeStep, setActiveStep] = useState(0);

  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Guides', href: '/guides' },
        { label: nicheName, href: `/guides/${data.niche}` },
        { label: data.title },
      ]} />

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
        <ArticleByline
          author={(data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author}
          editor={(data as unknown as { editor?: { name: string; profileUrl?: string } | null }).editor}
          reviewedAt={(data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt}
        />
        <div className="flex flex-wrap gap-2 mb-4">
          <Badge label={data.difficulty} variant={data.difficulty} />
          <Badge label={data.estimatedTime} />
          <Badge label={`${data.steps.length} steps`} />
        </div>
        {data.intro && <p className="text-[#B8B8D4]">{data.intro}</p>}
      </header>
      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      {data.prerequisites.length > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4 mb-8">
          <h2 className="font-semibold text-yellow-400 mb-2">Prerequisites</h2>
          <ul className="list-disc list-inside text-sm text-yellow-300 space-y-1">
            {data.prerequisites.map((p, i) => <li key={i}>{p}</li>)}
          </ul>
        </div>
      )}

      <div className="flex overflow-x-auto gap-2 mb-8 pb-2">
        {data.steps.map((step, i) => (
          <button
            key={i}
            onClick={() => setActiveStep(i)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeStep === i
                ? 'bg-white text-black'
                : 'border border-white/10 text-[#B8B8D4] hover:border-white/30'
            }`}
          >
            Step {step.stepNumber}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        {data.steps.map((step, i) => (
          <section
            key={i}
            id={`step-${step.stepNumber}`}
            className={`border rounded-lg p-6 transition-all ${
              activeStep === i ? 'border-white/30 bg-[#0a0a0a]' : 'border-white/10 bg-[#0a0a0a]'
            }`}
          >
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-white/30 text-white flex items-center justify-center font-bold">
                {step.stepNumber}
              </div>
              <div className="flex-1">
                <h3 className="text-lg font-semibold text-white mb-2">{step.title}</h3>
                <p className="text-[#B8B8D4] mb-4">{step.description}</p>

                {step.actions.length > 0 && (
                  <div className="bg-white/5 border border-white/10 rounded-lg p-4 mb-3">
                    <h4 className="text-sm font-medium text-white/70 mb-2">Actions:</h4>
                    <ol className="list-decimal list-inside text-sm text-[#B8B8D4] space-y-1">
                      {step.actions.map((action, ai) => <li key={ai}>{action}</li>)}
                    </ol>
                  </div>
                )}

                {step.proTip && (
                  <div className="bg-green-500/10 border-l-4 border-green-500 p-3 text-sm">
                    <strong className="text-green-400">Pro Tip:</strong>
                    <span className="text-green-300 ml-1">{step.proTip}</span>
                  </div>
                )}

                {step.warning && (
                  <div className="bg-red-500/10 border-l-4 border-red-500 p-3 text-sm mt-2">
                    <strong className="text-red-400">Warning:</strong>
                    <span className="text-red-300 ml-1">{step.warning}</span>
                  </div>
                )}
              </div>
            </div>
          </section>
        ))}
      </div>

      {data.faqs.length > 0 && (
        <section className="mt-12">
          <h2 className="text-2xl font-bold text-white mb-6">Frequently Asked Questions</h2>
          <div className="space-y-4">
            {data.faqs.map((faq, i) => (
              <details key={i} className="border border-white/10 rounded-lg bg-[#0a0a0a]">
                <summary className="p-4 font-medium text-white cursor-pointer hover:text-[#cfcfcf]">
                  {faq.question}
                </summary>
                <div className="px-4 pb-4 text-[#B8B8D4]">{faq.answer}</div>
              </details>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
