// The installable-app layer: the web app manifest, and the colours a browser paints
// around the app before any of our CSS has loaded.
//
// Everything user-facing here is per-fund brandable for the same reason the rest of
// the UI is (DESIGN.md): a partner installs this on their phone, and the name under
// the icon should be their fund's, not ours.
//
// Deliberately NOT branded off `funds.logo_url`. Fund logos in this app are
// wordmarks sized for a page header — squeezing one into a 192px square, and then
// letting Android crop it to a circle, produces something worse than a clean mark.
// The accent is the axis the theme model actually exposes (lib/theme.ts), so that is
// what the icon picks up. A dedicated square icon per fund is the natural follow-up.

import { unstable_cache } from 'next/cache'
import type { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidHsl, hslToHex, type FundTheme } from '@/lib/theme'

/**
 * The app surface, as `--background` in app/globals.css `:root` and `.dark`.
 *
 * Duplicated here because a manifest needs a literal colour and cannot read a CSS
 * variable. lib/pwa.test.ts parses globals.css and fails if these drift, so the
 * duplication cannot rot quietly.
 */
export const SURFACE_LIGHT_HSL = '40 20% 99%'
export const SURFACE_DARK_HSL = '40 6% 11%'

export const SURFACE_LIGHT_HEX = hslToHex(SURFACE_LIGHT_HSL)!
export const SURFACE_DARK_HEX = hslToHex(SURFACE_DARK_HSL)!

/**
 * Stroke colour of the default mark, matching app/icon.tsx.
 *
 * An unthemed deployment gets the same mark in the browser tab and on the home
 * screen, so the two read as one product. A fund that sets an accent gets the mark
 * in its own colour instead.
 */
export const DEFAULT_MARK_HEX = '#52525b'

export const DEFAULT_APP_NAME = 'Portfolio Reporting'
export const DEFAULT_SHORT_NAME = 'Portfolio'

/** The sizes the manifest and the apple-touch-icon link ask for. */
export const ICON_SIZES = [180, 192, 512] as const
export type IconSize = (typeof ICON_SIZES)[number]

export function isIconSize(n: number): n is IconSize {
  return (ICON_SIZES as readonly number[]).includes(n)
}

export interface PwaBrand {
  /** Full name — install prompts and app switchers have room for this. */
  name: string
  /** What iOS and Android actually render under a home-screen icon. */
  shortName: string
  /** Mark colour as hex: the fund's accent when themed, else the default neutral. */
  markHex: string
}

export const DEFAULT_BRAND: PwaBrand = {
  name: DEFAULT_APP_NAME,
  shortName: DEFAULT_SHORT_NAME,
  markHex: DEFAULT_MARK_HEX,
}

/**
 * Home-screen labels are clipped around twelve characters on both platforms, and
 * the clip is silent — "Evergreen Ca" looks like a bug rather than a name.
 *
 * So drop whole words instead of characters: "Evergreen Capital Partners" becomes
 * "Evergreen", which still reads as the fund. Only a single word longer than the
 * budget gets cut mid-way, because there is nothing else to do with it.
 */
const SHORT_NAME_MAX = 12

export function shortNameFor(name: string | null | undefined): string {
  const clean = (name ?? '').trim().replace(/\s+/g, ' ')
  if (!clean) return DEFAULT_SHORT_NAME
  if (clean.length <= SHORT_NAME_MAX) return clean

  let acc = ''
  for (const word of clean.split(' ')) {
    const next = acc ? `${acc} ${word}` : word
    if (next.length > SHORT_NAME_MAX) break
    acc = next
  }
  return acc || clean.slice(0, SHORT_NAME_MAX).trimEnd()
}

/** The mark colour for a raw `fund_settings.theme` blob. */
export function markHexFor(theme: FundTheme | null | undefined): string {
  const accent = theme?.accent
  // Validate at read time, not just on write — this value ends up in an image and in
  // JSON served to the browser, and a direct DB write bypasses the settings form.
  if (!accent || !isValidHsl(accent)) return DEFAULT_MARK_HEX
  return hslToHex(accent) ?? DEFAULT_MARK_HEX
}

/**
 * The fund's name and accent, for the manifest and the icon route.
 *
 * A deployment hosts one fund (app/(app)/layout.tsx resolves it the same way), so
 * this needs no session — which matters, because a manifest is fetched without
 * credentials.
 *
 * Never throws. It runs on a fresh install with no fund row, and during a build with
 * no database reachable at all; both fall back to the unbranded defaults rather than
 * failing the request that a browser needs in order to install the app.
 */
export const loadPwaBrand = unstable_cache(
  async (): Promise<PwaBrand> => {
    try {
      const admin = createAdminClient()
      const { data: fund } = await admin.from('funds').select('id, name').limit(1).single()
      if (!fund) return DEFAULT_BRAND

      // Cast: `theme` is a recently-added column not yet in the generated types.
      const { data: settings } = await (admin as any)
        .from('fund_settings')
        .select('theme')
        .eq('fund_id', fund.id)
        .maybeSingle()

      const name = fund.name?.trim() || DEFAULT_APP_NAME
      return {
        name,
        shortName: shortNameFor(name),
        markHex: markHexFor((settings?.theme as FundTheme | null) ?? null),
      }
    } catch {
      return DEFAULT_BRAND
    }
  },
  ['pwa-brand'],
  // Same tags the app shell's fund queries carry, so renaming the fund or changing
  // the accent in Settings → Appearance flushes the manifest with everything else.
  { tags: ['fund-data', 'fund-settings'], revalidate: 300 }
)

function iconEntry(size: IconSize, maskable: boolean) {
  return {
    src: `/api/pwa-icon?size=${size}${maskable ? '&maskable=1' : ''}`,
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: maskable ? ('maskable' as const) : ('any' as const),
  }
}

/**
 * The manifest itself. Pure, so the interesting decisions are testable without a
 * database.
 *
 * `start_url` is the manager's dashboard: this is an app for the people who run the
 * fund, and an LP arriving there would be bounced by the app layout. The LP portal
 * wants its own manifest — different name, different icon, `start_url: /portal` —
 * linked from the portal layout. That is a separate piece of work, noted in DOCS.md.
 */
export function buildManifest(brand: PwaBrand): MetadataRoute.Manifest {
  return {
    id: '/',
    name: brand.name,
    short_name: brand.shortName,
    description: 'Portfolio, fund and LP reporting.',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    // The app surface, not the accent: the chrome around this app is neutral, and
    // `--primary` is an action colour (DESIGN.md). A saturated title bar wrapped
    // around a near-white app reads as someone else's brand bleeding in.
    background_color: SURFACE_LIGHT_HEX,
    theme_color: SURFACE_LIGHT_HEX,
    icons: [iconEntry(192, false), iconEntry(512, false), iconEntry(192, true), iconEntry(512, true)],
  }
}
