/**
 * The one chip (DESIGN-SPEC 5.9). Absorbs the hand-rolled tier / processing /
 * severity / difficulty chips. Blue is Pro and nothing else; status variants
 * always carry a word, never colour alone.
 *
 * Server-safe (no hooks) so it renders in both server and client trees.
 */
import { PRO_DEFINITION, PRO_FREE_FOR_NOW_TITLE, PRO_WEB_GATED } from '@/lib/tiers';

export type BadgeVariant = 'free' | 'pro' | 'client' | 'server' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'difficulty' | 'grade';

const LOOK: Record<BadgeVariant, string> = {
  free:    'border-ok/30 text-ok',
  pro:     'border-pro text-pro bg-pro-dim',
  client:  'border-b1 text-t2',
  server:  'border-b1 text-t2',
  ok:      'border-ok/30 text-ok bg-ok-dim',
  warn:    'border-warn/30 text-warn bg-warn-dim',
  danger:  'border-danger/30 text-danger bg-danger-dim',
  info:    'border-b1 text-info bg-info-dim',
  neutral: 'border-b1 text-t2',
  difficulty: 'border-b1 text-t2', grade: 'border-b1 text-t1',
};

/** Old colorMap keys (priority / difficulty / yes-no / rating) → variants. */
const LEGACY: Record<string, BadgeVariant> = {
  critical: 'danger', high: 'danger', no: 'danger', poor: 'danger',
  medium: 'warn', partial: 'warn', fair: 'warn',
  low: 'ok', beginner: 'ok', yes: 'ok', excellent: 'ok',
  intermediate: 'info', good: 'info',
  advanced: 'neutral',
};

const LABEL: Partial<Record<BadgeVariant, string>> = {
  free: 'Free tool',
  client: 'runs in your browser',
  server: 'server-assisted',
};

const TITLE: Partial<Record<BadgeVariant, string>> = {
  free: 'Free, no account, stays free.',
  server: 'Asks our server once. Never logged.',
};

export function resolveBadgeVariant(variant?: string): BadgeVariant {
  if (!variant) return 'neutral';
  if (variant in LOOK) return variant as BadgeVariant;
  return LEGACY[variant.toLowerCase()] ?? 'neutral';
}

export function Badge({
  variant,
  label,
  title,
  compact = false,
  className = '',
}: {
  variant?: BadgeVariant | string;
  /** Visible text. Defaults per variant (free "Free tool", pro "free for now" / "Pro tool", client, server). */
  label?: string;
  title?: string;
  /** Pro only: render the blue block alone, no label. */
  compact?: boolean;
  className?: string;
}) {
  const v = resolveBadgeVariant(variant);
  const isPro = v === 'pro';
  const text = label ?? (isPro ? (PRO_WEB_GATED ? 'Pro tool' : 'free for now') : LABEL[v]);
  const tip = title ?? (isPro ? (PRO_WEB_GATED ? PRO_DEFINITION : PRO_FREE_FOR_NOW_TITLE) : TITLE[v]);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[4px] border px-1.5 py-0.5 font-mono text-[11px] tracking-[.04em] ${LOOK[v]} ${className}`}
      title={tip}
      data-badge={v}
    >
      {isPro && <b className="bg-pro text-black px-1 rounded-[2px] font-semibold">PRO</b>}
      {!(isPro && compact) && text}
    </span>
  );
}
