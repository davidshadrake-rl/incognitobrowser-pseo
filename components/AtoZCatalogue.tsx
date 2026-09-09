'use client';

/**
 * Search + clickable letter bar + topic chips at the top, A–Z entries at the
 * bottom — the same wayfinding on every index page (modelled on the Privacy
 * Glossary). Progressive enhancement:
 * the full alphabetized list is server-rendered, so crawlers and no-JS
 * visitors get every link; the search box filters it client-side.
 * No external dependencies.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { LETTERS, filterEntries, groupByLetter, letterOf, type CatalogueEntry } from '@/lib/catalogue';
import { GradeBadge } from '@/components/GradeBadge';
import { ToolCard } from '@/components/ToolCard';
import { IconTile, type IconName } from '@/components/ui/Icon';
import { ENGINE_ICON } from '@/lib/visuals';

export interface CatalogueTopic {
  label: string;
  /** Link to the topic hub page when one exists (crawlable). */
  href?: string;
  /** Otherwise: filter the list in place with this search query. */
  query?: string;
}

interface Props {
  entries: CatalogueEntry[];
  /** Plural noun for the count line and placeholder, e.g. "guides". */
  noun: string;
  /**
   * DESIGN-SPEC 5.5: the 32px IconTile every non-tool entry carries (the
   * same TYPE_ICON the page's own PageHero uses). Unused on the tools
   * catalogue, where each entry derives its own icon from its engine.
   */
  icon?: IconName;
  /** Optional heading above the list; omit to render only search + letters + entries. */
  heading?: string;
  /** Compact "Browse by topic" chip row under the letter bar — sits high without pushing the A–Z down. */
  topics?: CatalogueTopic[];
  /** The page's own content (featured grid, summaries…). Rendered between the controls and the A–Z list. */
  children?: ReactNode;
}

// DESIGN-SPEC 5.5: the A–Z list uses a "rules grid" — 1px hairline gaps from
// a shared bg-b1 ground, not 1,300 individually-rounded boxes — everywhere
// except the tools catalogue, whose entries are full ToolCards (kept as PR2
// styled them; a hairline grid would clip the tier rail and schematic).
function entryGridClass(noun: string): string {
  return noun === 'tools'
    ? 'grid grid-cols-1 md:grid-cols-2 gap-3'
    : 'grid sm:grid-cols-2 lg:grid-cols-3 gap-px bg-b1 rounded-[12px] overflow-hidden';
}

/**
 * Layout on every index page: [search + letter bar + topic chips] at the very
 * top beneath the heading → search results (only while typing) → the page's
 * own content → the full A–Z list at the bottom (letter links jump to it).
 */
export function AtoZCatalogue({ entries, noun, icon = 'doc', heading, topics, children }: Props) {
  const [query, setQuery] = useState('');
  const inputId = useId();
  const groups = useMemo(() => groupByLetter(entries), [entries]);
  const present = useMemo(() => new Set(groups.map((g) => g.letter)), [groups]);
  const q = query.trim();
  const matches = useMemo(() => (q ? filterEntries(groupByLetter(entries).flatMap((g) => g.entries), q) : null), [entries, q]);
  const gridClass = entryGridClass(noun);

  return (
    <>
    <section className="mb-10" data-catalogue={noun} data-count={entries.length}>
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
          className="w-full md:max-w-md bg-s0 border border-b1 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-t3 focus:outline-none focus:border-b2"
        />
        <p className="text-xs text-t3 mt-2" aria-live="polite">
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
              className="w-8 h-8 flex items-center justify-center rounded bg-white/5 text-sm font-medium text-t2 border border-b1 hover:bg-white/10 hover:text-white"
            >
              {letter}
            </a>
          ) : (
            <span key={letter} aria-hidden="true" className="w-8 h-8 flex items-center justify-center rounded text-sm text-t2/25 border border-hair">
              {letter}
            </span>
          ),
        )}
      </nav>

      {/* Browse by topic — chips, not a second full listing */}
      {topics && topics.length > 0 && (
        <div className="mb-8" data-topics={topics.length}>
          <h3 className="text-xs uppercase tracking-wider text-t3 mb-2">Browse by topic</h3>
          <div className="flex flex-wrap gap-2">
            {topics.map((t) =>
              t.href ? (
                <Link key={t.label} href={t.href} className="text-row px-2.5 py-1 rounded-[4px] border border-b1 bg-s1 text-t2 hover:border-b2 hover:text-white transition-colors topic-chip">
                  {t.label}
                </Link>
              ) : (
                <button
                  key={t.label}
                  type="button"
                  onClick={() => setQuery(query.trim() === (t.query ?? t.label) ? '' : (t.query ?? t.label))}
                  aria-pressed={query.trim() === (t.query ?? t.label)}
                  className={`text-row px-2.5 py-1 rounded-[4px] border transition-colors topic-chip ${query.trim() === (t.query ?? t.label) ? 'border-b2 bg-s2 text-white' : 'border-b1 bg-s1 text-t2 hover:border-b2 hover:text-white'}`}
                >
                  {t.label}
                </button>
              ),
            )}
          </div>
        </div>
      )}

      {/* Search results — directly under the box, so typing never sends you off-screen */}
      {q && (
        matches!.length === 0 ? (
          <p className="text-t3 py-8">No {noun} match “{q}”. Try a shorter word, a topic name, or clear the search.</p>
        ) : (
          <div className={gridClass} data-results={matches!.length}>
            {matches!.map((e) => <Entry key={e.href} e={e} noun={noun} icon={icon} />)}
          </div>
        )
      )}
    </section>

    {/* The page's own content sits between the controls and the list */}
    {children}

    {/* Full A–Z list at the bottom of the page (hidden while a search is active) */}
    {!q && (
      <section id="a-to-z" className="mt-12 pt-8 border-t border-b1 scroll-mt-24" data-atoz={noun}>
        <h2 className="text-xl font-semibold text-white mb-6">All {entries.length} {noun}, A to Z</h2>
        {groups.map((g) => (
          <section key={g.letter} id={`letter-${g.letter === '#' ? 'num' : g.letter}`} className="mb-8 scroll-mt-24">
            <h3 className="text-2xl font-bold text-white mb-4 sticky top-16 bg-black py-2 z-10">{g.letter === '#' ? '0–9' : g.letter}</h3>
            <div className={gridClass}>
              {g.entries.map((e) => <Entry key={e.href} e={e} noun={noun} icon={icon} />)}
            </div>
          </section>
        ))}
      </section>
    )}
    </>
  );
}

/**
 * Amendment A / DESIGN-SPEC 5.3: on the tools catalogue, entries render as a
 * compact 32px ToolCard — the engine comes from the `keywords` field every
 * tools-page entry already carries (`${toolEngine} ${niche} ...`), matched
 * against ENGINE_ICON's own key list. Every other catalogue (guides,
 * checklists, comparisons, templates, calculators, glossary, site) keeps the
 * plain entry card below — those have no engine to key a tool card off.
 */
function engineFromKeywords(keywords?: string): string | undefined {
  if (!keywords) return undefined;
  return keywords.split(/\s+/).find((w) => w in ENGINE_ICON);
}

function Entry({ e, noun, icon }: { e: CatalogueEntry; noun: string; icon: IconName }) {
  const engine = noun === 'tools' ? engineFromKeywords(e.keywords) : undefined;
  if (engine) {
    return (
      <div className="catalogue-entry" data-letter={letterOf(e.title)}>
        <ToolCard
          engine={engine}
          title={e.title}
          blurb={e.description ?? ''}
          href={e.href}
          processing={e.keywords?.includes('server-assisted') ? 'server' : undefined}
          tileSize={32}
          compact
        />
      </div>
    );
  }
  // DESIGN-SPEC 5.5 entry anatomy: 32px IconTile (GradeBadge instead, on the
  // report-card index — the only catalogue whose entries carry a grade),
  // font-mono title, text-meta/t3 meta line, prose-ib description clamped to
  // 2 lines. No badge here — the tier chip is a tool-only affordance and
  // renders through the ToolCard branch above (DESIGN-SPEC 5.9).
  return (
    <Link href={e.href} className="relative flex items-start gap-3 p-4 bg-base hover:bg-s0 transition-colors catalogue-entry" data-letter={letterOf(e.title)}>
      {e.grade ? <GradeBadge grade={e.grade} size="sm" /> : <IconTile name={icon} size={32} />}
      <div className="min-w-0">
        <h4 className="font-mono text-[15px] font-semibold text-t1">{e.title}</h4>
        {e.meta && <p className="text-meta text-t3 mt-0.5">{e.meta}</p>}
        {e.description && <p className="prose-ib text-row line-clamp-2 mt-1">{e.description}</p>}
      </div>
    </Link>
  );
}
