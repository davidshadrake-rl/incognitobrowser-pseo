'use client';

/**
 * Console shell (DESIGN-SPEC 5.4, lines 542-577): wraps the RESULT markup of
 * every engine that reports on the visitor (the value-only tools use
 * ValueCard) in a shared "product console" frame — a header strip
 * (tool name + status dot and verdict word + optional checks count + run
 * time), an optional Gauge/tally left column, and a right column carrying a
 * glance StatTile row plus the tool's own detailed result markup.
 *
 * This component only lays out what each tool already computed. It never
 * invents a score, a check count, or a status — callers pass their own
 * report()-bound values straight through (`statusFromSeverity` below maps
 * the existing result-bus Severity to the header/row status vocabulary so
 * nothing has to be recomputed twice).
 */
import { useState, type ReactNode } from 'react';
import { Gauge } from '@/components/ui/Gauge';
import { StatTile } from '@/components/ui/StatTile';
import { StatusDot, type Status } from '@/components/ui/StatusDot';
import type { Severity } from './ResultContext';

export type { Status };

export interface ConsoleRow {
  status: Status;
  name: string;
  value: string;
  detail?: string;
}

export interface ConsoleGroup {
  name: string;
  rows: ConsoleRow[];
}

/** Literal classnames (not template-interpolated) so Tailwind's scanner finds them. */
const HEADER_DOT: Record<Status, string> = {
  ok: 'bg-ok shadow-ok',
  warn: 'bg-warn shadow-warn',
  danger: 'bg-danger shadow-danger',
  info: 'bg-info',
};

/** Value-column text colour. Literal, for the same scanner reason as HEADER_DOT. */
const VALUE_TEXT: Record<Status, string> = {
  ok: 'text-ok',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-info',
};

/**
 * The name the header shows. The engine id is an internal key ("dns-leak-test")
 * and read as debug output to visitors, so the header names the tool instead.
 * Same titles as the /tools catalogue cards (FEATURED_TOOLS in
 * app/tools/page.tsx), minus What's My IP's "+ WebRTC Leak Test" suffix.
 */
export const ENGINE_NAME: Record<string, string> = {
  'whats-my-ip': "What's My IP",
  'password-strength': 'Password Strength Checker',
  'browser-privacy': 'Browser Privacy Audit',
  'cookie-analyzer': 'Cookie & Tracker Scanner',
  'url-analyzer': 'URL Safety Checker',
  'privacy-quiz': 'Privacy Score Quiz',
  'permission-checker': 'Permission Checker',
  'metadata-viewer': 'Image Metadata Viewer',
  'useragent-analyzer': 'User Agent Analyzer',
  'link-unwrapper': 'Link Unwrapper',
  'email-pixel-detector': 'Email Tracking-Pixel Detector',
  'screenshot-leak-checker': 'Screenshot Leak Checker',
  'dns-leak-test': 'DNS Leak Test',
  'ad-blocker-test': 'Ad-Blocker Test',
};

/** "dns-leak-test" -> "Dns leak test": only reached by an engine missing from ENGINE_NAME. */
function readableEngine(engine: string): string {
  const words = engine.replace(/-/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * The header's verdict word, so the status is never carried by the dot's
 * colour alone. `info` is a finished run with nothing to pass or fail.
 * Callers pass `verdict` when their own word is more exact ("Leaking", "Baseline").
 */
const VERDICT_WORD: Record<Status, string> = {
  ok: 'Pass',
  warn: 'Warning',
  danger: 'Fail',
  info: 'Checked',
};

/** Result-bus Severity ('red'|'amber'|'green'|'info') -> the console's Status vocabulary. */
export function statusFromSeverity(s: Severity): Status {
  if (s === 'red') return 'danger';
  if (s === 'amber') return 'warn';
  if (s === 'green') return 'ok';
  return 'info';
}

export function ConsoleFrame({
  engine,
  status,
  verdict,
  checks,
  checksNoun = ['check', 'checks'],
  runAt,
  score,
  scoreUnit = '/100',
  gaugeLabel = 'score',
  tally,
  statTiles,
  groups,
  left,
  children,
}: {
  /** The engine id, e.g. "browser-privacy". The data-console value; the header shows ENGINE_NAME[engine]. */
  engine: string;
  /** The header dot and verdict colour, and the gauge arc's colour when `score` is passed. */
  status: Status;
  /** The header's verdict word. Defaults to Pass / Warning / Fail / Checked from `status`. */
  verdict?: string;
  /** Live count of things this run checked. Omit when the engine has no single natural count. */
  checks?: number;
  /** What `checks` counts, singular and plural, when "check" is the wrong word (questions, test lookups, fields). */
  checksNoun?: [string, string];
  /**
   * When the run finished (ms since epoch). Pass it when this console stays
   * mounted across runs (a re-check, a new file), otherwise the header would
   * keep showing the time of the first run.
   */
  runAt?: number;
  /** 0-100. Renders the Gauge. Omit when the engine has no single score (leave `left` or nothing). */
  score?: number;
  /** What the gauge number is: a score out of 100, or a percentage. */
  scoreUnit?: '/100' | '%';
  gaugeLabel?: string;
  /** Fail/warn/pass counts. `minor` is for low-severity findings that are neither a warning nor a pass. */
  tally?: { fails: number; warns: number; passes: number; minor?: number };
  /** Glance row (DESIGN-SPEC "Glance summaries"). Reuse the same stats already passed to report() — never invent new ones. */
  statTiles?: Array<{ label: string; value: string | number }>;
  /** Grouped status rows, when the engine's result is naturally a checklist. */
  groups?: ConsoleGroup[];
  /** Custom left-column content, replacing the Gauge + tally. */
  left?: ReactNode;
  /** The tool's own detailed result markup, rendered after statTiles/groups. */
  children?: ReactNode;
}) {
  // Mount time is the fallback run time (the console appears only after a
  // result exists, so there's nothing to hydrate against on the server render).
  const [mountedAt] = useState(() => Date.now());
  const ranAt = new Date(runAt ?? mountedAt);
  const time = ranAt.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const hasLeftColumn = left !== undefined || typeof score === 'number' || tally !== undefined;

  return (
    <section className="console bg-s0 border border-b1 rounded-[16px] overflow-hidden font-mono" data-console={engine}>
      <header className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 border-b border-b1 bg-gradient-to-b from-s1 to-s0 text-meta text-t2">
        <span className="text-t1">{ENGINE_NAME[engine] ?? readableEngine(engine)}</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${HEADER_DOT[status]}`} aria-hidden="true" />
          <span className={VALUE_TEXT[status]}>{verdict ?? VERDICT_WORD[status]}</span>
        </span>
        {typeof checks === 'number' && <span>&middot; {checks} {checks === 1 ? checksNoun[0] : checksNoun[1]}</span>}
        <time className="ml-auto tnum text-t3" dateTime={ranAt.toISOString()}>Run at {time}</time>
      </header>
      <div className={`grid ${hasLeftColumn ? 'md:grid-cols-[200px_1fr]' : 'grid-cols-1'} gap-6 p-5`}>
        {/* Several engines have no single score and no pass/fail tally — a
            generated value or a parsed breakdown is the whole result. Rendering
            the column regardless left them with 200px of empty gutter, so it
            only exists when something fills it. */}
        {hasLeftColumn && (
          <div>
            {left ?? (
              <>
                {/* The arc takes the header's status, not its own score bands, so arc, dot
                    and CTA are one colour: a short link scores 90 but is a Warning. */}
                {typeof score === 'number' && <Gauge score={score} label={gaugeLabel} unit={scoreUnit} status={status} />}
                {tally && (
                  <p className="text-row tnum mt-2">
                    <b className="text-danger">Fails {tally.fails}</b> &middot; <b className="text-warn">Warns {tally.warns}</b>
                    {typeof tally.minor === 'number' && tally.minor > 0 && <> &middot; <b className="text-info">Minor {tally.minor}</b></>}
                    {' '}&middot; <b className="text-ok">Passes {tally.passes}</b>
                  </p>
                )}
              </>
            )}
          </div>
        )}
        <div className="min-w-0">
          {statTiles && statTiles.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              {statTiles.map((t) => (
                <StatTile key={t.label} label={t.label} value={t.value} />
              ))}
            </div>
          )}
          {groups?.map((g) => (
            <section key={g.name}>
              <h3 className="text-kicker uppercase text-t3 flex items-center gap-3 mt-4 after:flex-1 after:h-px after:bg-b1">{g.name}</h3>
              {g.rows.map((r, i) => (
                <div key={i} className="grid grid-cols-[20px_1fr_160px] gap-2.5 py-2 border-t border-hair text-row">
                  <StatusDot status={r.status} />
                  <div className="min-w-0">
                    <span className="text-t1">{r.name}</span>
                    {r.detail && (r.detail.length > 120 ? (
                      <details className="text-meta text-t3">
                        <summary>Detail</summary>
                        {r.detail}
                      </details>
                    ) : (
                      <p className="prose-ib text-meta text-t3">{r.detail}</p>
                    ))}
                  </div>
                  <span className={`text-right tnum ${VALUE_TEXT[r.status]}`}>{r.value}</span>
                </div>
              ))}
            </section>
          ))}
          {children}
        </div>
      </div>
    </section>
  );
}
