import { describe, it, expect } from 'vitest'

import { currentSectionFor, navSectionsFor, vehicleTargetPath, visibleChildrenFor } from '@/components/app-sidebar'
import type { Domain } from '@/lib/access/domains'
import type { FeatureKey } from '@/lib/types/features'
import type { AccessLevel } from '@/lib/access/effective'

/**
 * The desktop nav is a rail of sections and a panel of the current section's children. Both
 * read the shared nav list; these pin the two decisions the panel adds on top of it — which
 * section the URL is in, and where the entity switcher sends you.
 */

type Access = (domain: Domain, feature?: FeatureKey) => AccessLevel
const allowAll: Access = () => 'write'
const sections = navSectionsFor(true, allowAll, { review: 1, pendingActions: 1 })

describe('currentSectionFor', () => {
  it('finds the section by its own path', () => {
    expect(currentSectionFor('/deals', sections)?.href).toBe('/deals')
    expect(currentSectionFor('/funds', sections)?.href).toBe('/funds')
  })

  it('finds Portfolio from a child at an unrelated path', () => {
    // Portfolio's children live at /investments, /notes, /letters — not under /dashboard.
    expect(currentSectionFor('/investments', sections)?.href).toBe('/dashboard')
    expect(currentSectionFor('/notes/abc', sections)?.href).toBe('/dashboard')
  })

  it('finds Entities from deep inside an entity, listed page or not', () => {
    expect(currentSectionFor('/funds/f2/journal', sections)?.href).toBe('/funds')
    expect(currentSectionFor('/funds/f2/allocation-terms', sections)?.href).toBe('/funds')
  })

  it('does not confuse /fund-holdings with /funds', () => {
    expect(currentSectionFor('/fund-holdings', sections)?.href).toBe('/dashboard')
  })

  it('is null off every section, so there is no panel there', () => {
    expect(currentSectionFor('/companies/abc', sections)).toBeNull()
    expect(currentSectionFor('/updates', sections)).toBeNull()
  })
})

describe('the Entities panel', () => {
  const entities = sections.find(s => s.href === '/funds')!

  it('lists firm-wide pages outside an entity and entity-first pages inside one', () => {
    const firmWide = visibleChildrenFor(entities, true, allowAll, {})
    expect(firmWide.map(c => c.href)).toContain('/funds/journal')
    const inside = visibleChildrenFor(entities, true, allowAll, { fundSeg: 'f2', kind: 'fund' })
    expect(inside[0]).toMatchObject({ href: '/funds/f2', label: 'Overview', exact: true })
    expect(inside.map(c => c.href)).toContain('/funds/f2/journal')
  })
})

describe('vehicleTargetPath', () => {
  it('keeps the page and swaps the entity', () => {
    expect(vehicleTargetPath('/funds/a/journal', 'b')).toBe('/funds/b/journal')
    expect(vehicleTargetPath('/funds/a', 'b')).toBe('/funds/b')
  })

  it('drops anything deeper than the section, which belongs to the entity being left', () => {
    expect(vehicleTargetPath('/funds/a/capital-accounts/lp-9', 'b')).toBe('/funds/b/capital-accounts')
  })

  it('enters an entity from the firm-wide landing on the same page', () => {
    expect(vehicleTargetPath('/funds/journal', 'b')).toBe('/funds/b/journal')
    expect(vehicleTargetPath('/funds', 'b')).toBe('/funds/b')
  })

  it('returns to the firm-wide landing for "All entities"', () => {
    expect(vehicleTargetPath('/funds/a/journal', null)).toBe('/funds/journal')
    expect(vehicleTargetPath('/funds/a', null)).toBe('/funds')
    expect(vehicleTargetPath('/funds/journal', null)).toBe('/funds/journal')
  })

  it('goes to the entity overview from outside the section', () => {
    expect(vehicleTargetPath('/dashboard', 'b')).toBe('/funds/b')
    expect(vehicleTargetPath('/dashboard', null)).toBe('/funds')
  })
})
