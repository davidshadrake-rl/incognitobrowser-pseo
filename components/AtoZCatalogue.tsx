'use client';

/**
 * Search + clickable letter bar + A–Z entries — the same wayfinding on every
 * index page (modelled on the Privacy Glossary). Progressive enhancement:
 * the full alphabetized list is server-rendered, so crawlers and no-JS
 * visitors get every link; the search box filters it client-side.
 * No external dependencies.
 */
import { useId, useMemo, useState } from 'react';
import Link from 'next/link';
import { LETTERS, filterEntries, groupByLetter, letterOf, type CatalogueEntry } from '@/lib/catalogue';

interface Props {
  entries: CatalogueEntry[];
  /** Plural noun for the count line and placeholder, e.g. "guides". */
  noun: string;
  /** Optional heading above the list; omit to render only search + letters + entries. */
  heading?: string;
}

export function AtoZCatalogue({ entries, noun, heading }: Props) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const groups = useMemo(() => groupByLetter(entries), [entries]);
  const present = useMemo(() => new Set(groups.map((g) => g.letter)), [groups]);
  const q = query.trim();
  const matches = useMemo(() => (q ? filterEntries(groupByLetter(entries).flatMap((g) => g.entries), q) : null), [entries, q]);

  return (
    <section className="mb-12" data-catalogue={noun} data-count={entries.length}>
      {heading && <h2 className="text-xl font-semibold text-white mb-3">{heading}</h2>}

      {/* Search */}
      <div className="mb-4">
        <label htmlFor={inputId} className="sr-only">Search {noun}</label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${entries.length} ${noun}…`}
          autoComplete="off"
          className="w-full md:max-w-md bg-[#0a0a0a] border border-white/10 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-[#B8B8D4]/50 focus:outline-none focus:border-white/40"
        />
        <p className="text-xs text-[#B8B8D4]/60 mt-2" aria-live="polite">
          {q ? `${matches!.length} of ${entries.length} ${noun} match “${q}”` : `${entries.length} ${noun}, A to Z. Jump to a letter or search.`}
        </p>
      </div>

      {/* Letter bar — every letter rendered so the bar is stable; empty letters are inert */}
      <nav aria-label="Jump to letter" className="flex flex-wrap gap-1 mb-8">
        {LETTERS.map((letter) =>
          present.has(letter) && !q ? (
            <a
              key={letter}
              href={`#letter-${letter === '#' ? 'num' : letter}`}
              className="w-8 h-8 flex items-center justify-center rounded bg-white/5 text-sm font-medium text-[#B8B8D4] border border-white/10 hover:bg-white/10 hover:text-white"
            >
              {letter}
            </a>
          ) : (
            <span key={letter} aria-hidden="true" className="w-8 h-8 flex items-center justify-center rounded text-sm text-[#B8B8D4]/25 border border-white/5">
              {letter}
            </span>
          ),
        )}
      </nav>

      {/* Search results (flat) or A–Z sections */}
      {q ? (
        matches!.length === 0 ? (
          <p className="text-[#B8B8D4]/70 py-8">No {noun} match “{q}”. Try a shorter word, a topic name, or clear the search.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {matches!.map((e) => <Entry key={e.href} e={e} />)}
          </div>
        )
      ) : (
        groups.map((g) => (
          <section key={g.letter} id={`letter-${g.letter === '#' ? 'num' : g.letter}`} className="mb-8 scroll-mt-24">
            <h3 className="text-2xl font-bold text-white mb-4 sticky top-16 bg-black py-2 z-10">{g.letter === '#' ? '0–9' : g.letter}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {g.entries.map((e) => <Entry key={e.href} e={e} />)}
            </div>
          </section>
        ))
      )}
    </section>
  );
}

function Entry({ e }: { e: CatalogueEntry }) {
  return (
    <Link href={e.href} className="block border border-white/10 rounded-lg p-4 bg-[#0a0a0a] hover:border-white/30 transition-all catalogue-entry" data-letter={letterOf(e.title)}>
      <div className="flex items-start justify-between gap-3">
        <h4 className="font-semibold text-white">{e.title}</h4>
        {e.badge && <span className="shrink-0 text-xs bg-white/5 text-[#B8B8D4]/70 px-2 py-0.5 rounded border border-white/5">{e.badge}</span>}
      </div>
      {e.meta && <p className="text-xs text-[#B8B8D4]/60 mt-0.5">{e.meta}</p>}
      {e.description && <p className="text-sm text-[#B8B8D4] mt-1 line-clamp-2">{e.description}</p>}
    </Link>
  );
}
