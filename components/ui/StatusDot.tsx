/**
 * Status indicator (DESIGN-SPEC 5.4): dot + glyph + word, never colour
 * alone. The word is a screen-reader label by default because the visible
 * value column next to it already carries the word (e.g. "Fail · exposed");
 * pass `label` to make it visible here too. Server component.
 */
import { Icon, type IconName } from './Icon';

export type Status = 'ok' | 'warn' | 'danger' | 'info';

const DOT_CLASS: Record<Status, string> = {
  ok: 'bg-ok',
  warn: 'bg-warn',
  danger: 'bg-danger',
  info: 'bg-info',
};

const GLYPH: Record<Status, IconName> = {
  ok: 'check',
  warn: 'warn',
  danger: 'x',
  info: 'info',
};

const WORD: Record<Status, string> = {
  ok: 'pass',
  warn: 'warn',
  danger: 'fail',
  info: 'info',
};

export function StatusDot({ status, label, className = '' }: { status: Status; label?: string; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <i className={`w-2 h-2 rounded-full ${DOT_CLASS[status]}`} aria-hidden="true" />
      <Icon name={GLYPH[status]} size={12} />
      <span className="sr-only">{label ?? WORD[status]}</span>
    </span>
  );
}
