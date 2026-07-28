// Per-fund branding theme. Stored on fund_settings.theme (jsonb) and applied
// app-wide via CSS-variable overrides. An empty/absent theme = the default
// neutral look (no overrides), so the app ships looking exactly as it does
// today; the Appearance settings let an installer opt into a brand.

export interface FundTheme {
  /** Accent as an HSL triple string, e.g. "243 75% 59%". Drives primary
   *  actions, focus rings, and active states. Null = default neutral. */
  accent?: string | null
  /** UI font key (see FONT_OPTIONS). Null/'system' = the default stack. */
  font?: string | null
  /** Display font key (see DISPLAY_FONT_OPTIONS). Drives --font-display: report
   *  covers, letter mastheads, statement headers. Null = Inter (no serif). */
  displayFont?: string | null
  /** Corner radius in rem, e.g. 0.5. */
  radius?: number | null
}

export const ACCENT_PRESETS: Array<{ key: string; label: string; hsl: string; fg: string }> = [
  { key: 'neutral', label: 'Neutral', hsl: '0 0% 9%', fg: '0 0% 98%' },
  { key: 'indigo', label: 'Indigo', hsl: '243 75% 59%', fg: '0 0% 100%' },
  { key: 'blue', label: 'Blue', hsl: '217 91% 60%', fg: '0 0% 100%' },
  { key: 'violet', label: 'Violet', hsl: '262 83% 58%', fg: '0 0% 100%' },
  { key: 'emerald', label: 'Emerald', hsl: '160 84% 39%', fg: '0 0% 100%' },
  { key: 'teal', label: 'Teal', hsl: '173 80% 36%', fg: '0 0% 100%' },
  { key: 'rose', label: 'Rose', hsl: '347 77% 50%', fg: '0 0% 100%' },
  { key: 'amber', label: 'Amber', hsl: '38 92% 50%', fg: '38 92% 12%' },
  { key: 'slate', label: 'Slate blue', hsl: '215 25% 35%', fg: '0 0% 100%' },
]

// 'system' keeps its key for themes already stored against it, but the app-wide
// default is now Inter (globals.css points --font-sans there), so leaving the
// font unset and picking 'inter' land in the same place.
export const FONT_OPTIONS: Array<{ key: string; label: string; varName: string | null }> = [
  { key: 'system', label: 'Inter (default)', varName: null },
  { key: 'inter', label: 'Inter', varName: '--font-inter' },
  { key: 'hanken', label: 'Hanken Grotesk', varName: '--font-hanken' },
  { key: 'jakarta', label: 'Plus Jakarta Sans', varName: '--font-jakarta' },
]

/**
 * Display faces a fund may pick for its reports, behind --font-display.
 *
 * Separate from FONT_OPTIONS on purpose: that list drives --font-sans, the body
 * font, and a serif there would land on every dense financial table. This list
 * only touches headings, covers and mastheads.
 *
 * Kept deliberately short. Every SERIF option has to be embedded as base64 woff2
 * for server-rendered PDFs (lib/pdf-fonts.ts) — headless Chromium has no fonts
 * installed — so each addition has a real per-render cost. The default costs
 * nothing: Inter is already embedded as the body face, so PDFs fall through to
 * it rather than carrying a second copy.
 */
export const DISPLAY_FONT_OPTIONS: Array<{ key: string; label: string; varName: string | null; note: string }> = [
  { key: 'inter', label: 'Inter (default)', varName: null, note: 'No serif — headings match the interface.' },
  { key: 'source-serif', label: 'Source Serif 4', varName: '--font-source-serif', note: 'Institutional and neutral.' },
  { key: 'newsreader', label: 'Newsreader', varName: '--font-newsreader', note: 'Editorial serif. Optical sizing, warm.' },
  { key: 'libre-caslon', label: 'Libre Caslon Display', varName: '--font-libre-caslon', note: 'Caslon — legal and banking heritage.' },
]

// 0.25rem is the app default (matching hemrock.com); the labels describe the
// step rather than claiming one of them is "the" default. Keys are unchanged so
// themes already stored against 'default' keep resolving.
export const RADIUS_OPTIONS: Array<{ key: string; label: string; rem: number }> = [
  { key: 'sharp', label: 'Sharp', rem: 0.25 },
  { key: 'default', label: 'Soft', rem: 0.5 },
  { key: 'rounded', label: 'Rounded', rem: 0.875 },
]

/**
 * The saturation/lightness curve behind the brand ramp: [stop, saturation
 * multiplier, lightness]. Hue and base saturation come from the accent, so any
 * accent generates a ramp with the same internal relationships as Hemrock's
 * evergreen. Verified against WCAG at hue 164 — 700 takes white text at 7.05:1,
 * 500 clears 5.14:1 on the dark surface (plans/plan-design-system.md §8).
 */
const RAMP_STOPS: Array<[number, number, number]> = [
  [50, 0.30, 97], [100, 0.35, 93], [200, 0.40, 85], [300, 0.42, 72],
  [400, 0.48, 56], [500, 0.55, 44], [600, 0.62, 35], [700, 0.60, 27],
  [800, 0.55, 21], [900, 0.50, 16], [950, 0.45, 10],
]

const HSL_RE = /^(\d{1,3}(?:\.\d+)?)\s+(\d{1,3}(?:\.\d+)?)%\s+(\d{1,3}(?:\.\d+)?)%$/

/** Is this a syntactically valid "h s% l%" triple? */
export function isValidHsl(hsl: string): boolean {
  const m = hsl.match(HSL_RE)
  if (!m) return false
  return +m[1] <= 360 && +m[2] <= 100 && +m[3] <= 100
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100
  const k = (n: number) => (n + h / 30) % 12
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** Black or white foreground for an accent, picked by WCAG contrast so custom
 *  brand colors always get readable text. */
export function foregroundFor(hsl: string): string {
  const m = hsl.match(HSL_RE)
  if (!m) return '0 0% 100%'
  const [r, g, b] = hslToRgb(+m[1], +m[2], +m[3])
  const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
  const lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  // Contrast vs white (1.0 lum) and vs near-black (0.0 lum); pick the stronger.
  return (1.05 / (lum + 0.05)) >= ((lum + 0.05) / 0.05) ? '0 0% 100%' : '0 0% 9%'
}

/** "#rrggbb" → "h s% l%" (or null if not a hex color). */
export function hexToHsl(hex: string): string | null {
  let h = hex.replace('#', '').trim()
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return null
  if (h.length === 3) h = h.split('').map(c => c + c).join('')
  const r = parseInt(h.slice(0, 2), 16) / 255, g = parseInt(h.slice(2, 4), 16) / 255, b = parseInt(h.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let hue = 0, sat = 0; const lig = (max + min) / 2
  if (max !== min) {
    const d = max - min
    sat = lig > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) hue = (g - b) / d + (g < b ? 6 : 0)
    else if (max === g) hue = (b - r) / d + 2
    else hue = (r - g) / d + 4
    hue /= 6
  }
  return `${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(lig * 100)}%`
}

/** "h s% l%" → "#rrggbb" (or null if not a valid triple). */
export function hslToHex(hsl: string): string | null {
  const m = hsl.match(HSL_RE)
  if (!m) return null
  const [r, g, b] = hslToRgb(+m[1], +m[2], +m[3])
  const to = (c: number) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0')
  return `#${to(r)}${to(g)}${to(b)}`
}

/**
 * Pull the display-font key off a raw `fund_settings.theme` blob, validating it
 * against the curated list. Returns null for anything unrecognised, so a direct
 * DB write can't push an arbitrary string into a PDF template.
 */
export function displayFontOf(theme: unknown): string | null {
  if (!theme || typeof theme !== 'object') return null
  const key = (theme as FundTheme).displayFont
  return typeof key === 'string' && DISPLAY_FONT_OPTIONS.some(o => o.key === key) ? key : null
}

/**
 * Generate the eleven brand-ramp stops for an accent, as `[stop, "h s% l%"]`.
 * Hue and base saturation come from the accent; the lightness curve is fixed.
 *
 * The accent's own value is NOT relocated onto a stop — a fund that picks amber
 * should keep amber as its fill, and amber pushed to stop 700 is brown. The
 * ramp supplies the *missing* tones (tints, borders, hovers) around whatever
 * fill the fund chose.
 *
 * Returns null for a syntactically invalid triple.
 */
export function rampFor(hsl: string): Array<[number, string]> | null {
  const m = hsl.match(HSL_RE)
  if (!m) return null
  const h = +m[1], s = +m[2]
  return RAMP_STOPS.map(([stop, sMul, l]) => [stop, `${h} ${+(s * sMul).toFixed(1)}% ${l}%`])
}

/**
 * Build the `:root` CSS-variable overrides for a fund theme. Returns '' when
 * nothing is set, so the default Hemrock theme is left fully intact.
 */
export function themeCssVars(theme: FundTheme | null | undefined): string {
  if (!theme) return ''
  const out: string[] = []
  // Validate at render time, not just on write: this string is injected into a
  // <style> block via dangerouslySetInnerHTML, so an un-validated accent (e.g.
  // from a direct DB write) could break out of the rule and inject markup.
  if (theme.accent && isValidHsl(theme.accent)) {
    const fg = foregroundFor(theme.accent)
    out.push(
      `--primary:${theme.accent}`,
      `--primary-foreground:${fg}`,
      `--ring:${theme.accent}`,
      `--brand:${theme.accent}`,
      `--brand-foreground:${fg}`,
    )
    // Regenerate the ramp off the fund's hue so tinted surfaces, hairlines and
    // hovers stay in the fund's colour instead of falling back to evergreen.
    for (const [stop, value] of rampFor(theme.accent) ?? []) {
      out.push(`--brand-${stop}:${value}`)
    }
  }
  if (theme.font) {
    const f = FONT_OPTIONS.find(o => o.key === theme.font)
    if (f?.varName) out.push(`--font-sans:var(${f.varName})`)
  }
  if (theme.displayFont) {
    const d = DISPLAY_FONT_OPTIONS.find(o => o.key === theme.displayFont)
    if (d?.varName) out.push(`--font-display:var(${d.varName}),ui-serif,Georgia,Cambria,serif`)
  }
  if (typeof theme.radius === 'number' && theme.radius >= 0) {
    // Cards sit one step softer than controls, the same relationship the
    // defaults carry (0.25rem controls / 0.5rem cards).
    out.push(`--radius:${theme.radius}rem`, `--radius-card:${theme.radius + 0.25}rem`)
  }
  return out.join(';')
}
