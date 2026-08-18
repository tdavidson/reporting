import { ImageResponse } from 'next/og'
import { DEFAULT_MARK_HEX, MARK_PATHS, MARK_STROKE_UNITS, MARK_VIEWBOX, markGeometry } from '@/lib/pwa'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

// The browser-tab favicon. The home-screen icon is app/api/pwa-icon, which draws the
// same mark large and in the fund's accent; this one stays neutral because it is
// rendered at build time, where there is no fund to read.
//
// Geometry comes from markGeometry rather than being written out here. This icon used
// to draw a 21px mark centred by flexbox on a 32px canvas — a 1.75px stroke at a
// half-pixel offset, which is why the icon looked soft: most of its ink landed as
// half-covered grey. markGeometry snaps it to a 24px mark at whole-pixel padding, so
// a 2px stroke covers exactly two pixels. See the note there.
export default function Icon() {
  const { markPx, padTop, padLeft } = markGeometry(size.width)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          // Not centred: flexbox centring is what put the mark on a half pixel.
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          paddingTop: padTop,
          paddingLeft: padLeft,
          background: 'white',
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={markPx}
          height={markPx}
          viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
          fill="none"
          stroke={DEFAULT_MARK_HEX}
          strokeWidth={MARK_STROKE_UNITS}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {MARK_PATHS.map(d => (
            <path key={d} d={d} />
          ))}
        </svg>
      </div>
    ),
    { ...size }
  )
}
