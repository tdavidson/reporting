import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Guards the design-token conventions in DESIGN.md.
 *
 * This exists for the same reason lib/access/route-domains.test.ts does: a
 * convention nothing enforces is a convention that decays. The raw-palette rule
 * had already decayed to 996 usages across 105 files before it was migrated —
 * this test is what stops that happening again.
 *
 * If a new entry is genuinely needed, add it to the allowlist WITH a reason.
 */

const ROOTS = ['app', 'components']

function tsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) tsxFiles(p, out)
    else if (p.endsWith('.tsx')) out.push(p)
  }
  return out
}

const ALL = ROOTS.flatMap(r => tsxFiles(r))

// ---------------------------------------------------------------------------
// Raw Tailwind palette classes
// ---------------------------------------------------------------------------

const PALETTE_SRC =
  '\\b(?:bg|text|border|ring|fill|stroke|divide|from|to|via)-' +
  '(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|' +
  'teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}\\b'

/** Fresh instance per use — a shared /g regex carries lastIndex between calls. */
const palette = () => new RegExp(PALETTE_SRC, 'g')

/**
 * Files allowed raw palette classes, and why.
 *
 * Deliberately EMPTY. It previously held six files that used colour
 * categorically, which the status tokens genuinely could not express — that is
 * what --cat-1..8 was added for. Every one of them now draws from the
 * categorical palette, so the exemption is gone.
 *
 * Any new entry needs a reason that no existing token covers.
 */
const CATEGORICAL_ALLOWLIST = new Map<string, string>([])

describe('design tokens', () => {
  it('does not add raw Tailwind palette classes', () => {
    const offenders: string[] = []
    for (const f of ALL) {
      if (CATEGORICAL_ALLOWLIST.has(f)) continue
      const hits = readFileSync(f, 'utf8').match(palette())
      if (hits) offenders.push(`${f} → ${Array.from(new Set(hits)).join(', ')}`)
    }
    expect(
      offenders,
      'Raw palette classes break per-fund white-labelling — themeCssVars() cannot repoint them.\n' +
      'Use the tokens instead: bg-warning-subtle, text-success, border-brand-200, text-muted-foreground.\n' +
      'See DESIGN.md.\n\n' + offenders.join('\n')
    ).toEqual([])
  })

  it('keeps the categorical allowlist honest', () => {
    // An allowlisted file that no longer needs the exemption should lose it,
    // otherwise the list quietly becomes a place to hide new violations.
    const stale = Array.from(CATEGORICAL_ALLOWLIST.keys())
      .filter(f => ALL.includes(f) && !palette().test(readFileSync(f, 'utf8')))
    expect(stale, `Allowlisted but now clean — drop the entry: ${stale.join(', ')}`).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Numbers use tabular figures, not a monospaced face
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Page width
// ---------------------------------------------------------------------------

describe('page width', () => {
  it('uses the two named page widths, not ad-hoc container sizes', () => {
    // These three were the ones pages picked at random before the convention
    // existed. Card/modal/label max-widths are unaffected — this only catches
    // the sizes that were being used as page containers.
    const BANNED = ['max-w-6xl', 'max-w-7xl', 'max-w-screen-xl']
    const offenders: string[] = []
    for (const f of ALL) {
      const src = readFileSync(f, 'utf8')
      const hits = BANNED.filter(b => src.includes(b))
      if (hits.length) offenders.push(`${f} → ${hits.join(', ')}`)
    }
    expect(
      offenders,
      'Use max-w-page (the app cap, set once in app/(app)/layout.tsx) or max-w-readable. See DESIGN.md.\n\n' +
      offenders.join('\n')
    ).toEqual([])
  })
})

describe('numeric type', () => {
  it('does not put right-aligned columns on a monospaced face', () => {
    // text-right + font-mono is the signature of a financial table cell. Column
    // alignment wants tabular figures; mono costs letterform quality and makes
    // money read as code. Mono stays correct for code, IDs, keys and OTP inputs.
    const offenders: string[] = []
    for (const f of ALL) {
      const src = readFileSync(f, 'utf8')
      for (const m of src.match(/className=(?:"[^"]*"|\{`[^`]*`\})/g) ?? []) {
        if (m.includes('font-mono') && m.includes('text-right')) offenders.push(`${f} → ${m.slice(0, 90)}`)
      }
    }
    expect(
      offenders,
      'Use tabular-nums for figures; keep font-mono for code/IDs. See DESIGN.md.\n\n' + offenders.join('\n')
    ).toEqual([])
  })
})
