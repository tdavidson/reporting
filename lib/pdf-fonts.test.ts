import { describe, it, expect } from 'vitest'
import { pdfFontCss, PDF_SANS, PDF_DISPLAY } from './pdf-fonts'
import { DISPLAY_FONT_OPTIONS, displayFontOf } from './theme'

// These guard the failure mode the module header documents: a PDF template that
// declares faces without referencing them, or references a face that was never
// embedded, silently renders in the container's default (Calibri) instead.

describe('pdfFontCss', () => {
  it('always embeds the body and figure faces', () => {
    const css = pdfFontCss()
    expect(css).toContain("font-family:'Inter'")
    expect(css).toContain("font-family:'Roboto Mono'")
  })

  it('embeds exactly one display face, under a stable family name', () => {
    const css = pdfFontCss('libre-caslon')
    expect(css.match(/font-family:'PDFDisplay'/g)).toHaveLength(1)
    // PDF_DISPLAY references that family, so the template can stay font-agnostic.
    expect(PDF_DISPLAY).toContain('PDFDisplay')
  })

  it('produces a different face per key', () => {
    const [a, b, c] = ['newsreader', 'source-serif', 'libre-caslon'].map(k => pdfFontCss(k))
    expect(a).not.toBe(b)
    expect(b).not.toBe(c)
    expect(a).not.toBe(c)
  })

  it('embeds a distinct face for every key DISPLAY_FONT_OPTIONS offers', () => {
    // A key in the picker with no embedded face silently falls back, so the fund
    // picks a font and the PDF renders in a different one. Comparing against the
    // fallback would pass vacuously for 'source-serif' (it IS the fallback), so
    // assert all keys produce mutually distinct output instead.
    const blocks = DISPLAY_FONT_OPTIONS.map(o => pdfFontCss(o.key))
    expect(new Set(blocks).size).toBe(DISPLAY_FONT_OPTIONS.length)
  })

  it('falls back to the default for unknown or absent keys', () => {
    const dflt = pdfFontCss('source-serif')
    expect(pdfFontCss(undefined)).toBe(dflt)
    expect(pdfFontCss(null)).toBe(dflt)
    expect(pdfFontCss('not-a-font')).toBe(dflt)
  })

  it('carries real base64 payloads rather than empty src slots', () => {
    const css = pdfFontCss('source-serif')
    const payloads = Array.from(css.match(/base64,[^)]*\)/g) ?? [])
    expect(payloads.length).toBeGreaterThan(0)
    for (const p of payloads) expect(p.length).toBeGreaterThan(1000)
  })

  it('names Inter first in the body stack', () => {
    expect(PDF_SANS.startsWith("'Inter'")).toBe(true)
  })
})

describe('displayFontOf', () => {
  it('reads a valid key off a theme blob', () => {
    expect(displayFontOf({ displayFont: 'source-serif' })).toBe('source-serif')
  })

  it('rejects anything not in the curated list', () => {
    expect(displayFontOf({ displayFont: 'Comic Sans' })).toBeNull()
    expect(displayFontOf({ displayFont: 42 })).toBeNull()
    expect(displayFontOf({})).toBeNull()
    expect(displayFontOf(null)).toBeNull()
    expect(displayFontOf('newsreader')).toBeNull()
  })

  it('round-trips into a font block without falling back', () => {
    const key = displayFontOf({ displayFont: 'libre-caslon' })
    expect(pdfFontCss(key)).toBe(pdfFontCss('libre-caslon'))
    expect(pdfFontCss(key)).not.toBe(pdfFontCss('source-serif'))
  })
})
