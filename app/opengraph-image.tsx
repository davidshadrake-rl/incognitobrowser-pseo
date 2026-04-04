import { ImageResponse } from 'next/og'

export const size = {
  width: 1200,
  height: 630,
}

export const contentType = 'image/png'

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #000000 0%, #1a0a1e 50%, #0a0a0a 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'monospace',
          position: 'relative',
        }}
      >
        {/* Subtle grid overlay */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            display: 'flex',
          }}
        />

        {/* Top border accent */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: '4px',
            background: 'linear-gradient(90deg, transparent, rgba(184, 184, 212, 0.6), transparent)',
            display: 'flex',
          }}
        />

        {/* IB Logo Circle */}
        <div
          style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            border: '3px solid white',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '30px',
          }}
        >
          <span
            style={{
              color: 'white',
              fontSize: '28px',
              fontWeight: 700,
              letterSpacing: '-1px',
            }}
          >
            IB
          </span>
        </div>

        {/* Brand name */}
        <div
          style={{
            color: 'white',
            fontSize: '48px',
            fontWeight: 700,
            letterSpacing: '2px',
            textTransform: 'uppercase' as const,
            marginBottom: '12px',
            display: 'flex',
          }}
        >
          Incognito Browser
        </div>

        {/* Tagline */}
        <div
          style={{
            color: '#B8B8D4',
            fontSize: '24px',
            letterSpacing: '4px',
            textTransform: 'uppercase' as const,
            display: 'flex',
          }}
        >
          Privacy Resources
        </div>

        {/* Bottom info bar */}
        <div
          style={{
            position: 'absolute',
            bottom: '40px',
            display: 'flex',
            alignItems: 'center',
            gap: '24px',
          }}
        >
          <span style={{ color: 'rgba(184, 184, 212, 0.5)', fontSize: '14px', letterSpacing: '2px' }}>
            incognitobrowser.io
          </span>
        </div>
      </div>
    ),
    {
      ...size,
    }
  )
}
