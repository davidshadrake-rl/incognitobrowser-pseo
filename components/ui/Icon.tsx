import type { SVGProps } from 'react';

/**
 * Inline SVG glyphs (DESIGN-SPEC 3.1). One style: 24 grid, 1.75 stroke, round
 * caps, a filled r=.6-1 dot where a detail needs it, no fills otherwise except
 * `star`. Inline per use, not a sprite and not <use href> (basePath differs
 * between deployments; Satori cannot render <use>).
 *
 * Path strings are static literals from this file only; dangerouslySetInnerHTML
 * never receives data. tests/design-guards.test.ts asserts every value matches
 * /^[<>a-zA-Z0-9 ="'./,-]+$/.
 */
export const ICON_PATHS = {
  // engines
  'globe':   '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
  'key':     '<circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/>',
  'finger':  '<path d="M3.5 9.5a9 9 0 0 1 17 0M6 12a6 6 0 0 1 12 0v2M9 12a3 3 0 0 1 6 0v5M12 12v7"/>',
  'lock':    '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r=".75" fill="currentColor"/>',
  'cookie':  '<path d="M20.5 13A8.5 8.5 0 1 1 11 3.5a3.5 3.5 0 0 0 4 4 3.5 3.5 0 0 0 5.5 5.5z"/><circle cx="9" cy="10" r=".6" fill="currentColor"/><circle cx="14" cy="15" r=".6" fill="currentColor"/><circle cx="8.5" cy="15.5" r=".6" fill="currentColor"/>',
  'warn':    '<path d="M12 3.5 21 19.5H3z"/><path d="M12 9.5V14"/><circle cx="12" cy="16.8" r=".6" fill="currentColor"/>',
  'quiz':    '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 12.5h5M8 16h6"/>',
  'hash':    '<path d="M5 9h14M5 15h14M10 4l-2 16M16 4l-2 16"/>',
  'toggle':  '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="15" cy="12" r="2.5"/>',
  'camera':  '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8.5 7 10 4.5h4L15.5 7"/><circle cx="12" cy="13.5" r="3.5"/>',
  'ua':      '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 9h18M7 13h6M7 16h9"/>',
  'dice':    '<rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="8.5" cy="8.5" r=".8" fill="currentColor"/><circle cx="15.5" cy="8.5" r=".8" fill="currentColor"/><circle cx="12" cy="12" r=".8" fill="currentColor"/><circle cx="8.5" cy="15.5" r=".8" fill="currentColor"/><circle cx="15.5" cy="15.5" r=".8" fill="currentColor"/>',
  'link':    '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
  'mail':    '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/><circle cx="17.5" cy="15.5" r="1" fill="currentColor"/>',
  'shot':    '<path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  'drop':    '<path d="M12 3.5s6.5 6.9 6.5 11.3A6.5 6.5 0 0 1 5.5 14.8C5.5 10.4 12 3.5 12 3.5z"/><path d="M9 15a3 3 0 0 0 2 2.8"/>',
  'block':   '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
  // content types
  'book':    '<path d="M12 6.5c-2-1.5-4.5-2-8-2v13c3.5 0 6 .5 8 2 2-1.5 4.5-2 8-2v-13c-3.5 0-6 .5-8 2z"/><path d="M12 6.5v13"/>',
  'list':    '<path d="M9 6h11M9 12h11M9 18h11"/><path d="m3.5 6 1 1 2-2M3.5 12l1 1 2-2M3.5 18l1 1 2-2"/>',
  'vs':      '<path d="M4 8h9M10 5l3 3-3 3M20 16h-9M14 13l-3 3 3 3"/>',
  'calc':    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 7h7M8.5 11.5h1M12 11.5h1M15.5 11.5h1M8.5 15h1M12 15h1M15.5 15v3M8.5 18h1M12 18h1"/>',
  'doc':     '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  'az':      '<path d="M3.5 17 7 7l3.5 10M4.8 13.5h4.4M14 7h6l-6 10h6"/>',
  'grade':   '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="m9 16 3-8 3 8M10 13.2h4"/>',
  'hat':     '<path d="M4 14.5c2.5-1.2 5.3-1.8 8-1.8s5.5.6 8 1.8"/><path d="m7.5 12.8 1.5-6.3c.4-1.4 1.4-2 2.6-1.6l.4.1.4-.1c1.2-.4 2.2.2 2.6 1.6l1.5 6.3"/><circle cx="9" cy="17.5" r="2.2"/><circle cx="15" cy="17.5" r="2.2"/><path d="M11.2 17.5h1.6"/>',
  // status + UI
  'check':   '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  'x':       '<path d="M6 6l12 12M18 6 6 18"/>',
  'info':    '<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".7" fill="currentColor"/>',
  'arrow':   '<path d="M5 12h14M13 6l6 6-6 6"/>',
  'chevron': '<path d="m9 6 6 6-6 6"/>',
  'phone':   '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M10.5 18.5h3"/>',
  'shield':  '<path d="M12 3 4.5 6v6c0 4.5 3.2 7.5 7.5 9 4.3-1.5 7.5-4.5 7.5-9V6z"/><path d="M12 9v6M9 12h6"/>',
  'play':    '<path d="M7 4.5v15l12-7.5z"/>',
  'star':    '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor" stroke="none"/>',
  'search':  '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  'menu':    '<path d="M4 7h16M4 12h16M4 17h16"/>',
  'external':'<path d="M14 4h6v6M20 4l-9 9M18 13v6H5V6h6"/>',
} as const;

export type IconName = keyof typeof ICON_PATHS;

export function Icon({ name, size = 24, className = '', title, ...rest }: { name: IconName; size?: number; className?: string; title?: string } & Omit<SVGProps<SVGSVGElement>, 'name'>) {
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size}
      fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round"
      aria-hidden={title ? undefined : true} role={title ? 'img' : undefined}
      className={`shrink-0 ${className}`}
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : '') + ICON_PATHS[name] }}
      {...rest}
    />
  );
}

/** Tinted square behind an icon. `tone="pro"` is the only coloured tile. */
export function IconTile({ name, size = 40, tone = 'free', className = '' }: { name: IconName; size?: 40 | 32 | 56; tone?: 'free' | 'pro'; className?: string }) {
  const dims = size === 56 ? 'w-14 h-14 rounded-[14px]' : size === 32 ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-[10px]';
  const look = tone === 'pro' ? 'bg-pro-dim border-pro/40 text-pro' : 'bg-s1 border-b1 text-t2';
  return (
    <span className={`inline-flex items-center justify-center border ${dims} ${look} ${className}`}>
      <Icon name={name} size={size === 56 ? 28 : size === 32 ? 16 : 20} />
    </span>
  );
}
