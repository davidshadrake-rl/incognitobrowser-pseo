/**
 * The one chip (DESIGN-SPEC 5.9). Absorbs the hand-rolled tier / severity /
 * difficulty chips. Blue is Pro and nothing else; status variants always
 * carry a word, never colour alone.
 *
 * The client / server processing chip was removed (CTO review, 2026-09-10):
 * it was a reassurance slogan, not something a visitor acts on. Functional
 * disclosures (a button that fetches through our server) live in the tool.
 *
 * Server-safe (no hooks) so it renders in both server and client trees.
 */
import { PRO_DEFINITION } from '@/lib/tiers';

export type BadgeVariant = 'free' | 'pro' | 'ok' | 'warn' | 'danger' | 'info' | 'neutral' | 'difficulty' | 'grade';

const LOOK: Record<BadgeVariant, string> = {
  free:    'border-ok/30 text-ok',
  pro:     'border-pro text-pro bg-pro-dim',
  ok:      'border-ok/30 text-ok bg-ok-dim',
  warn:    'border-warn/30 text-warn bg-warn-dim',
  danger:  'border-danger/30 text-danger bg-danger-dim',
  info:    'border-b1 text-info bg-info-dim',
  neutral: 'border-b1 text-t2',
  difficulty: 'border-b1 text-t2', grade: 'border-b1 text-t1',
};

/**
 * Old colorMap keys (priority / difficulty / yes-no / rating) → variants.
 * "Good" is a positive rating, so it is green like "Excellent" (the word
 * tells them apart); on info it was drawn in the secondary-text grey and
 * read as switched off next to a green "Yes".
 * A low priority and a difficulty are not results: green means done on a
 * checklist, so "low" and "beginner" drawn green read as already finished.
 * Low is neutral, and every difficulty uses the neutral difficulty chip.
 */
const LEGACY: Record<string, BadgeVariant> = {
  critical: 'danger', high: 'danger', no: 'danger', poor: 'danger',
  medium: 'warn', partial: 'warn', fair: 'warn',
  yes: 'ok', excellent: 'ok', good: 'ok',
  low: 'neutral',
  beginner: 'difficulty', intermediate: 'difficulty', advanced: 'difficulty',
};

const LABEL: Partial<Record<BadgeVariant, string>> = {
  free: 'Free tool',
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
  /** Visible text. Defaults per variant (free "Free tool"; pro is the PRO block alone). */
  label?: string;
  title?: string;
  /** Pro only: render the blue block alone, no label. */
  compact?: boolean;
  className?: string;
}) {
  const v = resolveBadgeVariant(variant);
  const isPro = v === 'pro';
  // Owner, 2026-09-17: a Pro tool is labelled PRO, like anything else you pay
  // for. The badge used to hedge that the tool cost nothing on the web yet,
  // which taught visitors Pro was a label rather than a product, and left the
  // result card to do the whole job of selling.
  const text = label ?? (isPro ? undefined : LABEL[v]);
  const tip = title ?? (isPro ? PRO_DEFINITION : undefined);
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
