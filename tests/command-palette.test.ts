import { describe, it, expect } from 'vitest'

import { pageEntries, matchEntries, groupEntries } from '@/lib/nav/palette'
import { navSectionsFor } from '@/components/app-sidebar'
import type { Domain } from '@/lib/access/domains'
import type { FeatureKey } from '@/lib/types/features'
import type { AccessLevel } from '@/lib/access/effective'

/**
 * The command palette is the third rendering of the nav, and it is built from the same two
 * functions as the other two. These pin the consequences: it offers nothing the sidebar hides,
 * it gives each entity the pages its KIND has, and "jour" finds every Journal there is.
 */

type Access = (domain: Domain, feature?: FeatureKey) => AccessLevel
const allowAll: Access = () => 'write'
const allowOnly = (...domains: Domain[]): Access => d => (domains.includes(d) ? 'write' : 'none')

const vehicles = [
  { name: 'Example Fund II', id: 'f2', kind: 'fund' },
  { name: 'EV Management', id: 'mc', kind: 'manco' },
  { name: 'Legacy Fund', id: null, kind: null },
]

describe('pageEntries', () => {
  it('lists every section the sidebar lists, in the same order', () => {
    const sections = navSectionsFor(true, allowAll).map(s => s.href)
    const entries = pageEntries(true, allowAll).filter(e => e.group === 'pages' && !e.hint).map(e => e.href)
    expect(entries).toEqual(sections)
  })

  it('never offers a page the user cannot open', () => {
    const entries = pageEntries(false, allowOnly('portfolio'))
    const hrefs = entries.map(e => e.href)
    expect(hrefs).toContain('/dashboard')
    expect(hrefs).toContain('/investments')
    expect(hrefs).not.toContain('/lps')
    expect(hrefs).not.toContain('/funds')
    expect(hrefs).not.toContain('/usage')
    expect(hrefs.some(h => h.startsWith('/funds/'))).toBe(false)
  })

  it('gives each entity its own pages, filtered by kind', () => {
    const entries = pageEntries(true, allowAll, { vehicles })
    const hrefs = entries.map(e => e.href)
    // A fund has capital accounts; a management company does not.
    expect(hrefs).toContain('/funds/f2/capital-accounts')
    expect(hrefs).not.toContain('/funds/mc/capital-accounts')
    expect(hrefs).toContain('/funds/mc/journal')
    // A legacy vehicle is addressed by its encoded name.
    expect(hrefs).toContain('/funds/Legacy%20Fund/journal')
  })

  it('lists the entity itself once, in its own group, pointing at its overview', () => {
    const entries = pageEntries(true, allowAll, { vehicles })
    const entities = entries.filter(e => e.group === 'entities')
    expect(entities.map(e => e.label)).toEqual(['Example Fund II', 'EV Management', 'Legacy Fund'])
    expect(entities[0].href).toBe('/funds/f2')
    // …and never as an "Overview" page row.
    expect(entries.some(e => e.label === 'Overview')).toBe(false)
  })

  it('hides Review and Pending Actions at zero, like the sidebar', () => {
    const quiet = pageEntries(true, allowAll, { badges: { review: 0, pendingActions: 0 } }).map(e => e.href)
    expect(quiet).not.toContain('/review')
    expect(quiet).not.toContain('/pending-actions')
    const busy = pageEntries(true, allowAll, { badges: { review: 2, pendingActions: 1 } }).map(e => e.href)
    expect(busy).toContain('/review')
    expect(busy).toContain('/pending-actions')
  })

  it('has a unique id per entry, so the list has a stable key and an active row', () => {
    const ids = pageEntries(true, allowAll, { vehicles, fofActive: true }).map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('matchEntries', () => {
  const entries = pageEntries(true, allowAll, { vehicles })

  it('at rest offers the sections and nothing else', () => {
    const rest = matchEntries('', entries)
    expect(rest.every(e => e.group === 'pages' && !e.hint)).toBe(true)
    expect(rest.map(e => e.href)).toContain('/dashboard')
  })

  it('finds every Journal for "jour", one per entity plus the firm-wide one', () => {
    const journals = matchEntries('jour', entries).filter(e => e.label === 'Journal')
    expect(journals.map(e => e.hint)).toEqual(['All entities', 'Example Fund II', 'EV Management', 'Legacy Fund'])
  })

  it('ranks a label match above a hint match', () => {
    // "fund" is in the label of nothing in the fund's pages but the hint of every Example Fund II
    // page; "Fund-of-funds report" would be a label match. Use "example": the entity row's label
    // is "Example Fund II", each of its pages carries it as a hint — the entity comes first.
    const [first] = matchEntries('example', entries)
    expect(first.group).toBe('entities')
    expect(first.label).toBe('Example Fund II')
  })

  it('requires every token to match, across label and hint', () => {
    const hits = matchEntries('journal management', entries)
    expect(hits).toHaveLength(1)
    expect(hits[0].href).toBe('/funds/mc/journal')
  })

  it('matches without regard to case or accents', () => {
    expect(matchEntries('JOURNAL', entries).length).toBeGreaterThan(0)
    const accented = [{ id: 'x', label: 'Société Générale', href: '/companies/x', group: 'companies' as const }]
    expect(matchEntries('societe', accented)).toHaveLength(1)
  })

  it('returns nothing for a query nothing matches', () => {
    expect(matchEntries('zzzz', entries)).toEqual([])
  })
})

describe('groupEntries', () => {
  it('buckets in render order and drops empty groups', () => {
    const entries = pageEntries(true, allowAll, { vehicles })
    const groups = groupEntries(matchEntries('jour', entries))
    expect(groups.map(g => g.group)).toEqual(['pages'])
    const all = groupEntries(entries)
    expect(all.map(g => g.group)).toEqual(['pages', 'entities'])
  })
})
