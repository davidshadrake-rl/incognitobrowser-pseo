'use client';

import { useState } from 'react';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { Icon } from './ui/Icon';
import { Badge, resolveBadgeVariant } from './ui/Badge';
import { EditorialNote } from './EditorialNote';
import { CheckYoursNow } from './CheckYoursNow';
import { TYPE_ICON, diagramForNiche } from '@/lib/visuals';
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

// Status is never colour-only: the Badge word is always present alongside
// the colour (DESIGN-SPEC 5.6 / 9). resolveBadgeVariant maps yes, excellent
// and good to ok, partial and fair to warn, and no and poor to danger.
const SCORE_LABEL: Record<FeatureScore['value'], string> = {
  yes: 'Yes', no: 'No', partial: 'Partial',
  excellent: 'Excellent', good: 'Good', fair: 'Fair', poor: 'Poor',
};

// Many tables mix two scales: "does it have it" and "how well".
const PRESENCE: FeatureScore['value'][] = ['yes', 'partial', 'no'];
const QUALITY: FeatureScore['value'][] = ['excellent', 'good', 'fair', 'poor'];

// A feature's score for one product. Most files key `scores` by product
// slug, but 13 key it by product name; looking up only the slug drew those
// 13 tables entirely as dashes.
function scoreFor(feature: Feature, product: Product): FeatureScore | undefined {
  return feature.scores[product.slug] ?? feature.scores[product.name];
}

export function ComparisonPage({ data, nicheName, proofRoute }: { data: ComparisonData; nicheName: string; proofRoute?: ProofRoute | null }) {
  const [sortBy, setSortBy] = useState<'rating' | 'name'>('rating');

  const sortedProducts = [...data.products].sort((a, b) =>
    sortBy === 'rating' ? b.rating - a.rating : a.name.localeCompare(b.name)
  );

  // Which kinds of cell this table uses, so its legend explains only those.
  const cells = data.features.flatMap(f => data.products.map(p => scoreFor(f, p)));
  const usesPresence = cells.some(c => c && PRESENCE.includes(c.value));
  const usesQuality = cells.some(c => c && QUALITY.includes(c.value));
  const hasGaps = cells.some(c => !c);

  return (
    <article className="max-w-5xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Comparisons', href: '/comparisons' },
        { label: nicheName, href: `/comparisons/${data.niche}` },
        { label: data.title },
      ]} />

      <PageHero
        icon={TYPE_ICON.comparison}
        kicker={`${nicheName} · comparison`}
        title={data.title}
        badges={
          <>
            <Badge label={`${data.products.length} compared`} />
            <Badge label={`${data.features.length} criteria`} />
          </>
        }
        figure={{ value: data.features.length, label: 'criteria' }}
        diagram={diagramForNiche(data.niche)}
      />

      <p className="prose-ib text-lede mb-8">{data.intro}</p>

      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      <section className="mb-10">
        {/* The order applies to these cards and to the table's columns below.
            It used to sit on the table header, where it read as if it would
            sort the feature rows. */}
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-mono text-h2 font-semibold text-t1">Products compared</h2>
          <div role="group" aria-label="Order the products" className="flex items-center gap-2">
            <span className="text-meta text-t3">Order:</span>
            <button type="button" aria-pressed={sortBy === 'rating'} onClick={() => setSortBy('rating')} className={sortBy === 'rating' ? 'btn-primary text-xs' : 'btn-ghost text-xs'}>Highest rated</button>
            <button type="button" aria-pressed={sortBy === 'name'} onClick={() => setSortBy('name')} className={sortBy === 'name' ? 'btn-primary text-xs' : 'btn-ghost text-xs'}>Name A–Z</button>
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedProducts.map((product) => (
            <div key={product.slug} className="border border-b1 rounded-lg p-5 bg-s0">
              <h3 className="font-semibold text-t1">{product.name}</h3>
              <p className="text-row text-t3 mt-1 mb-2">
                Our rating: <span className="text-lg font-bold text-t1 tnum">{product.rating}/10</span>
              </p>
              <p className="text-row text-t3 mb-3">{product.tagline}</p>
              {product.pricing && <p className="text-meta text-t3/70 mb-3">{product.pricing}</p>}
              <div className="space-y-2">
                <div>
                  <h4 className="text-meta font-medium text-ok uppercase">Pros</h4>
                  <ul className="text-row text-t2 space-y-1">
                    {product.pros.map((p, i) => <li key={i} className="flex items-start"><span className="text-ok mr-1">+</span>{p}</li>)}
                  </ul>
                </div>
                <div>
                  <h4 className="text-meta font-medium text-danger uppercase">Cons</h4>
                  <ul className="text-row text-t2 space-y-1">
                    {product.cons.map((c, i) => <li key={i} className="flex items-start"><span className="text-danger mr-1">-</span>{c}</li>)}
                  </ul>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="font-mono text-h2 font-semibold text-t1 mb-2">Feature comparison</h2>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-meta text-t3 mb-4" aria-label="How to read the table">
          {usesPresence && (
            <li className="flex flex-wrap items-center gap-1.5">
              {PRESENCE.map(v => <Badge key={v} variant={resolveBadgeVariant(v)} label={SCORE_LABEL[v]} />)}
              <span>whether it has the feature</span>
            </li>
          )}
          {usesQuality && (
            <li className="flex flex-wrap items-center gap-1.5">
              {QUALITY.map(v => <Badge key={v} variant={resolveBadgeVariant(v)} label={SCORE_LABEL[v]} />)}
              <span>how well it does it</span>
            </li>
          )}
          {hasGaps && (
            <li>
              <span aria-hidden="true"><span className="text-t1">—</span> = </span>
              <span className="sr-only">A dash means </span>not assessed
            </li>
          )}
        </ul>
        <div className="overflow-x-auto border border-b1 rounded-[12px]">
          <table className="w-full border-collapse">
            <thead className="bg-s1">
              <tr>
                <th className="text-left p-3 font-medium text-t2 text-row">Feature</th>
                {sortedProducts.map(p => (
                  <th key={p.slug} className="text-center p-3 font-medium text-t1 text-row">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.features.map((feature, i) => (
                <tr key={i} className="border-t border-hair hover:bg-s0">
                  <td className="p-3">
                    <div className="font-medium text-t1 text-row">{feature.name}</div>
                    <div className="text-meta text-t3">{feature.description}</div>
                  </td>
                  {sortedProducts.map(p => {
                    const score = scoreFor(feature, p);
                    return (
                      <td key={p.slug} className="text-center p-3">
                        {score ? (
                          <Badge variant={resolveBadgeVariant(score.value)} label={SCORE_LABEL[score.value]} />
                        ) : (
                          <span className="text-t3" title="Not assessed">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">Not assessed</span>
                          </span>
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

      <section className="bg-s0 border border-b1 rounded-[16px] p-6 mb-10">
        <h2 className="font-mono text-h2 font-semibold text-t1 mb-3">Verdict</h2>
        <p className="prose-ib text-[15px] mb-4">{data.verdict.summary}</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {data.verdict.bestFor.map((item, i) => (
            <div key={i} className="bg-black border border-hair rounded-lg p-4">
              <div className="text-meta text-t3">{item.useCase}</div>
              <div className="font-semibold text-t1">{item.product}</div>
              <div className="prose-ib text-row mt-1">{item.reason}</div>
            </div>
          ))}
        </div>
      </section>

      {data.faqs.length > 0 && (
        <section>
          <h2 className="font-mono text-h2 font-semibold text-t1 mb-6">FAQ</h2>
          <div className="space-y-0">
            {data.faqs.map((faq, i) => (
              <details key={i} className="panel">
                <summary>
                  <span>{faq.question}</span>
                  <Icon name="chevron" size={16} />
                </summary>
                <div className="panel-body prose-ib text-row">{faq.answer}</div>
              </details>
            ))}
          </div>
        </section>
      )}

      <EditorialNote reviewed={(data as unknown as { reviewed?: boolean }).reviewed} />
    </article>
  );
}
