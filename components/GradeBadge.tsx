import type { Grade } from '@/lib/site-grade';

const STYLE: Record<Grade, string> = {
  A: 'bg-ok-dim text-ok border-ok/30',
  B: 'bg-ok-dim text-ok border-ok/30',
  C: 'bg-warn-dim text-warn border-warn/30',
  D: 'bg-danger-dim text-danger border-danger/30',
  F: 'bg-danger-dim text-danger border-danger/30',
};

export function GradeBadge({ grade, size = 'md' }: { grade: Grade; size?: 'sm' | 'md' | 'xl' }) {
  const dims = size === 'xl' ? 'w-24 h-24 text-5xl' : size === 'sm' ? 'w-7 h-7 text-sm' : 'w-10 h-10 text-lg';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg border font-mono font-bold ${dims} ${STYLE[grade]}`}
      aria-label={`Grade ${grade}`}
      data-grade={grade}
    >
      {grade}
    </span>
  );
}
