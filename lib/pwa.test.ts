import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import {
  DEFAULT_APP_NAME,
  DEFAULT_MARK_HEX,
  DEFAULT_SHORT_NAME,
  SURFACE_DARK_HEX,
  SURFACE_DARK_HSL,
  SURFACE_LIGHT_HEX,
  SURFACE_LIGHT_HSL,
  buildManifest,
  buildPortalManifest,
  APPLE_TOUCH_SIZES,
  ICON_SIZES,
  MARK_VIEWBOX,
  appleTouchIcons,
  isIconSize,
  iconUrl,
  markGeometry,
  markHexFor,
  portalFillFor,
  portalNameFor,
  shortNameFor,
  type PwaBrand,
} from './pwa'
import { ACCENT_PRESETS } from './theme'

const brand: PwaBrand = {
  name: 'Evergreen Capital',
  shortName: 'Evergreen',
  markHex: '#123456',
  portalFillHex: '#0b2a20',
}

describe('shortNameFor', () => {
  it('keeps a name that already fits under an icon', () => {
    expect(shortNameFor('Evergreen')).toBe('Evergreen')
  })

  it('drops whole words rather than cutting mid-word', () => {
    // "Evergreen Ca" reads as a rendering bug; "Evergreen" reads as the fund.
    expect(shortNameFor('Evergreen Capital Partners')).toBe('Evergreen')
  })

  it('keeps as many whole words as fit, not just the first', () => {
    // The failure this pins: taking only the first word turns "The Hemrock Fund"
    // into "The", which names nothing.
    expect(shortNameFor('The Hemrock Fund')).toBe('The Hemrock')
  })

  it('cuts a single over-long word, because there is nothing else to drop', () => {
    expect(shortNameFor('Supercalifragilistic')).toBe('Supercalifra')
  })

  it('falls back when the fund has no usable name', () => {
    expect(shortNameFor('')).toBe(DEFAULT_SHORT_NAME)
    expect(shortNameFor('   ')).toBe(DEFAULT_SHORT_NAME)
    expect(shortNameFor(null)).toBe(DEFAULT_SHORT_NAME)
    expect(shortNameFor(undefined)).toBe(DEFAULT_SHORT_NAME)
  })

  it('never exceeds the budget', () => {
    for (const name of ['Evergreen Capital Partners', 'The Hemrock Fund', 'Supercalifragilistic', 'A B C D E F G H']) {
      expect(shortNameFor(name).length).toBeLessThanOrEqual(12)
    }
  })
})

describe('markHexFor', () => {
  it('uses the fund accent when one is set', () => {
    // The 'blue' preset in ACCENT_PRESETS, through lib/theme's own hslToHex.
    expect(markHexFor({ accent: '217 91% 60%' })).toBe('#3c83f6')
  })

  it('falls back to the default mark with no theme', () => {
    expect(markHexFor(null)).toBe(DEFAULT_MARK_HEX)
    expect(markHexFor(undefined)).toBe(DEFAULT_MARK_HEX)
    expect(markHexFor({})).toBe(DEFAULT_MARK_HEX)
    expect(markHexFor({ accent: null })).toBe(DEFAULT_MARK_HEX)
  })

  it('refuses an accent that did not come through the settings form', () => {
    // The value reaches an <svg stroke> and a JSON document. themeCssVars validates at
    // render time for the same reason: a direct DB write bypasses the form.
    expect(markHexFor({ accent: 'red; } body { display:none' })).toBe(DEFAULT_MARK_HEX)
    expect(markHexFor({ accent: '999 91% 60%' })).toBe(DEFAULT_MARK_HEX)
  })
})

describe('isIconSize', () => {
  it('accepts the sizes the manifest asks for and nothing else', () => {
    expect(isIconSize(192)).toBe(true)
    expect(isIconSize(512)).toBe(true)
    expect(isIconSize(180)).toBe(true)
    // The allowlist is what stops an unauthenticated caller rendering a 10000px PNG.
    expect(isIconSize(10000)).toBe(false)
    expect(isIconSize(0)).toBe(false)
    expect(isIconSize(NaN)).toBe(false)
  })
})

describe('buildManifest', () => {
  const manifest = buildManifest(brand)

  it('is installable: standalone, scoped, with a start url', () => {
    expect(manifest.display).toBe('standalone')
    expect(manifest.scope).toBe('/')
    expect(manifest.start_url).toBe('/dashboard')
  })

  it('carries the fund name, not ours', () => {
    expect(manifest.name).toBe('Evergreen Capital')
    expect(manifest.short_name).toBe('Evergreen')
  })

  it('ships a maskable icon at both sizes Android reads', () => {
    // Android crops whatever it is given; without a maskable entry it crops the "any"
    // icon and eats the mark.
    const byPurpose = (purpose: string) =>
      (manifest.icons ?? []).filter(i => i.purpose === purpose).map(i => i.sizes).sort()
    expect(byPurpose('maskable')).toEqual(['192x192', '512x512'])
  })

  it('offers an exact size for every install slot, so nothing is upscaled', () => {
    // The reason this ladder is long: an icon the platform has to resize is why an
    // installed app looks soft. 192/512 are Chrome's installability check, 384 is
    // Android's splash, and 1024 is what a desktop install carves a dock icon from —
    // without it macOS doubles the 512.
    const any = (manifest.icons ?? []).filter(i => i.purpose === 'any').map(i => i.sizes).sort()
    expect(any).toEqual(['1024x1024', '192x192', '384x384', '512x512'])
  })

  it('points every icon at a size the route will actually serve', () => {
    for (const icon of manifest.icons ?? []) {
      const size = Number(new URL(icon.src, 'https://x.test').searchParams.get('size'))
      expect(isIconSize(size)).toBe(true)
      expect(icon.sizes).toBe(`${size}x${size}`)
    }
  })

  it('uses hex colours, which is all a manifest parser is guaranteed to read', () => {
    expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/)
    expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/)
  })
})

describe('markGeometry', () => {
  it('draws the mark at a WHOLE-number scale, so strokes cover whole pixels', () => {
    // This is the blur. The mark is a 2-unit stroke on a 24-unit grid with whole-unit
    // coordinates: at a fractional scale every edge lands mid-pixel and rasterises as
    // a half-covered grey. The old 32px favicon drew it at 21px — scale 0.875 — and
    // more than half its ink came out grey.
    for (const size of [...ICON_SIZES, 32]) {
      for (const maskable of [false, true]) {
        const { scale, markPx } = markGeometry(size, maskable)
        expect(Number.isInteger(scale)).toBe(true)
        expect(scale).toBeGreaterThanOrEqual(1)
        expect(markPx).toBe(scale * MARK_VIEWBOX)
      }
    }
  })

  it('offsets the mark by whole pixels, which flexbox centring does not', () => {
    // Centring puts the mark on a half pixel whenever the canvas and the mark disagree
    // about parity — true for a third of the ladder, including 180 and 192, the two
    // sizes a phone actually installs.
    for (const size of [...ICON_SIZES, 32]) {
      for (const maskable of [false, true]) {
        const { padTop, padLeft } = markGeometry(size, maskable)
        expect(Number.isInteger(padTop)).toBe(true)
        expect(Number.isInteger(padLeft)).toBe(true)
        expect(padTop).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('strokes an EVEN number of pixels, at every size', () => {
    // A stroke is centred on its path and reaches half its width either side, so an
    // odd width puts both edges on a half pixel even when the path is exactly on the
    // grid. Measured on the rendered PNG rather than assumed: a 120px mark stroked at
    // 6px shows 6 half-covered pixels across four scanlines, and the same mark at 7px
    // shows 55. Nudging the mark half a pixel to compensate does not work — the
    // renderer ignores a fractional offset.
    for (const size of [...ICON_SIZES, 32]) {
      for (const maskable of [false, true]) {
        const { strokePx, strokeUnits, scale } = markGeometry(size, maskable)
        expect(strokePx % 2).toBe(0)
        expect(strokeUnits * scale).toBeCloseTo(strokePx, 10)
      }
    }
  })

  it('draws the home-screen icon lighter than the toolbar glyph it comes from', () => {
    // The mark is a Lucide glyph, whose 2-in-24 stroke (8.3% of the mark) is a weight
    // for staying legible at 16px in a toolbar. At icon sizes it closes up the window
    // slots and the gap between the tower and its wings.
    const LUCIDE_RATIO = 2 / MARK_VIEWBOX
    for (const size of ICON_SIZES) {
      for (const maskable of [false, true]) {
        const { strokePx, markPx } = markGeometry(size, maskable)
        expect(strokePx / markPx).toBeLessThan(LUCIDE_RATIO)
        // ...but not so light it becomes a hairline on a home screen.
        expect(strokePx / markPx).toBeGreaterThan(0.04)
      }
    }
  })

  it('keeps the 32px favicon on the heavier stroke, which it needs', () => {
    // The mark is only 24px across there; the icons' lighter weight would be a
    // hairline. Same reason a typeface has a display cut and a text cut — and the two
    // are never seen together.
    expect(markGeometry(32).strokePx).toBe(2)
  })

  it('keeps the mark inside its canvas', () => {
    for (const size of ICON_SIZES) {
      for (const maskable of [false, true]) {
        const { markPx, padLeft } = markGeometry(size, maskable)
        expect(markPx + padLeft * 2).toBeLessThanOrEqual(size + 1)
      }
    }
  })

  it('keeps a maskable mark inside the safe zone Android guarantees', () => {
    // Only the middle 80% of a maskable icon survives a launcher's crop. Snapping the
    // scale moves the mark around a little, so this is the bound that matters.
    for (const size of ICON_SIZES) {
      const { markPx } = markGeometry(size, true)
      expect(markPx / size).toBeLessThanOrEqual(0.8)
    }
  })

  it('leaves the mark a recognisable share of the canvas at every size', () => {
    // Snapping trades an exact 66% for sharpness; the band is what that costs.
    for (const size of ICON_SIZES) {
      const share = markGeometry(size).markPx / size
      expect(share).toBeGreaterThanOrEqual(0.55)
      expect(share).toBeLessThanOrEqual(0.75)
    }
  })
})

describe('appleTouchIcons', () => {
  it('names a size for each link, so iOS never resamples one to fit', () => {
    // A single unqualified 180 was being scaled into an iPad's 152 or 167 slot.
    const icons = appleTouchIcons('app')
    expect(icons.map(i => i.sizes)).toEqual(['180x180', '167x167', '152x152'])
    for (const icon of icons) {
      const size = Number(new URL(icon.url, 'https://x.test').searchParams.get('size'))
      expect(isIconSize(size)).toBe(true)
      expect(icon.sizes).toBe(`${size}x${size}`)
    }
  })

  it('covers every size iOS picks between', () => {
    const declared = appleTouchIcons('app').map(i => i.sizes).sort()
    expect(declared).toEqual([...APPLE_TOUCH_SIZES].map(s => `${s}x${s}`).sort())
  })

  it('gives an LP the inverted mark, not the manager app icon', () => {
    expect(appleTouchIcons('portal').every(i => i.url.includes('variant=portal'))).toBe(true)
    expect(appleTouchIcons('app').some(i => i.url.includes('variant='))).toBe(false)
  })
})

describe('iconUrl', () => {
  it('leaves the default variant off, so an icon has one canonical URL', () => {
    // Two URLs for identical bytes would have the CDN and the browser cache both.
    expect(iconUrl(180)).toBe('/api/pwa-icon?size=180')
    expect(iconUrl(192, 'app', true)).toBe('/api/pwa-icon?size=192&maskable=1')
  })

  it('names the portal variant explicitly', () => {
    expect(iconUrl(180, 'portal')).toBe('/api/pwa-icon?size=180&variant=portal')
    expect(iconUrl(512, 'portal', true)).toBe('/api/pwa-icon?size=512&variant=portal&maskable=1')
  })
})

describe('portalFillFor', () => {
  /** WCAG relative-luminance contrast, same maths as foregroundFor in lib/theme.ts. */
  function contrastWithWhite(hex: string): number {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
    const lin = (c: number) => {
      c /= 255
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
    }
    const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
    return 1.05 / (lum + 0.05)
  }

  it('knocks white out legibly on EVERY accent a fund can pick', () => {
    // The reason the fill is the ramp's 700 stop and not the accent itself. Accents are
    // chosen to read as text ON a light surface, which is the opposite requirement —
    // white on raw amber is 2.14:1. If a preset is ever added, this fails until its
    // ramp behaves.
    const failures = ACCENT_PRESETS.map(p => ({
      key: p.key,
      ratio: contrastWithWhite(portalFillFor({ accent: p.hsl })),
    })).filter(r => r.ratio < 4.5)

    expect(failures, `these fills cannot carry white: ${JSON.stringify(failures)}`).toEqual([])
  })

  it('is materially darker than the accent it came from', () => {
    // Guards against someone "simplifying" this back to the raw accent.
    const amber = ACCENT_PRESETS.find(p => p.key === 'amber')!
    expect(contrastWithWhite(portalFillFor({ accent: amber.hsl }))).toBeGreaterThan(
      contrastWithWhite(markHexFor({ accent: amber.hsl }))
    )
  })

  it('falls back to a fill that still carries white when unthemed', () => {
    expect(portalFillFor(null)).toBe(DEFAULT_MARK_HEX)
    expect(contrastWithWhite(DEFAULT_MARK_HEX)).toBeGreaterThan(4.5)
  })

  it('refuses an accent that did not come through the settings form', () => {
    expect(portalFillFor({ accent: 'red; } body { display:none' })).toBe(DEFAULT_MARK_HEX)
  })
})

describe('portalNameFor', () => {
  it('names the fund', () => {
    expect(portalNameFor('Evergreen Capital')).toBe('Evergreen Capital Investor Portal')
  })

  it('does not staple two product names together on an unbranded deployment', () => {
    expect(portalNameFor(DEFAULT_APP_NAME)).toBe('Investor Portal')
    expect(portalNameFor('')).toBe('Investor Portal')
    expect(portalNameFor('   ')).toBe('Investor Portal')
  })
})

describe('buildPortalManifest', () => {
  const portal = buildPortalManifest(brand)
  const manager = buildManifest(brand)

  it('starts an LP inside the portal', () => {
    // The whole point: an LP installing the manager manifest would launch at
    // /dashboard and be redirected straight back out by the LP/GP split.
    expect(portal.start_url).toBe('/portal/overview')
  })

  it('scopes the installed app to the portal', () => {
    // Keeps a link out of the portal opening in the browser rather than inside the
    // LP's installed app — so an LP who is also a member cannot end up on the GP
    // surface in a window with no address bar.
    expect(portal.scope).toBe('/portal')
  })

  it('is a distinct app identity from the manager manifest', () => {
    // Same id would make a browser treat one as an update to the other.
    expect(portal.id).not.toBe(manager.id)
    expect(portal.name).not.toBe(manager.name)
  })

  it('wears the same fund branding, but its own icon variant', () => {
    expect(portal.short_name).toBe(manager.short_name)
    expect(portal.theme_color).toBe(manager.theme_color)
    // The differentiator: same mark, inverted. Identical icons here is the bug this
    // closed — two apps that were indistinguishable on a home screen.
    expect(portal.icons).not.toEqual(manager.icons)
    expect((portal.icons ?? []).every(i => i.src.includes('variant=portal'))).toBe(true)
    expect((manager.icons ?? []).some(i => i.src.includes('variant='))).toBe(false)
  })

  it('matches the manager manifest on sizes and purposes', () => {
    const shape = (m: typeof portal) =>
      (m.icons ?? []).map(i => `${i.sizes}:${i.purpose}`).sort()
    expect(shape(portal)).toEqual(shape(manager))
  })

  it('is installable on the same terms', () => {
    expect(portal.display).toBe('standalone')
    expect(portal.background_color).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('does not label an unbranded install with the manager app name', () => {
    // Before a fund exists the shared short name is "Portfolio", which says nothing
    // to an LP and names the wrong app.
    const unbranded = buildPortalManifest({
      name: DEFAULT_APP_NAME,
      shortName: DEFAULT_SHORT_NAME,
      markHex: DEFAULT_MARK_HEX,
      portalFillHex: DEFAULT_MARK_HEX,
    })
    expect(unbranded.short_name).toBe('Investor')
    expect(unbranded.short_name!.length).toBeLessThanOrEqual(12)
  })
})

describe('surface colours track globals.css', () => {
  // A manifest needs a literal colour and cannot read a CSS variable, so --background
  // is duplicated in lib/pwa.ts. This is what stops the copy drifting: change the
  // token and the splash screen, status bar and icon background follow, or CI fails.
  const css = readFileSync(path.join(process.cwd(), 'app', 'globals.css'), 'utf8')

  /** `--background` inside the first `:root {}` / `.dark {}` block. */
  function backgroundIn(selector: string): string | null {
    const block = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`).exec(css)?.[1]
    return block ? (/--background:\s*([^;]+);/.exec(block)?.[1].trim() ?? null) : null
  }

  it('finds the tokens at all (guards against a silently passing test)', () => {
    expect(backgroundIn(':root')).toBeTruthy()
    expect(backgroundIn('\\.dark')).toBeTruthy()
  })

  it('matches the light surface', () => {
    expect(backgroundIn(':root')).toBe(SURFACE_LIGHT_HSL)
  })

  it('matches the dark surface', () => {
    expect(backgroundIn('\\.dark')).toBe(SURFACE_DARK_HSL)
  })

  it('converts both to usable hex', () => {
    expect(SURFACE_LIGHT_HEX).toMatch(/^#[0-9a-f]{6}$/)
    expect(SURFACE_DARK_HEX).toMatch(/^#[0-9a-f]{6}$/)
  })
})
