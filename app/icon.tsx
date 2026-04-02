import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

// Parallax brand mark: 5 horizontal bars converging toward center (perspective/parallax effect)
// Redrawn at 32x32 native for pixel clarity
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '32px',
          height: '32px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f1117',
          borderRadius: '6px',
        }}
      >
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          xmlns="http://www.w3.org/2000/svg"
          fill="white"
        >
          {/* 5 bars converging to center — widest at middle, narrowest at top/bottom */}
          {/* top bar — narrowest */}
          <rect x="5" y="2" width="14" height="2" rx="0.5" />
          {/* upper-mid bar */}
          <rect x="3" y="6.5" width="18" height="2" rx="0.5" />
          {/* center bar — full width, thicker */}
          <rect x="1" y="11" width="22" height="2.5" rx="0.5" />
          {/* lower-mid bar */}
          <rect x="3" y="15.5" width="18" height="2" rx="0.5" />
          {/* bottom bar — narrowest */}
          <rect x="5" y="20" width="14" height="2" rx="0.5" />
        </svg>
      </div>
    ),
    { ...size }
  )
}
