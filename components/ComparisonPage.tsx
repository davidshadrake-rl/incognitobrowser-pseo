'use client';

import { useState } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { Icon, type IconName } from './ui/Icon';
import { ArticleByline } from './ArticleByline';
import { CheckYoursNow } from './CheckYoursNow';
import type { ProofRoute } from '@/lib/proof-route';

interface Product {
  name: string;
  slug: string;
  tagline: string;
  website?: string;
  pricing?: string;
  pros: string[];
  cons: string[];
  rating: number;
}

interface FeatureScore {
  value: 'yes' | 'no' | 'partial' | 'excellent' | 'good' | 'fair' | 'poor';
  note?: string;
}

interface Feature {
  name: string;
  description: string;
  scores: Record<string, FeatureScore>;
}

interface Verdict {
  summary: string;
  bestFor: Array<{ useCase: string; product: string; reason: string }>;
}

interface FAQ {
  question: string;
  answer: string;
}

interface ComparisonData {
  niche: string;
  slug: string;
  title: string;
  metaDescription: string;
  intro: string;
  products: Product[];
  features: Feature[];
  verdict: Verdict;
  faqs: FAQ[];
}

// Status is never colour-only: glyph + word (DESIGN-SPEC 3.3 / 9).
const scoreDisplay: Record<string, { label: string; color: string; icon?: IconName }> = {
  yes: { label: 'Yes', icon: 'check', color: 'text-ok bg-ok-dim' },
  no: { label: 'No', icon: 'x', color: 'text-danger bg-danger-dim' },
  partial: { label: 'Partial', color: 'text-warn bg-warn-dim' },
  excellent: { label: 'Excellent', color: 'text-ok bg-ok-dim' },
  good: { label: 'Good', color: 'text-info bg-info-dim' },
  fair: { label: 'Fair', color: 'text-warn bg-warn-dim' },
  poor: { label: 'Poor', color: 'text-danger bg-danger-dim' },
};

export function ComparisonPage({ data, nicheName, proofRoute }: { data: ComparisonData; nicheName: string; proofRoute?: ProofRoute | null }) {
  const [sortBy, setSortBy] = useState<'rating' | 'name'>('rating');

  const sortedProducts = [...data.products].sort((a, b) =>
    sortBy === 'rating' ? b.rating - a.rating : a.name.localeCompare(b.name)
  );

  return (
    <article className="max-w-5xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Comparisons', href: '/comparisons' },
        { label: nicheName, href: `/comparisons/${data.niche}` },
        { label: data.title },
      ]} />

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">{data.title}</h1>
        <ArticleByline
          author={(data as unknown as { author?: { name: string; profileUrl?: string; credentials?: string } | null }).author}
          editor={(data as unknown as { editor?: { name: string; profileUrl?: string } | null }).editor}
          reviewedAt={(data as unknown as { editorial?: { reviewedAt?: string | null } }).editorial?.reviewedAt}
        />
        <p className="text-t2">{data.intro}</p>
      </header>
      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {sortedProducts.map((product) => (
          <div key={product.slug} className="border border-b1 rounded-lg p-5 bg-s0">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-white">{product.name}</h3>
              <span className="text-lg font-bold text-white">{product.rating}/10</span>
            </div>
            <p className="text-sm text-t3 mb-3">{product.tagline}</p>
            {product.pricing && <p className="text-xs text-white/30 mb-3">{product.pricing}</p>}
            <div className="space-y-2">
              <div>
                <h4 className="text-xs font-medium text-ok uppercase">Pros</h4>
                <ul className="text-sm text-t2 space-y-1">
                  {product.pros.map((p, i) => <li key={i} className="flex items-start"><span className="text-ok mr-1">+</span>{p}</li>)}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-medium text-danger uppercase">Cons</h4>
                <ul className="text-sm text-t2 space-y-1">
                  {product.cons.map((c, i) => <li key={i} className="flex items-start"><span className="text-danger mr-1">-</span>{c}</li>)}
                </ul>
              </div>
            </div>
          </div>
        ))}
      </div>

      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-2xl font-bold text-white">Feature Comparison</h2>
          <div className="flex gap-2">
            <button onClick={() => setSortBy('rating')} className={`text-sm px-3 py-1 rounded-lg ${sortBy === 'rating' ? 'bg-white text-black' : 'text-t2 border border-b1'}`}>By Rating</button>
            <button onClick={() => setSortBy('name')} className={`text-sm px-3 py-1 rounded-lg ${sortBy === 'name' ? 'bg-white text-black' : 'text-t2 border border-b1'}`}>By Name</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-b1">
                <th className="text-left p-3 font-medium text-t2">Feature</th>
                {sortedProducts.map(p => (
                  <th key={p.slug} className="text-center p-3 font-medium text-white">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.features.map((feature, i) => (
                <tr key={i} className="border-b border-hair hover:bg-white/5">
                  <td className="p-3">
                    <div className="font-medium text-white text-sm">{feature.name}</div>
                    <div className="text-xs text-t3">{feature.description}</div>
                  </td>
                  {sortedProducts.map(p => {
                    const score = feature.scores[p.slug];
                    const display = score ? scoreDisplay[score.value] : null;
                    return (
                      <td key={p.slug} className="text-center p-3">
                        {display ? (
                          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-sm font-medium ${display.color}`}>{display.icon && <Icon name={display.icon} size={14} />}{display.label}</span>
                        ) : (
                          <span className="text-white/20">-</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-white/5 border border-b1 rounded-lg p-6 mb-10">
        <h2 className="text-xl font-bold text-white mb-3">Verdict</h2>
        <p className="text-t2 mb-4">{data.verdict.summary}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.verdict.bestFor.map((item, i) => (
            <div key={i} className="bg-s0 border border-b1 rounded-lg p-4">
              <div className="text-sm text-t3">{item.useCase}</div>
              <div className="font-semibold text-white">{item.product}</div>
              <div className="text-sm text-t2 mt-1">{item.reason}</div>
            </div>
          ))}
        </div>
      </section>

      {data.faqs.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold text-white mb-6">FAQ</h2>
          <div className="space-y-4">
            {data.faqs.map((faq, i) => (
              <details key={i} className="border border-b1 rounded-lg bg-s0">
                <summary className="p-4 font-medium text-white cursor-pointer hover:text-t2">{faq.question}</summary>
                <div className="px-4 pb-4 text-t2">{faq.answer}</div>
              </details>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
