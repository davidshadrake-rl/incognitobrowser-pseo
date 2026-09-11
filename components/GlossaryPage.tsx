'use client';

import Link from 'next/link';
import { Badge } from './ui/Badge';
import { Breadcrumbs } from './ui/Breadcrumbs';
import { PageHero } from './ui/PageHero';
import { EditorialNote } from './EditorialNote';
import { TYPE_ICON, diagramForNiche } from '@/lib/visuals';

interface GlossaryExample {
  scenario: string;
  explanation: string;
}

interface GlossaryData {
  term: string;
  slug: string;
  definition: string;
  metaDescription: string;
  simpleExplanation: string;
  whyItMatters: string;
  technicalDetail?: string;
  examples: GlossaryExample[];
  relatedTerms: string[];
  niche?: string;
  category: string;
}

interface GlossaryTermPageProps {
  data: GlossaryData;
  /** Slug -> display name ("gdpr" -> "GDPR") for the related terms that have
   * a page. Terms without an entry here are dropped, not linked to a 404. */
  relatedTermNames?: Record<string, string>;
  /** The niche this term is mapped to (nicheForGlossaryTerm), for the hero's
   * diagram — data.niche is rarely populated on the JSON itself. */
  niche?: string;
  nicheName?: string;
}

export function GlossaryTermPage({ data, relatedTermNames, niche, nicheName }: GlossaryTermPageProps) {
  const filteredRelatedTerms = relatedTermNames
    ? data.relatedTerms.filter(t => Object.prototype.hasOwnProperty.call(relatedTermNames, t))
    : data.relatedTerms;
  // The chip used to show the slug with hyphens swapped for spaces, so
  // acronyms and names came out lowercase ("gdpr", "dns over https").
  const nameOf = (slug: string) => relatedTermNames?.[slug] ?? slug.replace(/-/g, ' ');
  const resolvedNiche = niche || data.niche;
  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Glossary', href: '/glossary' },
        { label: data.term },
      ]} />

      <PageHero
        icon={TYPE_ICON.glossary}
        kicker={nicheName ? `${nicheName} · glossary` : 'Glossary'}
        title={data.term}
        badges={<Badge label={data.category} />}
        diagram={resolvedNiche ? diagramForNiche(resolvedNiche) : undefined}
      />

      <div className="border-l-2 border-t1 bg-s0 p-5 mb-8 rounded-r-[12px]">
        <p className="prose-ib text-lede font-medium">{data.definition}</p>
      </div>

      <section className="mb-8">
        <h2 className="font-mono text-h3 font-semibold text-t1 mb-3">In simple terms</h2>
        <p className="prose-ib text-[15px]">{data.simpleExplanation}</p>
      </section>

      <section className="mb-8">
        <h2 className="font-mono text-h3 font-semibold text-t1 mb-3">Why it matters</h2>
        <p className="prose-ib text-[15px]">{data.whyItMatters}</p>
      </section>

      {data.technicalDetail && (
        <section className="mb-8">
          <h2 className="font-mono text-h3 font-semibold text-t1 mb-3">Technical details</h2>
          <div className="bg-s0 border border-b1 rounded-[12px] p-4 text-row text-t2 font-mono">
            {data.technicalDetail}
          </div>
        </section>
      )}

      {data.examples.length > 0 && (
        <section className="mt-8 mb-8">
          <h2 className="font-mono text-h3 font-semibold text-t1 mb-4">Real-world examples</h2>
          <div className="space-y-3">
            {data.examples.map((ex, i) => (
              <div key={i} className="border border-b1 rounded-[12px] p-4 bg-s0">
                <h3 className="font-medium text-t1 mb-2">{ex.scenario}</h3>
                <p className="prose-ib text-row">{ex.explanation}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {filteredRelatedTerms.length > 0 && (
        <section className="mt-10 pt-6 border-t border-b1">
          <h2 className="text-kicker uppercase text-t3 mb-3">Related terms</h2>
          <div className="flex flex-wrap gap-2">
            {filteredRelatedTerms.map((term, i) => (
              <Link
                key={i}
                href={`/glossary/${term}`}
                aria-label={`Read glossary entry: ${nameOf(term)}`}
                className="px-3 py-1.5 border border-b1 bg-s1 text-t2 rounded-[4px] text-row hover:border-b2 hover:text-t1 transition-colors"
              >
                {nameOf(term)}
              </Link>
            ))}
          </div>
        </section>
      )}

      <EditorialNote reviewed={(data as unknown as { reviewed?: boolean }).reviewed} />
    </article>
  );
}
