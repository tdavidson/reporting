import { describe, it, expect } from 'vitest'
import { rampFor, themeCssVars, foregroundFor, isValidHsl } from './theme'

/** The evergreen seed. globals.css hardcodes the ramp this produces. */
const EVERGREEN = '164 72% 50%'

/** Verbatim from app/globals.css — if these drift apart, one of them is wrong. */
const GLOBALS_CSS_RAMP: Record<number, string> = {
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

describe('rampFor', () => {
  it('reproduces the evergreen ramp hardcoded in globals.css', () => {
    expect(Object.fromEntries(rampFor(EVERGREEN)!)).toEqual(GLOBALS_CSS_RAMP)
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

describe('the evergreen CTA stop', () => {
  it('takes white text — the 700 stop is the primary fill', () => {
    expect(foregroundFor(GLOBALS_CSS_RAMP[700])).toBe('0 0% 100%')
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
    // 'source-serif' is the default; storing it as an override would be a no-op.
    expect(themeCssVars({ displayFont: 'source-serif' })).toBe('')
    expect(themeCssVars({ displayFont: 'not-a-font' })).toBe('')
  })

  it('keeps the UI font and the display font independent', () => {
    const css = themeCssVars({ font: 'hanken', displayFont: 'newsreader' })
    expect(css).toContain('--font-sans:var(--font-hanken)')
    expect(css).toContain('--font-display:var(--font-newsreader)')
  })
})
