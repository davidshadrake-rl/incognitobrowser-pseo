'use client';

/**
 * A comparison page. Every rating on it is worked out by lib/comparison-score.ts
 * from the feature table it renders; a rating typed into the data is never
 * read (toComparisonView drops it before it gets here).
 *
 * Pages that include Incognito Browser say, right under the hero, that we
 * make it, and link the rubric (owner decision, 2026-09-10). Under the table
 * they also say that its No can mean a feature isn't documented: an unbacked
 * criterion is No for it, not a dash, and cell notes aren't shown.
 *
 * Client component: every prop ships in the page's HTML, so it takes a
 * ComparisonView (only what it renders) and a `reviewed` boolean, never an
 * author or editor object.
 */
import { useState } from 'react';
import Link from 'next/link';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { Icon } from './ui/Icon';
import { Badge, type BadgeVariant } from './ui/Badge';
import { EditorialNote } from './EditorialNote';
import { CheckYoursNow } from './CheckYoursNow';
import { TYPE_ICON, diagramForNiche } from '@/lib/visuals';
import type { ProofRoute } from '@/lib/proof-route';
import {
  CELL_LABEL,
  METHODOLOGY_PATH,
  OUR_PRODUCT_SLUG,
  POINTS,
  cellFor,
  compareByName,
  formatRating,
  includesOurProduct,
  readCell,
  scoreProducts,
  type ComparisonView,
  type RatedValue,
} from '@/lib/comparison-score';

// Many tables mix two scales: "does it have it" and "how well". Limited and
// None belong to the first; they join its legend only on tables that use them.
const PRESENCE: RatedValue[] = ['yes', 'partial', 'limited', 'no', 'none'];
const PRESENCE_ALWAYS: RatedValue[] = ['yes', 'partial', 'no'];
const QUALITY: RatedValue[] = ['excellent', 'good', 'fair', 'poor'];

// Status is never colour-only: the Badge word is always present alongside
// the colour (DESIGN-SPEC 5.6 / 9). The colour follows the points, so a
// value worth 0.75 or more is ok, 0.5 is warn, and 0.25 or 0 is danger.
function variantFor(value: RatedValue): BadgeVariant {
  const points = POINTS[value];
  return points >= 0.75 ? 'ok' : points >= 0.5 ? 'warn' : 'danger';
}

const linkClass = 'underline underline-offset-2 hover:text-t1';

export function ComparisonPage({
  data,
  nicheName,
  reviewed,
  proofRoute,
}: {
  data: ComparisonView;
  nicheName: string;
  reviewed: boolean;
  proofRoute?: ProofRoute | null;
}) {
  const [sortBy, setSortBy] = useState<'rating' | 'name'>('rating');

  // The only source of a rating: this page's table.
  const scores = scoreProducts(data);
  const scoreOf = new Map(scores.map(s => [s.slug, s]));

  const sortedProducts = [...data.products].sort((a, b) =>
    sortBy === 'rating'
      ? (scoreOf.get(a.slug)?.rank ?? 0) - (scoreOf.get(b.slug)?.rank ?? 0)
      : compareByName(a, b)
  );

  // Which kinds of cell this table uses, so its legend explains only those.
  const values = data.features.flatMap(f => data.products.map(p => readCell(cellFor(f, p)?.value)));
  const used = new Set(values.filter((v): v is RatedValue => v !== null));
  const presenceShown = PRESENCE.filter(v => PRESENCE_ALWAYS.includes(v) || used.has(v));
  const usesPresence = PRESENCE.some(v => used.has(v));
  const usesQuality = QUALITY.some(v => used.has(v));
  const hasGaps = values.some(v => v === null);

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

      {includesOurProduct(data.products) && (
        <aside
          role="note"
          aria-label="Disclosure"
          data-testid="comparison-disclosure"
          className="flex items-start gap-3 border border-b1 rounded-[12px] bg-s0 p-4 mb-8"
        >
          <Icon name="info" size={18} className="mt-0.5 text-t2" />
          <p className="text-row text-t2">
            <strong className="text-t1">We make Incognito Browser, one of the products compared here.</strong>{' '}
            It is scored with the same rubric as every other product, from the table on this page.{' '}
            <Link href={METHODOLOGY_PATH} className={linkClass}>How we score</Link>
          </p>
        </aside>
      )}

      <p className="prose-ib text-lede mb-8">{data.intro}</p>

      {proofRoute && <CheckYoursNow route={proofRoute} niche={data.niche} nicheName={nicheName} />}

      <section className="mb-10">
        {/* The order applies to these cards and to the table's columns below.
            It used to sit on the table header, where it read as if it would
            sort the feature rows. */}
        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
          <h2 className="font-mono text-h2 font-semibold text-t1">Products compared</h2>
          <div role="group" aria-label="Order the products" className="flex items-center gap-2">
            <span className="text-meta text-t3">Order:</span>
            <button type="button" aria-pressed={sortBy === 'rating'} onClick={() => setSortBy('rating')} className={sortBy === 'rating' ? 'btn-primary text-xs' : 'btn-ghost text-xs'}>Highest rated</button>
            <button type="button" aria-pressed={sortBy === 'name'} onClick={() => setSortBy('name')} className={sortBy === 'name' ? 'btn-primary text-xs' : 'btn-ghost text-xs'}>Name A–Z</button>
          </div>
        </div>
        <p className="text-row text-t3 mb-4">
          Each rating is worked out from the feature table below, with the same rubric for every product.{' '}
          <Link href={METHODOLOGY_PATH} className={linkClass}>How we score</Link>
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sortedProducts.map((product) => {
            const score = scoreOf.get(product.slug);
            return (
              <div key={product.slug} className="border border-b1 rounded-lg p-5 bg-s0">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-t1">{product.name}</h3>
                  {product.slug === OUR_PRODUCT_SLUG && <Badge label="We make this" />}
                </div>
                <p className="text-row text-t3 mt-1 mb-2">
                  Our rating:{' '}
                  {score?.rating != null ? (
                    <span className="text-lg font-bold text-t1 tnum">{formatRating(score.rating)}</span>
                  ) : (
                    <span className="font-semibold text-t2">{formatRating(null)}</span>
                  )}{' '}
                  {score && score.assessed < score.criteria && (
                    <span className="block text-meta tnum">
                      {score.assessed} of {score.criteria} criteria assessed
                    </span>
                  )}
                </p>
                <p className="text-row text-t3 mb-3">{product.tagline}</p>
                {(product.platforms || product.pricing) && (
                  <div className="text-meta text-t3 mb-3 space-y-0.5">
                    {product.platforms && <p>Platforms: {product.platforms.join(', ')}</p>}
                    {product.pricing && <p>{product.pricing}</p>}
                  </div>
                )}
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
            );
          })}
        </div>
      </section>

      <section className="mb-10">
        <h2 className="font-mono text-h2 font-semibold text-t1 mb-2">Feature comparison</h2>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-meta text-t3 mb-4" aria-label="How to read the table">
          {usesPresence && (
            <li className="flex flex-wrap items-center gap-1.5">
              {presenceShown.map(v => <Badge key={v} variant={variantFor(v)} label={CELL_LABEL[v]} />)}
              <span>whether it has the feature</span>
            </li>
          )}
          {usesQuality && (
            <li className="flex flex-wrap items-center gap-1.5">
              {QUALITY.map(v => <Badge key={v} variant={variantFor(v)} label={CELL_LABEL[v]} />)}
              <span>how well it does it</span>
            </li>
          )}
          {hasGaps && (
            <li>
              <span aria-hidden="true"><span className="text-t1">—</span> = </span>
              <span className="sr-only">A dash means </span>not assessed or doesn&apos;t apply, and not counted in the rating
            </li>
          )}
        </ul>
        <div className="overflow-x-auto border border-b1 rounded-[12px]">
          <table className="w-full border-collapse">
            <thead className="bg-s1">
              <tr>
                <th scope="col" className="text-left p-3 font-medium text-t2 text-row">Feature</th>
                {sortedProducts.map(p => (
                  <th key={p.slug} scope="col" className="text-center p-3 font-medium text-t1 text-row">
                    {p.name}{' '}
                    <span className="block text-meta font-normal text-t2 tnum">{formatRating(scoreOf.get(p.slug)?.rating ?? null)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.features.map((feature, i) => (
                <tr key={i} className="border-t border-hair hover:bg-s0">
                  {/* A row header, so a screen reader names the criterion for
                      each cell, not only the product column. */}
                  <th scope="row" className="text-left p-3 font-normal">
                    <div className="font-medium text-t1 text-row">{feature.name}</div>
                    <div className="text-meta text-t3">{feature.description}</div>
                  </th>
                  {sortedProducts.map(p => {
                    const value = readCell(cellFor(feature, p)?.value);
                    return (
                      <td key={p.slug} className="text-center p-3">
                        {value ? (
                          <Badge variant={variantFor(value)} label={CELL_LABEL[value]} />
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
        {includesOurProduct(data.products) && (
          <p className="text-meta text-t3 mt-3" data-testid="comparison-ib-no-note">
            &ldquo;No&rdquo; for Incognito Browser can also mean a feature isn&apos;t documented.{' '}
            <Link href={METHODOLOGY_PATH} className={linkClass}>How we score</Link>
          </p>
        )}
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

      <EditorialNote reviewed={reviewed} />
    </article>
  );
}
