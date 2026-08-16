import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { SURFACE_LIGHT_HEX, isIconSize, loadPwaBrand, type IconSize } from '@/lib/pwa'

// Home-screen and install icons, in the fund's accent. The same mark app/icon.tsx
// draws for the browser tab, rendered large.
//
// Node rather than edge (app/api/og uses edge): this reads the fund's theme through
// loadPwaBrand, and app/icon.tsx already proves ImageResponse renders fine here.
export const runtime = 'nodejs'

/**
 * Fraction of the canvas the mark occupies.
 *
 * Android crops a maskable icon to whatever shape the launcher uses — circle,
 * squircle, teardrop — and only the middle 80% of the width is guaranteed to
 * survive. Two thirds of that is the mark, which leaves the corners of the
 * background to be eaten without touching the drawing.
 */
const MARK_SCALE = { any: 0.66, maskable: 0.5 } as const

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  // Allowlisted, not clamped: this endpoint is unauthenticated, and an open
  // "render me a PNG of any dimension" is a cheap way to spend someone's compute.
  const requested = Number(searchParams.get('size'))
  const size: IconSize = isIconSize(requested) ? requested : 192
  const maskable = searchParams.get('maskable') === '1'

  const { markHex } = await loadPwaBrand()
  const markPx = Math.round(size * MARK_SCALE[maskable ? 'maskable' : 'any'])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: SURFACE_LIGHT_HEX,
        }}
      >
        {/* Same paths as app/icon.tsx. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={markPx}
          height={markPx}
          viewBox="0 0 24 24"
          fill="none"
          stroke={markHex}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" />
          <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" />
          <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" />
          <path d="M10 6h4" />
          <path d="M10 10h4" />
          <path d="M10 14h4" />
          <path d="M10 18h4" />
        </svg>
      </div>
    ),
    {
      width: size,
      height: size,
      headers: {
        // Not immutable: an admin can change the accent in Settings → Appearance,
        // and the icon should follow within the hour rather than at reinstall.
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    }
  )
}

export const dynamic = 'force-dynamic'
