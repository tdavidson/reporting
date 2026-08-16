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
  isIconSize,
  markHexFor,
  portalNameFor,
  shortNameFor,
  type PwaBrand,
} from './pwa'

const brand: PwaBrand = { name: 'Evergreen Capital', shortName: 'Evergreen', markHex: '#123456' }

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

  it('ships both an any and a maskable icon at 192 and 512', () => {
    // Android crops whatever it is given; without a maskable entry it crops the "any"
    // icon and eats the mark.
    const byPurpose = (purpose: string) =>
      (manifest.icons ?? []).filter(i => i.purpose === purpose).map(i => i.sizes).sort()
    expect(byPurpose('any')).toEqual(['192x192', '512x512'])
    expect(byPurpose('maskable')).toEqual(['192x192', '512x512'])
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

  it('wears the same fund branding', () => {
    expect(portal.short_name).toBe(manager.short_name)
    expect(portal.icons).toEqual(manager.icons)
    expect(portal.theme_color).toBe(manager.theme_color)
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
