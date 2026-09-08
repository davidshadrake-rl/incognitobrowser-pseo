import type { Grade } from '@/lib/site-grade';

const STYLE: Record<Grade, string> = {
  A: 'bg-green-500/15 text-green-300 border-green-500/30',
  B: 'bg-lime-500/15 text-lime-300 border-lime-500/30',
  C: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  D: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  F: 'bg-red-500/15 text-red-300 border-red-500/30',
};

export function GradeBadge({ grade, size = 'md' }: { grade: Grade; size?: 'sm' | 'md' | 'xl' }) {
  const dims = size === 'xl' ? 'w-24 h-24 text-5xl' : size === 'sm' ? 'w-7 h-7 text-sm' : 'w-10 h-10 text-lg';
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg border font-bold ${dims} ${STYLE[grade]}`}
      aria-label={`Grade ${grade}`}
      data-grade={grade}
    >
      {grade}
    </span>
  );
}
