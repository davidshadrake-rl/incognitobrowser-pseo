/**
 * Value shell (DESIGN-SPEC 5.4 sibling): the presentational frame for a tool
 * whose result IS a value, not a verdict — a generated password, a hex
 * digest, a block of ciphertext. Same design language as ConsoleFrame (same
 * tokens, border, radius, mono face, the same StatTile row for supporting
 * facts) but deliberately missing everything ConsoleFrame uses to render a
 * judgement: no status dot, no Gauge, no fails/warns/passes tally, no run
 * timestamp.
 *
 * WHY THIS EXISTS SEPARATELY FROM CONSOLEFRAME:
 *   ConsoleFrame's header states a verdict at a glance (status dot + word)
 *   and its left column exists to hold a score or a tally. A password, a
 *   hash, or a block of ciphertext has no pass/fail, no 0-100 score, and
 *   often no discrete "run" a timestamp could describe — the value
 *   regenerates live as the visitor drags a slider or types. Forcing one of
 *   these into ConsoleFrame means inventing a verdict that doesn't exist
 *   (a green dot for... what, exactly?) or leaving the left column empty.
 *   ValueCard is the honest shape for "here is the value you asked for":
 *   a label, the value itself, and the facts that describe it — nothing
 *   that implies the value was graded.
 *
 * A future engine that outputs a value (a generated key, a decoded token,
 * a QR code payload) should reach for this, not bend ConsoleFrame to fit.
 */
import type { ReactNode } from 'react';
import { StatTile } from '@/components/ui/StatTile';

export function ValueCard({
  label,
  value,
  actions,
  statTiles,
  meta,
  children,
  valueClassName = '',
  as = 'div',
}: {
  /** Header title, e.g. "Generated Password", "SHA-256", "Encrypted Output". */
  label: string;
  /** The value itself. Rendered as the ONLY content of the mono value box — pass a plain string so copy/selection targets exactly the value, nothing else. */
  value: ReactNode;
  /** Copy/verify/etc. buttons, right-aligned in the header. The engine's own handlers — this component never wraps or rewrites them. */
  actions?: ReactNode;
  /** Supporting facts drawn from what the engine already computed — entropy bits, algorithm count, iteration count. Never invented here. */
  statTiles?: Array<{ label: string; value: string | number }>;
  /** Small inline facts under the value (e.g. "20 characters"), when a stat tile would be overkill. */
  meta?: ReactNode;
  /** Extra content below the value box. */
  children?: ReactNode;
  /** Extra classes for the value box, e.g. sizing. `font-mono` is always applied; a `text-*` colour here replaces the default `text-white`. */
  valueClassName?: string;
  /** Element the value renders in. `code` for a digest, `pre` for multi-line ciphertext, `div` (default) otherwise. */
  as?: 'div' | 'code' | 'pre';
}) {
  const ValueTag = as;
  // `text-white` and a token colour like `text-ok` are both single-class rules,
  // so the winner is decided by stylesheet ORDER, not by class-attribute order:
  // Tailwind emits .text-ok before .text-white, which means a hardcoded
  // `text-white` here silently beat HashGenerator's `text-ok` digest. Only
  // apply the default when the caller hasn't asked for its own colour.
  const hasOwnColour = /(^|\s)text-(ok|warn|danger|info|white|t[0-9])(\/|\s|$)/.test(valueClassName);
  return (
    <section className="bg-s0 border border-b1 rounded-[16px] overflow-hidden font-mono">
      <header className="flex items-center gap-2.5 px-4 py-2.5 border-b border-b1 bg-gradient-to-b from-s1 to-s0 text-meta text-t2">
        <span className="text-t1">{label}</span>
        {actions && <div className="ml-auto flex gap-2">{actions}</div>}
      </header>
      <div className="p-5 space-y-3">
        {statTiles && statTiles.length > 0 && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {statTiles.map((t) => (
              <StatTile key={t.label} label={t.label} value={t.value} />
            ))}
          </div>
        )}
        <ValueTag
          className={`block bg-s0 p-4 rounded-md font-mono ${hasOwnColour ? '' : 'text-white'} break-all select-all whitespace-pre-wrap ${valueClassName}`}
        >
          {value}
        </ValueTag>
        {meta && <div className="flex flex-wrap gap-4 text-row text-t2">{meta}</div>}
        {children}
      </div>
    </section>
  );
}
