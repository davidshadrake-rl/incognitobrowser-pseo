import Link from 'next/link';
import { Badge } from './Badge';

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
      <div className="border border-b1 rounded-lg p-6 hover:border-b2 bg-s0 transition-all">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            {badge && <Badge label={badge} className="mb-2" />}
            <h3 className="text-lg font-semibold text-white group-hover:text-t2 transition-colors">
              {title}
            </h3>
            <p className="mt-2 text-sm text-t2 line-clamp-2">{description}</p>
          </div>
          {icon && <div className="ml-4 text-white/30 group-hover:text-white/60">{icon}</div>}
        </div>
      </div>
    </Link>
  );
}
