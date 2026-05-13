'use client';

import Link from 'next/link';
import { Badge } from './ui/Badge';
import { Breadcrumbs } from './ui/Breadcrumbs';

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
  validTermSlugs?: string[];
}

export function GlossaryTermPage({ data, validTermSlugs }: GlossaryTermPageProps) {
  const filteredRelatedTerms = validTermSlugs
    ? data.relatedTerms.filter(t => validTermSlugs.includes(t))
    : data.relatedTerms;
  return (
    <article className="max-w-3xl mx-auto">
      <Breadcrumbs items={[
        { label: 'Glossary', href: '/glossary' },
        { label: data.term },
      ]} />

      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-3">{data.term}</h1>
        <Badge label={data.category} />
      </header>

      <div className="bg-white/5 border-l-4 border-white/40 p-5 mb-8 rounded-r-lg">
        <p className="text-lg text-[#cfcfcf] font-medium">{data.definition}</p>
      </div>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">In Simple Terms</h2>
        <p className="text-[#B8B8D4]">{data.simpleExplanation}</p>
      </section>

      <section className="mb-8">
        <h2 className="text-xl font-semibold text-white mb-3">Why It Matters</h2>
        <p className="text-[#B8B8D4]">{data.whyItMatters}</p>
      </section>

      {data.technicalDetail && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-3">Technical Details</h2>
          <div className="bg-[#0a0a0a] border border-white/10 rounded-lg p-4 text-sm text-[#B8B8D4] font-mono">
            {data.technicalDetail}
          </div>
        </section>
      )}

      {data.examples.length > 0 && (
        <section className="mb-8">
          <h2 className="text-xl font-semibold text-white mb-4">Real-World Examples</h2>
          <div className="space-y-4">
            {data.examples.map((ex, i) => (
              <div key={i} className="border border-white/10 rounded-lg p-4 bg-[#0a0a0a]">
                <h3 className="font-medium text-white mb-2">{ex.scenario}</h3>
                <p className="text-sm text-[#B8B8D4]">{ex.explanation}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {filteredRelatedTerms.length > 0 && (
        <section className="mt-10 pt-6 border-t border-white/10">
          <h2 className="text-lg font-semibold text-white mb-3">Related Terms</h2>
          <div className="flex flex-wrap gap-2">
            {filteredRelatedTerms.map((term, i) => (
              <Link
                key={i}
                href={`/glossary/${term}`}
                aria-label={`Read glossary entry: ${term.replace(/-/g, ' ')}`}
                className="px-3 py-1.5 border border-white/10 text-[#B8B8D4] rounded-full text-sm hover:border-white/30 hover:text-white transition-colors"
              >
                {term.replace(/-/g, ' ')}
              </Link>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
