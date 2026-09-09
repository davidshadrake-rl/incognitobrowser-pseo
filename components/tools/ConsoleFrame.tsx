'use client';

/**
 * Console shell (DESIGN-SPEC 5.4, lines 542-577): wraps the RESULT markup of
 * the 8 heaviest engines (browser-privacy, cookie-analyzer, url-analyzer,
 * metadata-viewer, whats-my-ip, dns-leak-test, ad-blocker-test,
 * password-strength) in a shared "product console" frame — a header strip
 * (status dot + engine name + optional checks count + processing mode +
 * time), an optional Gauge/tally left column, and a right column carrying a
 * glance StatTile row plus the tool's own detailed result markup.
 *
 * This component only lays out what each tool already computed. It never
 * invents a score, a check count, or a status — callers pass their own
 * report()-bound values straight through (`statusFromSeverity` below maps
 * the existing result-bus Severity to the header/row status vocabulary so
 * nothing has to be recomputed twice).
 */
import { useMemo, type ReactNode } from 'react';
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
  checks,
  processing,
  score,
  gaugeLabel = 'score',
  tally,
  statTiles,
  groups,
  left,
  children,
}: {
  /** The engine id, e.g. "browser-privacy". Also the data-console value. */
  engine: string;
  status: Status;
  /** Live count of things this run checked. Omit when the engine has no single natural count. */
  checks?: number;
  processing: 'client' | 'server';
  /** 0-100. Renders the Gauge. Omit when the engine has no single score (leave `left` or nothing). */
  score?: number;
  gaugeLabel?: string;
  tally?: { fails: number; warns: number; passes: number };
  /** Glance row (DESIGN-SPEC "Glance summaries"). Reuse the same stats already passed to report() — never invent new ones. */
  statTiles?: Array<{ label: string; value: string | number }>;
  /** Grouped status rows, when the engine's result is naturally a checklist. */
  groups?: ConsoleGroup[];
  /** Custom left-column content, replacing the Gauge + tally. */
  left?: ReactNode;
  /** The tool's own detailed result markup, rendered after statTiles/groups. */
  children?: ReactNode;
}) {
  // Fixed once per mount (the console appears only after a result exists, so
  // there's nothing to hydrate against on the server render).
  const time = useMemo(() => new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }), []);

  return (
    <section className="console bg-s0 border border-b1 rounded-[16px] overflow-hidden font-mono" data-console={engine}>
      <header className="flex items-center gap-2.5 px-4 py-2.5 border-b border-b1 bg-gradient-to-b from-s1 to-s0 text-meta text-t2">
        <span className={`w-2 h-2 rounded-full ${HEADER_DOT[status]}`} aria-hidden="true" />
        <span className="text-t1">{engine}</span>
        {typeof checks === 'number' && <span>&middot; {checks} {checks === 1 ? 'check' : 'checks'}</span>}
        <span>&middot; {processing === 'server' ? 'via our server' : 'local only'}</span>
        <time className="ml-auto tnum text-t3">{time}</time>
      </header>
      <div className="grid md:grid-cols-[200px_1fr] gap-6 p-5">
        <div>
          {left ?? (
            <>
              {typeof score === 'number' && <Gauge score={score} label={gaugeLabel} />}
              {tally && (
                <p className="text-row tnum mt-2">
                  <b className="text-danger">Fails {tally.fails}</b> &middot; <b className="text-warn">Warns {tally.warns}</b> &middot; <b className="text-ok">Passes {tally.passes}</b>
                </p>
              )}
            </>
          )}
        </div>
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
