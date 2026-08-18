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
import { NextResponse } from 'next/server'
import type { MetadataRoute } from 'next'
import { createAdminClient } from '@/lib/supabase/admin'
import { isValidHsl, hslToHex, rampFor, type FundTheme } from '@/lib/theme'

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
export const DEFAULT_PORTAL_NAME = 'Investor Portal'

/**
 * Every size the manifest and the apple-touch-icon links ask for.
 *
 * The ladder is deliberately long, because an icon a platform has to RESIZE is the
 * whole reason home-screen icons look soft. Each entry is a slot something actually
 * fills: 152/167/180 are iPad @2x, iPad Pro and iPhone @3x (iOS reads these off the
 * apple-touch-icon links); 192 and 512 are the manifest sizes Chrome requires; 384 is
 * Android's splash; 1024 is what a desktop PWA install carves its dock icon from, and
 * without it macOS upscales the 512.
 */
export const ICON_SIZES = [152, 167, 180, 192, 384, 512, 1024] as const
export type IconSize = (typeof ICON_SIZES)[number]

export function isIconSize(n: number): n is IconSize {
  return (ICON_SIZES as readonly number[]).includes(n)
}

/** The sizes iOS picks between for a home-screen icon. Ordered small to large. */
export const APPLE_TOUCH_SIZES = [152, 167, 180] as const

/**
 * The mark, as the path data both renderers draw.
 *
 * Shared rather than copied so app/icon.tsx (the 32px favicon) and the icon route
 * cannot drift into two different drawings — they were previously kept in step by a
 * comment. Every coordinate is a WHOLE unit of the 24-unit viewBox, which is what
 * makes the snapping in markGeometry below work.
 */
export const MARK_PATHS = [
  'M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z',
  'M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2',
  'M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2',
  'M10 6h4',
  'M10 10h4',
  'M10 14h4',
  'M10 18h4',
] as const

/** The mark's coordinate space. Stroke width is 2 of these units. */
export const MARK_VIEWBOX = 24
export const MARK_STROKE_UNITS = 2

/**
 * Fraction of the canvas the mark aims for.
 *
 * Android crops a maskable icon to whatever shape the launcher uses — circle,
 * squircle, teardrop — and only the middle 80% of the width is guaranteed to
 * survive. Half of that is the mark, which leaves the corners of the background to be
 * eaten without touching the drawing.
 */
const MARK_FRACTION = { any: 0.66, maskable: 0.5 } as const

export interface MarkGeometry {
  /** Rendered width/height of the mark, in device pixels. */
  markPx: number
  /** Distance from the canvas edge to the mark. Whole pixels, deliberately. */
  padTop: number
  padLeft: number
  /** markPx / MARK_VIEWBOX. A whole number, which is the point. */
  scale: number
}

/**
 * Where to draw the mark on a canvas of `size`, so that its strokes land on the pixel
 * grid instead of straddling it.
 *
 * This is the fix for "the icon is blurry". The mark is a 2-unit stroke on a 24-unit
 * grid with whole-unit coordinates, so it rasterises cleanly at any WHOLE-NUMBER
 * scale and smears at every other one: at the old 32px favicon the mark was drawn
 * 21px wide (scale 0.875, a 1.75px stroke) and centred by flexbox at an offset of
 * 30.5px, so more than half the ink in the icon was a half-covered grey pixel.
 *
 * Two rules, both about integers:
 *
 *   - The scale is a whole number, so a stroke is a whole number of pixels wide and
 *     its edges fall between pixels rather than through them. The mark's share of the
 *     canvas then varies a little across the ladder (62–72% for the `any` sizes)
 *     instead of being exactly 66% and soft everywhere.
 *   - The padding is a whole number too, computed here rather than left to flexbox
 *     centring — which lands on a half pixel whenever the canvas and the mark disagree
 *     about parity, and does so for a third of the sizes above. An odd canvas leaves
 *     the spare pixel on the right and bottom; one pixel off centre is invisible, one
 *     pixel of smear across every stroke is not.
 */
export function markGeometry(size: number, maskable = false): MarkGeometry {
  const target = size * MARK_FRACTION[maskable ? 'maskable' : 'any']
  // At least 1: below ~36px there is no whole scale that also leaves a margin, and a
  // mark that fills its canvas beats one rounded away to nothing.
  const scale = Math.max(1, Math.round(target / MARK_VIEWBOX))
  const markPx = scale * MARK_VIEWBOX
  const pad = Math.max(0, Math.floor((size - markPx) / 2))
  return { markPx, padTop: pad, padLeft: pad, scale }
}

/**
 * Which of the two installable apps an icon is for.
 *
 * 'app' is the manager app: the mark drawn on the light surface. 'portal' inverts it
 * — the tile filled, the mark knocked out in the surface colour.
 *
 * The inversion is the whole differentiator, and it is doing more work than a second
 * mark would. Solid-versus-hollow survives being shrunk to 60px and cropped to a
 * circle, which two line drawings do not: at home-screen size a document and a
 * building are both a vertical rectangle with lines in it. It also says the right
 * thing — these are two doors into one product, not two products, so they keep one
 * mark between them.
 */
export const ICON_VARIANTS = ['app', 'portal'] as const
export type IconVariant = (typeof ICON_VARIANTS)[number]

export function isIconVariant(s: string): s is IconVariant {
  return (ICON_VARIANTS as readonly string[]).includes(s)
}

/**
 * The ramp stop the portal tile is filled with.
 *
 * NOT the raw accent. White on the raw accent fails WCAG on four of the nine presets
 * in ACCENT_PRESETS — amber lands at 2.14:1 — because those accents are chosen to be
 * legible AS text on a light surface, which is the opposite requirement. The 700 stop
 * is the ramp's "dark enough for white text" rung (see the note on RAMP_STOPS in
 * lib/theme.ts) and clears 4.5:1 for every preset. lib/pwa.test.ts checks all of them.
 */
const PORTAL_FILL_STOP = 700

export interface PwaBrand {
  /** Full name — install prompts and app switchers have room for this. */
  name: string
  /** What iOS and Android actually render under a home-screen icon. */
  shortName: string
  /** Mark colour as hex: the fund's accent when themed, else the default neutral. */
  markHex: string
  /** Tile fill for the inverted portal icon. Always dark enough to knock white out of. */
  portalFillHex: string
}

export const DEFAULT_BRAND: PwaBrand = {
  name: DEFAULT_APP_NAME,
  shortName: DEFAULT_SHORT_NAME,
  markHex: DEFAULT_MARK_HEX,
  portalFillHex: DEFAULT_MARK_HEX,
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
 * The portal tile's fill for a raw `fund_settings.theme` blob.
 *
 * Falls back to the default mark colour, which is itself dark enough to knock white
 * out of (7.7:1) — so an unthemed deployment still gets a legible inverted icon
 * rather than a special case.
 */
export function portalFillFor(theme: FundTheme | null | undefined): string {
  const accent = theme?.accent
  if (!accent || !isValidHsl(accent)) return DEFAULT_MARK_HEX
  const stop = rampFor(accent)?.find(([s]) => s === PORTAL_FILL_STOP)
  return (stop && hslToHex(stop[1])) || DEFAULT_MARK_HEX
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
      const theme = (settings?.theme as FundTheme | null) ?? null
      return {
        name,
        shortName: shortNameFor(name),
        markHex: markHexFor(theme),
        portalFillHex: portalFillFor(theme),
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

/** The icon URL for one size/purpose/variant. Also used for the apple-touch-icon link. */
export function iconUrl(size: IconSize, variant: IconVariant = 'app', maskable = false): string {
  const params = [`size=${size}`]
  // 'app' is the route's default, so leave it off — one canonical URL per icon keeps
  // the CDN from holding two copies of identical bytes.
  if (variant !== 'app') params.push(`variant=${variant}`)
  if (maskable) params.push('maskable=1')
  return `/api/pwa-icon?${params.join('&')}`
}

function iconEntry(size: IconSize, maskable: boolean, variant: IconVariant) {
  return {
    src: iconUrl(size, variant, maskable),
    sizes: `${size}x${size}`,
    type: 'image/png',
    purpose: maskable ? ('maskable' as const) : ('any' as const),
  }
}

/**
 * The apple-touch-icon links for one variant, largest first.
 *
 * iOS reads these ahead of the manifest's icons, and it does NOT resize well: given a
 * single unqualified link it takes whatever it finds and scales it into the slot the
 * device wants, which is 180 on an iPhone but 152 or 167 on an iPad. Naming each size
 * means every device gets an exact match and nothing is resampled.
 */
export function appleTouchIcons(variant: IconVariant = 'app') {
  return [...APPLE_TOUCH_SIZES]
    .reverse()
    .map(size => ({ url: iconUrl(size, variant), sizes: `${size}x${size}` }))
}

/**
 * The `any` sizes the manifest advertises.
 *
 * 192 and 512 are what Chrome checks for installability; 384 is Android's splash
 * image, and 1024 is what a desktop install carves a dock icon from. Listing them all
 * costs four lines of JSON and is what keeps a platform from upscaling.
 */
const MANIFEST_ANY_SIZES = [192, 384, 512, 1024] as const
/** Maskable only needs the two Android reads. */
const MANIFEST_MASKABLE_SIZES = [192, 512] as const

/**
 * What both manifests share: they are the same app, wearing the same fund's colours.
 * Identity, scope, start page, and icon variant are all that differ.
 */
function sharedChrome(variant: IconVariant) {
  return {
    display: 'standalone' as const,
    // The app surface, not the accent: the chrome around this app is neutral, and
    // `--primary` is an action colour (DESIGN.md). A saturated title bar wrapped
    // around a near-white app reads as someone else's brand bleeding in. This is the
    // window the app runs in, so it stays light for both — only the ICON inverts.
    background_color: SURFACE_LIGHT_HEX,
    theme_color: SURFACE_LIGHT_HEX,
    icons: [
      ...MANIFEST_ANY_SIZES.map(size => iconEntry(size, false, variant)),
      ...MANIFEST_MASKABLE_SIZES.map(size => iconEntry(size, true, variant)),
    ],
  }
}

/**
 * The manifest itself. Pure, so the interesting decisions are testable without a
 * database.
 *
 * `start_url` is the manager's dashboard: this is an app for the people who run the
 * fund, and an LP arriving there would be bounced by the LP/GP split in middleware.
 * LPs get their own manifest instead — see buildPortalManifest below.
 */
export function buildManifest(brand: PwaBrand): MetadataRoute.Manifest {
  return {
    id: '/',
    name: brand.name,
    short_name: brand.shortName,
    description: 'Portfolio, fund and LP reporting.',
    start_url: '/dashboard',
    scope: '/',
    ...sharedChrome('app'),
  }
}

/**
 * What an LP sees in an install prompt.
 *
 * An unbranded deployment would otherwise offer "Portfolio Reporting Investor
 * Portal", which reads as two products stapled together.
 */
export function portalNameFor(name: string): string {
  const clean = name.trim()
  if (!clean || clean === DEFAULT_APP_NAME) return DEFAULT_PORTAL_NAME
  return `${clean} Investor Portal`
}

/**
 * The LP portal's manifest — a second installable app on the same deployment.
 *
 * It needs to be separate rather than a wider root manifest because the two have
 * different start pages and different audiences: an LP installing the root manifest
 * would launch at /dashboard and be redirected straight back out by the LP/GP split
 * in middleware.
 *
 * `scope: '/portal'` is what keeps the two apart once installed. A link out of the
 * portal opens in the browser instead of inside the LP's installed app, so an LP who
 * is also a fund member cannot wander into the GP surface in a window with no address
 * bar. It also makes `id` distinct, which is what stops a browser treating this as an
 * update to the manager app.
 *
 * `short_name` is the fund's, not "Portal": under an icon, the LP wants to recognise
 * their fund. The trade is that a GP who installs BOTH apps sees two identically
 * labelled icons — noted in DOCS.md, and the fix is a distinct portal mark rather
 * than a worse label.
 */
export function buildPortalManifest(brand: PwaBrand): MetadataRoute.Manifest {
  return {
    id: '/portal',
    name: portalNameFor(brand.name),
    // The fund's short name, except on a deployment with no fund yet — there
    // brand.shortName is "Portfolio", which under an LP's icon names the manager app
    // rather than anything they recognise.
    short_name: brand.name === DEFAULT_APP_NAME ? shortNameFor(DEFAULT_PORTAL_NAME) : brand.shortName,
    description: 'Your capital account statements, letters, and fund documents.',
    start_url: '/portal/overview',
    scope: '/portal',
    ...sharedChrome('portal'),
  }
}

/**
 * Serve a manifest.
 *
 * Both manifests are hand-written routes rather than Next's `app/manifest.ts` file
 * convention. That convention allows exactly one manifest per app AND wins over
 * `metadata.manifest` in child layouts — so with it in place the portal could not
 * link its own, and an LP installing from the portal got the manager app. Two plain
 * routes plus an explicit `metadata.manifest` in each layout is what makes the
 * override possible at all; the URLs are unchanged.
 *
 * Neither needs a session, so both are publicly cacheable: the fund behind them is
 * the deployment's, not the caller's.
 */
export function manifestResponse(manifest: MetadataRoute.Manifest): NextResponse {
  return NextResponse.json(manifest, {
    headers: {
      // Some install prompts refuse a manifest served as application/json. The file
      // convention set this for us; a route handler has to say it.
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
    },
  })
}
