import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { rampFor, themeCssVars, foregroundFor, isValidHsl, FONT_OPTIONS } from './theme'

/** The old evergreen default. RAMP_STOPS was calibrated on it, so it stays the reference seed. */
const EVERGREEN = '164 72% 50%'

/** The ramp RAMP_STOPS produces for EVERGREEN — the curve's WCAG-verified baseline. */
const EVERGREEN_RAMP: Record<number, string> = {
  50: '164 21.6% 97%',
  100: '164 25.2% 93%',
  200: '164 28.8% 85%',
  300: '164 30.2% 72%',
  400: '164 34.6% 56%',
  500: '164 39.6% 44%',
  600: '164 44.6% 35%',
  700: '164 43.2% 27%',
  800: '164 39.6% 21%',
  900: '164 36% 16%',
  950: '164 32.4% 10%',
}

/**
 * The default (unthemed) yellow ramp in app/globals.css. Hand-tuned rather than rampFor()
 * output — RAMP_STOPS' saturation multipliers grey a yellow out — and shared verbatim with
 * the content and nevermodel-site repos.
 */
const GLOBALS_CSS_RAMP: Record<number, string> = {
  50: '48 100% 97%',
  100: '48 96% 93%',
  200: '48 92% 85%',
  300: '48 94% 72%',
  400: '48 96% 56%',
  500: '48 90% 44%',
  600: '48 88% 35%',
  700: '48 86% 27%',
  800: '48 80% 21%',
  900: '48 70% 16%',
  950: '48 60% 10%',
}
const GLOBALS_CSS = readFileSync(join(__dirname, '../app/globals.css'), 'utf8')

describe('the default yellow ramp', () => {
  it('matches what globals.css declares', () => {
    for (const [stop, value] of Object.entries(GLOBALS_CSS_RAMP)) {
      expect(GLOBALS_CSS).toContain(`--brand-${stop}: ${value};`)
    }
  })

  it('carries ink, not white, on the fill in both themes', () => {
    expect(GLOBALS_CSS).toContain('--brand: 49 97% 60%;')
    expect(GLOBALS_CSS).toContain('--brand: 48 96% 77%;')
    expect(foregroundFor('49 97% 60%')).toBe('0 0% 9%')
    expect(foregroundFor('48 96% 77%')).toBe('0 0% 9%')
  })
})

describe('rampFor', () => {
  it('reproduces the calibrated evergreen ramp', () => {
    expect(Object.fromEntries(rampFor(EVERGREEN)!)).toEqual(EVERGREEN_RAMP)
  })

  it('returns all eleven stops', () => {
    expect(rampFor(EVERGREEN)!.map(([stop]) => stop))
      .toEqual([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950])
  })

  it('preserves the accent hue across every stop', () => {
    for (const [, value] of rampFor('217 91% 60%')!) {
      expect(value.startsWith('217 ')).toBe(true)
    }
  })

  it('produces lightness that descends monotonically', () => {
    const ls = rampFor(EVERGREEN)!.map(([, v]) => parseFloat(v.split(' ')[2]))
    expect(ls).toEqual([...ls].sort((a, b) => b - a))
  })

  it('emits values themeCssVars will accept back', () => {
    for (const [, value] of rampFor(EVERGREEN)!) expect(isValidHsl(value)).toBe(true)
  })

  it('returns null for a malformed triple', () => {
    expect(rampFor('not-a-colour')).toBeNull()
    expect(rampFor('#276353')).toBeNull()
  })
})

describe('the generated 700 stop', () => {
  it('takes white text — the curve is calibrated so a themed 700 can be a fill', () => {
    expect(foregroundFor(EVERGREEN_RAMP[700])).toBe('0 0% 100%')
  })
})

describe('themeCssVars', () => {
  it('returns empty for an absent theme, leaving the default intact', () => {
    expect(themeCssVars(null)).toBe('')
    expect(themeCssVars(undefined)).toBe('')
    expect(themeCssVars({})).toBe('')
  })

  it('regenerates the brand ramp from the fund accent', () => {
    const css = themeCssVars({ accent: '217 91% 60%' })
    expect(css).toContain('--brand:217 91% 60%')
    expect(css).toContain('--brand-700:217 54.6% 27%')
    expect(css).toContain('--brand-50:217 27.3% 97%')
  })

  it('keeps the fund accent as the fill rather than relocating it onto a stop', () => {
    // Amber pushed onto stop 700 is brown; the fill must stay the chosen colour.
    const css = themeCssVars({ accent: '38 92% 50%' })
    expect(css).toContain('--primary:38 92% 50%')
    expect(css).toContain('--brand:38 92% 50%')
  })

  it('ignores a malformed accent without emitting a ramp', () => {
    const css = themeCssVars({ accent: 'red; } body { display:none' })
    expect(css).toBe('')
  })

  it('derives the card radius one step softer than the control radius', () => {
    expect(themeCssVars({ radius: 0.25 })).toBe('--radius:0.25rem;--radius-card:0.5rem')
    expect(themeCssVars({ radius: 0.875 })).toBe('--radius:0.875rem;--radius-card:1.125rem')
  })

  it('maps the font key to its CSS variable', () => {
    expect(themeCssVars({ font: 'inter' })).toBe('--font-sans:var(--font-inter)')
    expect(themeCssVars({ font: 'system' })).toBe('')
  })

  it('overrides only --font-display for a display font, never --font-sans', () => {
    const css = themeCssVars({ displayFont: 'libre-caslon' })
    expect(css).toContain('--font-display:var(--font-libre-caslon)')
    expect(css).not.toContain('--font-sans')
  })

  it('emits nothing for the default display font', () => {
    // 'inter' is the default; storing it as an override would be a no-op.
    expect(themeCssVars({ displayFont: 'inter' })).toBe('')
    expect(themeCssVars({ displayFont: 'not-a-font' })).toBe('')
  })

  it('maps every new UI face to its own loaded variable, alongside the originals', () => {
    for (const [key, v] of [['geist', '--font-geist'], ['dm-sans', '--font-dm-sans'], ['inter-tight', '--font-inter-tight'], ['instrument-sans', '--font-instrument-sans'], ['hanken', '--font-hanken'], ['jakarta', '--font-jakarta']]) {
      expect(themeCssVars({ font: key })).toBe(`--font-sans:var(${v})`)
    }
    expect(FONT_OPTIONS.map(o => o.key)).toEqual(['system', 'inter', 'geist', 'dm-sans', 'inter-tight', 'instrument-sans', 'hanken', 'jakarta'])
  })

  it('keeps the UI font and the display font independent', () => {
    const css = themeCssVars({ font: 'hanken', displayFont: 'newsreader' })
    expect(css).toContain('--font-sans:var(--font-hanken)')
    expect(css).toContain('--font-display:var(--font-newsreader)')
  })
})
