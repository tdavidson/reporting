import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import {
  SURFACE_LIGHT_HEX,
  isIconSize,
  isIconVariant,
  loadPwaBrand,
  type IconSize,
  type IconVariant,
} from '@/lib/pwa'

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

  const requestedVariant = searchParams.get('variant') ?? 'app'
  const variant: IconVariant = isIconVariant(requestedVariant) ? requestedVariant : 'app'

  const { markHex, portalFillHex } = await loadPwaBrand()

  // The LP portal runs the mark inverted — filled tile, mark knocked out — so the two
  // installed apps are told apart by solid-versus-hollow rather than by two different
  // drawings. portalFillHex is the ramp's 700 stop precisely so the knockout stays
  // legible on every accent; see lib/pwa.ts.
  const background = variant === 'portal' ? portalFillHex : SURFACE_LIGHT_HEX
  const stroke = variant === 'portal' ? SURFACE_LIGHT_HEX : markHex

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
          background,
        }}
      >
        {/* Same paths as app/icon.tsx. */}
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={markPx}
          height={markPx}
          viewBox="0 0 24 24"
          fill="none"
          stroke={stroke}
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
