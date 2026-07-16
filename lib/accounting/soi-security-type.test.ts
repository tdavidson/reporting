import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

import { SECURITY_LABELS, SECURITY_TYPES, isSecurityType, normalizeSecurityType } from './soi'

/**
 * `security_type` is CHECK-constrained in the database, so this list is not a display detail — a
 * value outside it fails the insert. Every write path (the investment form, its POST/PATCH routes,
 * the AI importer) now derives its allowed values from SECURITY_LABELS, which only helps while
 * SECURITY_LABELS still matches the constraint.
 *
 * The bug this guards: the form offered free text under the placeholder "Preferred, Convertible
 * note, SAFE…", none of which are valid values. Every submission 500ed, and the user saw
 * "An unexpected error occurred".
 */
describe('SECURITY_LABELS vs the database CHECK constraint', () => {
  it('lists exactly the values the constraint accepts', () => {
    const sql = readFileSync(
      join(__dirname, '../../supabase/migrations/20260712000000_soi_country_security_type.sql'),
      'utf8',
    )
    const check = sql.match(/security_type in \(([\s\S]*?)\)\)/)
    expect(check, 'could not find the security_type CHECK in the migration').toBeTruthy()

    const allowed = (check![1].match(/'[^']+'/g) ?? []).map(m => m.slice(1, -1))
    expect(allowed.length).toBeGreaterThan(0)
    // Sorted compare: an instrument added to one side and not the other breaks a write path.
    expect([...SECURITY_TYPES].sort()).toEqual([...allowed].sort())
  })
})

describe('normalizeSecurityType', () => {
  it('accepts the canonical keys unchanged', () => {
    for (const key of SECURITY_TYPES) expect(normalizeSecurityType(key)).toBe(key)
  })

  it('accepts the labels the UI shows', () => {
    for (const [key, label] of Object.entries(SECURITY_LABELS)) {
      expect(normalizeSecurityType(label), label).toBe(key)
    }
  })

  it('reads the spellings a human or an LLM actually writes', () => {
    expect(normalizeSecurityType('Convertible Note')).toBe('convertible_note')
    expect(normalizeSecurityType('convertible-note')).toBe('convertible_note')
    expect(normalizeSecurityType('  NOTE  ')).toBe('convertible_note')
    expect(normalizeSecurityType('SAFE')).toBe('safe')
    expect(normalizeSecurityType('Preferred Stock')).toBe('preferred')
    expect(normalizeSecurityType('Warrants')).toBe('warrant')
    expect(normalizeSecurityType('LLC Units')).toBe('llc_units')
  })

  it('returns null rather than guessing at an ambiguous instrument', () => {
    // Every one of these could be preferred OR common. A wrong guess writes a plausible instrument
    // onto a real position, and the SOI's asset-type breakout then reports it as fact.
    for (const v of ['equity', 'shares', 'stock', 'Series A', '', '   ', 'Series A-1 Pfd']) {
      expect(normalizeSecurityType(v), v).toBeNull()
    }
  })

  it('returns null for non-strings instead of throwing', () => {
    for (const v of [null, undefined, 42, {}, []]) expect(normalizeSecurityType(v)).toBeNull()
  })

  it('never returns a value the constraint would reject', () => {
    const inputs = ['preferred', 'Convertible Note', 'note', 'garbage', '', 'Options', 'units']
    for (const v of inputs) {
      const out = normalizeSecurityType(v)
      if (out !== null) expect(isSecurityType(out), `${v} -> ${out}`).toBe(true)
    }
  })
})
