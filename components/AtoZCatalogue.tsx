'use client';

/**
 * Search + clickable letter bar + topic chips at the top, A–Z entries at the
 * bottom — the same wayfinding on every index page (modelled on the Privacy
 * Glossary). Progressive enhancement:
 * the full alphabetized list is server-rendered, so crawlers and no-JS
 * visitors get every link; the search box filters it client-side.
 * No external dependencies.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { LETTERS, filingParts, filterEntries, groupByLetter, letterOf, type CatalogueEntry } from '@/lib/catalogue';
import { GradeBadge } from '@/components/GradeBadge';
import { ToolCard } from '@/components/ToolCard';
import { Icon, IconTile, type IconName } from '@/components/ui/Icon';
import { ENGINE_ICON, familyOfNiche, type Family } from '@/lib/visuals';

export interface CatalogueTopic {
  label: string;
  /** Link to the topic hub page when one exists (crawlable). */
  href?: string;
  /** Otherwise: filter the list in place with this search query. */
  query?: string;
}

interface Props {
  entries: CatalogueEntry[];
  /**
   * Plural noun, e.g. "guides": names the catalogue (data-catalogue) and,
   * except on the tools catalogue (see countNounOf), the count line,
   * placeholder and A–Z heading.
   */
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

// DESIGN-SPEC 5.5: the A–Z list uses a "rules grid" — 1px hairlines rather
// than 1,300 individually-rounded boxes — everywhere except the tools
// catalogue, whose entries are full ToolCards (kept as PR2 styled them; a
// hairline grid would clip the tier rail and schematic).
//
// The hairline is a ring on each CELL, not a coloured container showing
// through 1px gaps. The container trick only works when every row is full:
// a letter group of 2 in a 3-column grid left the third cell empty, and the
// container colour showed through as a solid block. Rows here are ragged by
// nature (one group per letter), so the rule has to belong to the cell.
function entryGridClass(noun: string): string {
  return noun === 'tools'
    ? 'grid grid-cols-1 md:grid-cols-2 gap-3'
    : 'grid sm:grid-cols-2 lg:grid-cols-3 gap-3';
}

/**
 * What the count line, search box and A–Z heading call the entries. The
 * tools catalogue has one entry per topic PAGE (one tool is listed under
 * several topics), while the /tools hero counts distinct tools, so "23 tools"
 * sat under "13 tools" on the same page. There the count says what it counts.
 */
function countNounOf(noun: string): string {
  return noun === 'tools' ? 'tool pages' : noun;
}

const TOPIC_FADE = 'linear-gradient(to right, black calc(100% - 3rem), transparent)';

/**
 * "Browse by topic": one line of chips fading out at the edge, and a toggle
 * that shows the rest. All 44 topics wrapped to nine rows, which pushed the
 * page's own content off the first screen.
 *
 * Collapsing is visual only. Every chip stays in the DOM, so all the topic-hub
 * links are still in the server HTML for crawlers, and the <noscript> rule
 * shows the full list to readers without JavaScript (who could not press the
 * toggle). A keyboard user tabbing onto a clipped chip opens the list, so
 * focus never lands on something they cannot see.
 */
function TopicChips({ topics, query, setQuery }: { topics: CatalogueTopic[]; query: string; setQuery: (q: string) => void }) {
  const [open, setOpen] = useState(false);
  // The collapsed line, measured: does anything run past the edge, and how
  // many chips are out of sight. null until the first measurement.
  const [fit, setFit] = useState<{ overflows: boolean; hidden: number } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const rowId = useId();

  useEffect(() => {
    const row = rowRef.current;
    if (!row || open) return;
    // A chip counts as hidden only if it starts inside the fade (the last
    // 3rem). One that starts before it is partly readable, and counting it
    // made a phone say "+44 more" with just the first chip half on screen.
    const fadePx = 3 * parseFloat(getComputedStyle(document.documentElement).fontSize);
    const inFade = (el: HTMLElement) => el.offsetLeft >= row.clientWidth - fadePx;
    // Observing the chips as well as the row re-counts when the web font
    // swaps in and every chip changes width while the row does not. The
    // observer also fires once on observe(), which does the first count.
    const ro = new ResizeObserver(() => {
      setFit({
        overflows: row.scrollWidth > row.clientWidth + 1,
        hidden: (Array.from(row.children) as HTMLElement[]).filter(inFade).length,
      });
    });
    ro.observe(row);
    for (const el of Array.from(row.children)) ro.observe(el);
    return () => ro.disconnect();
  }, [open, topics]);

  const fits = fit !== null && !fit.overflows;
  const chipLayout = open ? '' : 'shrink-0 whitespace-nowrap';
  const toggleLabel = open
    ? 'Show fewer'
    : fit === null
      ? `All ${topics.length}`
      : fit.hidden > 0
        ? `+${fit.hidden} more`
        : 'Show all';

  return (
    <div className="mb-8" data-topics={topics.length}>
      <noscript>
        <style>{'[data-topic-row]{flex-wrap:wrap!important;overflow:visible!important;mask-image:none!important;-webkit-mask-image:none!important}[data-topic-toggle]{display:none!important}'}</style>
      </noscript>
      <h3 className="text-xs uppercase tracking-wider text-t3 mb-2">Browse by topic</h3>
      <div className="flex items-start gap-2">
        <div
          id={rowId}
          ref={rowRef}
          data-topic-row=""
          className={`relative min-w-0 flex-1 flex gap-2 ${open ? 'flex-wrap' : 'flex-nowrap overflow-hidden'}`}
          style={!open && !fits ? { maskImage: TOPIC_FADE, WebkitMaskImage: TOPIC_FADE } : undefined}
          onFocus={(e) => {
            const el = e.target as HTMLElement;
            if (!open && el !== e.currentTarget && el.matches(':focus-visible') && el.offsetLeft + el.offsetWidth > e.currentTarget.clientWidth) setOpen(true);
          }}
        >
          {topics.map((t) =>
            t.href ? (
              <Link key={t.label} href={t.href} className={`text-row px-2.5 py-1 rounded-[4px] border border-b1 bg-s1 text-t2 hover:border-b2 hover:text-white transition-colors topic-chip ${chipLayout}`}>
                {t.label}
              </Link>
            ) : (
              <button
                key={t.label}
                type="button"
                onClick={() => setQuery(query.trim() === (t.query ?? t.label) ? '' : (t.query ?? t.label))}
                aria-pressed={query.trim() === (t.query ?? t.label)}
                className={`text-row px-2.5 py-1 rounded-[4px] border transition-colors topic-chip ${chipLayout} ${query.trim() === (t.query ?? t.label) ? 'border-b2 bg-s2 text-white' : 'border-b1 bg-s1 text-t2 hover:border-b2 hover:text-white'}`}
              >
                {t.label}
              </button>
            ),
          )}
        </div>
        {!fits && (
          <button
            type="button"
            data-topic-toggle=""
            aria-expanded={open}
            aria-controls={rowId}
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 inline-flex items-center gap-1 text-row px-2.5 py-1 rounded-[4px] border border-b2 bg-s2 text-t1 hover:text-white transition-colors whitespace-nowrap"
          >
            {toggleLabel}
            <Icon name="chevron" size={14} className={`transition-transform ${open ? '-rotate-90' : 'rotate-90'}`} />
          </button>
        )}
      </div>
    </div>
  );
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
  const counted = countNounOf(noun);

  return (
    <>
    <section className="mb-10" data-catalogue={noun} data-count={entries.length}>
      {heading && <h2 className="text-xl font-semibold text-white mb-3">{heading}</h2>}

      {/* Search */}
      <div className="mb-4">
        <label htmlFor={inputId} className="sr-only">Search {counted}</label>
        <input
          id={inputId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${entries.length} ${counted}…`}
          autoComplete="off"
          className="w-full md:max-w-md bg-s0 border border-b1 rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-t3 focus:outline-none focus:border-b2"
        />
        <p className="text-xs text-t3 mt-2" aria-live="polite">
          {q ? `${matches!.length} of ${entries.length} ${counted} match “${q}”` : `${entries.length} ${counted}, A to Z. Jump to a letter or search.`}
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
      {topics && topics.length > 0 && <TopicChips topics={topics} query={query} setQuery={setQuery} />}

      {/* Search results — directly under the box, so typing never sends you off-screen */}
      {q && (
        matches!.length === 0 ? (
          <p className="text-t3 py-8">No {counted} match “{q}”. Try a shorter word, a topic name, or clear the search.</p>
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
        <h2 className="text-xl font-semibold text-white mb-6">All {entries.length} {counted}, A to Z</h2>
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
 * A title shown the way it is filed: leading words the catalogue skips
 * ("Complete Guide to", "Best") in the quiet colour and weight, the words it
 * files by at full strength, so "Complete Guide to Ad Tracking" visibly
 * belongs under A. Same split as letterOf (lib/catalogue filingParts).
 */
function FiledTitle({ title }: { title: string }) {
  const { lead, filed } = filingParts(title);
  return (
    <>
      {lead && <span className="font-normal text-t3">{lead}</span>}
      {filed}
    </>
  );
}

/**
 * Amendment A / DESIGN-SPEC 5.3: on the tools catalogue, entries render as a
 * 32px ToolCard — the engine comes from the `keywords` field every
 * tools-page entry already carries (`${toolEngine} ${niche} ...`), matched
 * against ENGINE_ICON's own key list. Every other catalogue (guides,
 * checklists, comparisons, templates, calculators, glossary, site) keeps the
 * plain entry card below — those have no engine to key a tool card off.
 */
function engineFromKeywords(keywords?: string): string | undefined {
  if (!keywords) return undefined;
  return keywords.split(/\s+/).find((w) => w in ENGINE_ICON);
}

// Literal class strings per family — never interpolated — so Tailwind's
// content scanner sees them (same rule as ToolCard's RAIL map).
/**
 * The entry's niche, taken from its own href (`/<type>/<niche>/<slug>`).
 * CatalogueEntry carries no niche field and the report-card and glossary
 * catalogues are two segments deep, so this returns '' for them and
 * familyOfNiche falls back to its default hue.
 */
function nicheFromHref(href: string): string {
  const seg = href.split('?')[0].split('#')[0].split('/').filter(Boolean);
  return seg.length >= 3 ? seg[1] : '';
}

const ENTRY_RAIL: Record<Family, string> = {
  net: 'before:bg-fam-net',
  trace: 'before:bg-fam-trace',
  identity: 'before:bg-fam-identity',
  cipher: 'before:bg-fam-cipher',
};

function Entry({ e, noun, icon }: { e: CatalogueEntry; noun: string; icon: IconName }) {
  const engine = noun === 'tools' ? engineFromKeywords(e.keywords) : undefined;
  if (engine) {
    return (
      <div className="catalogue-entry" data-letter={letterOf(e.title)}>
        <ToolCard
          engine={engine}
          title={<FiledTitle title={e.title} />}
          blurb={e.description ?? ''}
          href={e.href}
          tileSize={32}
        />
      </div>
    );
  }
  // Entry anatomy follows ToolCard rather than 5.5's hairline rules grid.
  // The spec chose a dense grid so 1,300 entries would not become 1,300
  // rounded boxes, but in practice it read as a wall: no icon colour, no
  // separation, every row identical. The tools index was the one catalogue
  // that scanned well, and cards are why. Same anatomy here, with the rail
  // hue keyed off the entry's niche instead of a tool engine.
  return (
    <Link
      href={e.href}
      className={`group relative overflow-hidden grid grid-cols-[32px_1fr] gap-3.5 bg-s0 border border-b1 rounded-[12px] p-4 hover:border-b2 transition-colors catalogue-entry before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 ${ENTRY_RAIL[familyOfNiche(nicheFromHref(e.href))]}`}
      data-letter={letterOf(e.title)}
    >
      {e.grade ? <GradeBadge grade={e.grade} size="sm" /> : <IconTile name={icon} size={32} family={familyOfNiche(nicheFromHref(e.href))} />}
      <div className="min-w-0">
        <h4 className="font-mono text-[15px] font-semibold text-t1"><FiledTitle title={e.title} /></h4>
        {e.meta && <p className="text-meta text-t3 mt-0.5">{e.meta}</p>}
        {e.description && <p className="prose-ib text-row line-clamp-2 mt-1">{e.description}</p>}
      </div>
    </Link>
  );
}
