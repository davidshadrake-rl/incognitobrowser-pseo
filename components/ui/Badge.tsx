'use client';

const colorMap: Record<string, string> = {
  critical: 'bg-red-500/15 text-red-400 border border-red-500/20',
  high: 'bg-orange-500/15 text-orange-400 border border-orange-500/20',
  medium: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
  low: 'bg-green-500/15 text-green-400 border border-green-500/20',
  beginner: 'bg-green-500/15 text-green-400 border border-green-500/20',
  intermediate: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  advanced: 'bg-purple-500/15 text-purple-400 border border-purple-500/20',
  yes: 'bg-green-500/15 text-green-400 border border-green-500/20',
  no: 'bg-red-500/15 text-red-400 border border-red-500/20',
  partial: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
  excellent: 'bg-green-500/15 text-green-400 border border-green-500/20',
  good: 'bg-blue-500/15 text-blue-400 border border-blue-500/20',
  fair: 'bg-yellow-500/15 text-yellow-400 border border-yellow-500/20',
  poor: 'bg-red-500/15 text-red-400 border border-red-500/20',
};

export function Badge({ label, variant }: { label: string; variant?: string }) {
  const color = variant ? (colorMap[variant] || 'bg-white/5 text-[#B8B8D4] border border-white/10') : 'bg-white/5 text-[#B8B8D4] border border-white/10';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${color}`}>
      {label}
    </span>
  );
}
