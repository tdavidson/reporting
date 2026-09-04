import { describe, it, expect } from 'vitest'
import { capitalActionFromParam, withCapitalAction } from '@/lib/accounting/capital-action'

describe('capital accounts ?action=', () => {
  it('recognises the two panels and nothing else', () => {
    expect(capitalActionFromParam('call')).toBe('call')
    expect(capitalActionFromParam('distribution')).toBe('distribution')
    expect(capitalActionFromParam('share')).toBeNull()
    expect(capitalActionFromParam(null)).toBeNull()
  })

  it('carries the action across the entity picker onto the fund-first URL', () => {
    // /start links to the firm-wide landing; the row the user picks there must still open the panel.
    expect(withCapitalAction('/funds/abc/capital-accounts', 'call')).toBe('/funds/abc/capital-accounts?action=call')
    expect(withCapitalAction('/funds/abc/capital-accounts', null)).toBe('/funds/abc/capital-accounts')
  })
})
