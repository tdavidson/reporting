import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import {
  MARK_PATHS,
  MARK_VIEWBOX,
  SURFACE_LIGHT_HEX,
  isIconSize,
  isIconVariant,
  loadPwaBrand,
  markGeometry,
  type IconSize,
  type IconVariant,
} from '@/lib/pwa'

// Home-screen and install icons, in the fund's accent. The same mark app/icon.tsx
// draws for the browser tab, rendered large.
//
// Node rather than edge (app/api/og uses edge): this reads the fund's theme through
// loadPwaBrand, and app/icon.tsx already proves ImageResponse renders fine here.
export const runtime = 'nodejs'

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

  // Whole-pixel size and offset, and an even-pixel stroke, so the mark's edges cover
  // whole pixels instead of straddling them. The stroke is also lighter than the Lucide
  // glyph it comes from — a toolbar weight blown up to 512px closes the drawing in.
  // markGeometry explains both.
  const { markPx, padTop, padLeft, strokeUnits } = markGeometry(size, maskable)

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          // Deliberately not centred — see markGeometry.
          alignItems: 'flex-start',
          justifyContent: 'flex-start',
          paddingTop: padTop,
          paddingLeft: padLeft,
          background,
        }}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width={markPx}
          height={markPx}
          viewBox={`0 0 ${MARK_VIEWBOX} ${MARK_VIEWBOX}`}
          fill="none"
          stroke={stroke}
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
