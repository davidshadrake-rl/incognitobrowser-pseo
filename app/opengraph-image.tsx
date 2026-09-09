import { ImageResponse } from 'next/og'
import { ICON_PATHS } from '@/components/ui/Icon'
import { IS_PRO_DEPLOYMENT } from '@/lib/tiers'

export const dynamic = 'force-static'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

// Design tokens (app/globals.css). Satori cannot read CSS custom properties,
// so the values are repeated here verbatim.
const BASE = '#000000'
const T2 = '#b8b8d4'
const T3 = '#8c8ca6'
const PRO = '#41b4f6'
// --scan-grid: 1px lines every 24px at 3% white, both axes.
const SCAN_GRID =
  'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)'

/**
 * Turn an ICON_PATHS string (static literal: <path d=.../> and <circle .../>
 * only) into SVG JSX primitives. Satori renders JSX, not innerHTML, so the hat
 * glyph is drawn from the same path data the site uses, without a sprite.
 */
function primitives(markup: string) {
  const out: React.ReactNode[] = []
  const tag = /<(path|circle|rect)\s+([^>]*?)\/>/g
  let m: RegExpExecArray | null
  let i = 0
  while ((m = tag.exec(markup))) {
    const attrs: Record<string, string> = {}
    for (const a of m[2].matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[a[1]] = a[2]
    const Tag = m[1] as 'path' | 'circle' | 'rect'
    out.push(<Tag key={i++} {...attrs} />)
  }
  return out
}

export default function OGImage() {
  const kicker = IS_PRO_DEPLOYMENT ? 'INCOGNITO BROWSER · PRO TOOLS' : 'INCOGNITO BROWSER · PRIVACY RESOURCES'
  const title = IS_PRO_DEPLOYMENT ? 'Incognito Pro Tools' : 'Know what the web sees. Then hide it.'
  const rule = IS_PRO_DEPLOYMENT ? PRO : '#ffffff'

  return new ImageResponse(
    (
      <div
        style={{
          background: BASE,
          backgroundImage: SCAN_GRID,
          backgroundSize: '24px 24px',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          padding: '72px 96px',
          fontFamily: 'monospace',
        }}
      >
        {/* The hat glyph: the brand character, drawn from ICON_PATHS.hat */}
        <svg
          viewBox="0 0 24 24"
          width={160}
          height={160}
          fill="none"
          stroke={T2}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ marginBottom: '32px' }}
        >
          {primitives(ICON_PATHS.hat)}
        </svg>

        {/* Title */}
        <div
          style={{
            color: '#ffffff',
            fontSize: '56px',
            fontWeight: 600,
            lineHeight: 1.15,
            letterSpacing: '-1px',
            display: 'flex',
            maxWidth: '1000px',
          }}
        >
          {title}
        </div>

        {/* Rule */}
        <div style={{ width: '120px', height: '4px', background: rule, marginTop: '28px', marginBottom: '24px', display: 'flex' }} />

        {/* Kicker */}
        <div
          style={{
            color: T3,
            fontSize: '22px',
            letterSpacing: '3px',
            display: 'flex',
          }}
        >
          {kicker}
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
