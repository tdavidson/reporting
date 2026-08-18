import { ImageResponse } from 'next/og'
import { DEFAULT_MARK_HEX, MARK_PATHS, MARK_VIEWBOX, markGeometry } from '@/lib/pwa'

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
//
// This one keeps that 2px stroke while the home-screen icons above it thin out: at 32px
// the mark is only 24px across, and the lighter weight they use would be a hairline
// here. markGeometry's floor is what holds it.
export default function Icon() {
  const { markPx, padTop, padLeft, strokeUnits } = markGeometry(size.width)

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
          strokeWidth={strokeUnits}
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
