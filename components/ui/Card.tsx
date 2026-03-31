import Link from 'next/link';

interface CardProps {
  title: string;
  description: string;
  href: string;
  badge?: string;
  icon?: React.ReactNode;
}

export function Card({ title, description, href, badge, icon }: CardProps) {
  return (
    <Link href={href} className="block group">
      <div className="border border-white/10 rounded-lg p-6 hover:border-white/30 bg-[#0a0a0a] transition-all">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {badge && (
              <span className="inline-block px-2 py-1 text-xs font-medium bg-white/5 text-[#B8B8D4] border border-white/10 rounded mb-2">
                {badge}
              </span>
            )}
            <h3 className="text-lg font-semibold text-white group-hover:text-[#cfcfcf] transition-colors">
              {title}
            </h3>
            <p className="mt-2 text-sm text-[#B8B8D4] line-clamp-2">{description}</p>
          </div>
          {icon && <div className="ml-4 text-white/30 group-hover:text-white/60">{icon}</div>}
        </div>
      </div>
    </Link>
  );
}
