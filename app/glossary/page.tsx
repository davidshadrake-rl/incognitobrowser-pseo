import Link from 'next/link';
import { getGlossaryFiles, getGlossaryItem } from '@/lib/content';
import { generateMetadata as genMeta } from '@/lib/seo';

export const metadata = genMeta({
  title: 'Privacy Glossary',
  description: 'A comprehensive glossary of privacy and security terms. Understand the concepts that matter for your online privacy.',
  path: '/glossary',
  type: 'website',
});

interface GlossaryMeta {
  term: string;
  slug: string;
  definition: string;
  category: string;
}

export default function GlossaryIndex() {
  const files = getGlossaryFiles();
  const terms: GlossaryMeta[] = files
    .map(f => getGlossaryItem<GlossaryMeta>(f))
    .filter((t): t is GlossaryMeta => t !== null)
    .sort((a, b) => a.term.localeCompare(b.term));

  const grouped = terms.reduce<Record<string, GlossaryMeta[]>>((acc, term) => {
    const letter = term.term[0].toUpperCase();
    if (!acc[letter]) acc[letter] = [];
    acc[letter].push(term);
    return acc;
  }, {});

  const letters = Object.keys(grouped).sort();

  return (
    <div>
      <h1 className="text-3xl font-bold text-white mb-2">Privacy Glossary</h1>
      <p className="text-[#B8B8D4] mb-8">
        {terms.length} privacy and security terms explained in plain language.
      </p>

      {terms.length === 0 && (
        <div className="text-center py-12 text-[#B8B8D4]/60">
          <p className="text-lg">Glossary terms are being generated. Check back soon!</p>
        </div>
      )}

      {/* Letter navigation */}
      {letters.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-8">
          {letters.map(letter => (
            <a
              key={letter}
              href={`#letter-${letter}`}
              className="w-8 h-8 flex items-center justify-center rounded bg-white/5 text-sm font-medium text-[#B8B8D4] border border-white/10 hover:bg-white/10 hover:text-white"
            >
              {letter}
            </a>
          ))}
        </div>
      )}

      {/* Terms by letter */}
      {letters.map(letter => (
        <section key={letter} id={`letter-${letter}`} className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-4 sticky top-16 bg-black py-2 z-10">
            {letter}
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {grouped[letter].map(term => (
              <Link
                key={term.slug}
                href={`/glossary/${term.slug}`}
                className="block border border-white/10 rounded-lg p-4 bg-[#0a0a0a] hover:border-white/30 transition-all"
              >
                <h3 className="font-semibold text-white">{term.term}</h3>
                <p className="text-sm text-[#B8B8D4] mt-1 line-clamp-2">{term.definition}</p>
                <span className="inline-block mt-2 text-xs bg-white/5 text-[#B8B8D4]/60 px-2 py-0.5 rounded border border-white/5">
                  {term.category}
                </span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
