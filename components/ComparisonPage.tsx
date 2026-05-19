'use client';

import { useState } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { ArticleByline } from './ArticleByline';

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

const scoreDisplay: Record<string, { label: string; color: string }> = {
  yes: { label: '\u2713', color: 'text-green-400 bg-green-500/15' },
  no: { label: '\u2717', color: 'text-red-400 bg-red-500/15' },
  partial: { label: '~', color: 'text-yellow-400 bg-yellow-500/15' },
  excellent: { label: 'Excellent', color: 'text-green-400 bg-green-500/15' },
  good: { label: 'Good', color: 'text-blue-400 bg-blue-500/15' },
  fair: { label: 'Fair', color: 'text-yellow-400 bg-yellow-500/15' },
  poor: { label: 'Poor', color: 'text-red-400 bg-red-500/15' },
};

export function ComparisonPage({ data, nicheName }: { data: ComparisonData; nicheName: string }) {
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
        <p className="text-[#B8B8D4]">{data.intro}</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-10">
        {sortedProducts.map((product) => (
          <div key={product.slug} className="border border-white/10 rounded-lg p-5 bg-[#0a0a0a]">
            <div className="flex items-start justify-between mb-2">
              <h3 className="font-semibold text-white">{product.name}</h3>
              <span className="text-lg font-bold text-white">{product.rating}/10</span>
            </div>
            <p className="text-sm text-[#B8B8D4]/70 mb-3">{product.tagline}</p>
            {product.pricing && <p className="text-xs text-white/30 mb-3">{product.pricing}</p>}
            <div className="space-y-2">
              <div>
                <h4 className="text-xs font-medium text-green-400 uppercase">Pros</h4>
                <ul className="text-sm text-[#B8B8D4] space-y-1">
                  {product.pros.map((p, i) => <li key={i} className="flex items-start"><span className="text-green-400 mr-1">+</span>{p}</li>)}
                </ul>
              </div>
              <div>
                <h4 className="text-xs font-medium text-red-400 uppercase">Cons</h4>
                <ul className="text-sm text-[#B8B8D4] space-y-1">
                  {product.cons.map((c, i) => <li key={i} className="flex items-start"><span className="text-red-400 mr-1">-</span>{c}</li>)}
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
            <button onClick={() => setSortBy('rating')} className={`text-sm px-3 py-1 rounded-full ${sortBy === 'rating' ? 'bg-white text-black' : 'text-[#B8B8D4] border border-white/10'}`}>By Rating</button>
            <button onClick={() => setSortBy('name')} className={`text-sm px-3 py-1 rounded-full ${sortBy === 'name' ? 'bg-white text-black' : 'text-[#B8B8D4] border border-white/10'}`}>By Name</button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-white/10">
                <th className="text-left p-3 font-medium text-[#B8B8D4]">Feature</th>
                {sortedProducts.map(p => (
                  <th key={p.slug} className="text-center p-3 font-medium text-white">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.features.map((feature, i) => (
                <tr key={i} className="border-b border-white/5 hover:bg-white/5">
                  <td className="p-3">
                    <div className="font-medium text-white text-sm">{feature.name}</div>
                    <div className="text-xs text-[#B8B8D4]/60">{feature.description}</div>
                  </td>
                  {sortedProducts.map(p => {
                    const score = feature.scores[p.slug];
                    const display = score ? scoreDisplay[score.value] : null;
                    return (
                      <td key={p.slug} className="text-center p-3">
                        {display ? (
                          <span className={`inline-block px-2 py-1 rounded text-sm font-medium ${display.color}`}>{display.label}</span>
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

      <section className="bg-white/5 border border-white/10 rounded-lg p-6 mb-10">
        <h2 className="text-xl font-bold text-white mb-3">Verdict</h2>
        <p className="text-[#B8B8D4] mb-4">{data.verdict.summary}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.verdict.bestFor.map((item, i) => (
            <div key={i} className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4">
              <div className="text-sm text-[#B8B8D4]/60">{item.useCase}</div>
              <div className="font-semibold text-white">{item.product}</div>
              <div className="text-sm text-[#B8B8D4] mt-1">{item.reason}</div>
            </div>
          ))}
        </div>
      </section>

      {data.faqs.length > 0 && (
        <section>
          <h2 className="text-2xl font-bold text-white mb-6">FAQ</h2>
          <div className="space-y-4">
            {data.faqs.map((faq, i) => (
              <details key={i} className="border border-white/10 rounded-lg bg-[#0a0a0a]">
                <summary className="p-4 font-medium text-white cursor-pointer hover:text-[#cfcfcf]">{faq.question}</summary>
                <div className="px-4 pb-4 text-[#B8B8D4]">{faq.answer}</div>
              </details>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
