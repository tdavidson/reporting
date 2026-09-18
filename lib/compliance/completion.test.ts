import { describe, it, expect } from 'vitest'
import { overlayCompletion, parseYear, type DeadlineRow } from './completion'

const filed = (o: Partial<DeadlineRow> & { compliance_item_id: string }): DeadlineRow => ({
  portfolio_group: '', quarter: 0, year: 2026, status: 'filed', notes: null, filing_reference_url: null,
  created_at: '2026-03-20T15:00:00Z', ...o,
})

describe('overlayCompletion', () => {
  it('marks a setting completed from its occurrence row', () => {
    const [row] = overlayCompletion(
      [{ compliance_item_id: 'form-adv', portfolio_group: '', applies: 'yes' }],
      [filed({ compliance_item_id: 'form-adv', notes: 'Filed via IARD', filing_reference_url: 'https://x' })],
    )
    expect(row).toMatchObject({
      applies: 'yes', completed: true, completed_at: '2026-03-20T15:00:00Z',
      completed_note: 'Filed via IARD', completed_link: 'https://x',
    })
  })

  it('ignores the stale year-less completed flag on the setting', () => {
    const [row] = overlayCompletion(
      [{ compliance_item_id: 'form-adv', portfolio_group: '', completed: true, completed_note: 'old' }],
      [],
    )
    expect(row).toMatchObject({ completed: false, completed_at: null, completed_note: null })
  })

  it('matches quarterly and vehicle-quarterly keys', () => {
    const rows = overlayCompletion(
      [
        { compliance_item_id: 'v', portfolio_group: 'Fund II::Q3' },
        { compliance_item_id: 'v', portfolio_group: 'Fund II::Q2' },
      ],
      [filed({ compliance_item_id: 'v', portfolio_group: 'Fund II', quarter: 3 })],
    )
    expect(rows.map(r => r.completed)).toEqual([true, false])
  })

  it('only counts filed rows as completed', () => {
    const [row] = overlayCompletion(
      [{ compliance_item_id: 'x', portfolio_group: '' }],
      [filed({ compliance_item_id: 'x', status: 'in_progress' })],
    )
    expect(row.completed).toBe(false)
  })

  it('synthesizes a setting row for a filed occurrence with no setting', () => {
    const rows = overlayCompletion([], [filed({ compliance_item_id: 'x', quarter: 2 })])
    expect(rows).toEqual([expect.objectContaining({ compliance_item_id: 'x', portfolio_group: 'Q2', completed: true })])
  })
})

describe('parseYear', () => {
  const current = new Date().getUTCFullYear()
  it('accepts an integer year in 2000–2100, as a number or a numeric string', () => {
    expect(parseYear(2026)).toBe(2026)
    expect(parseYear('2025')).toBe(2025)
    expect(parseYear(2000)).toBe(2000)
    expect(parseYear(2100)).toBe(2100)
  })
  it('falls back to the current UTC year when missing, out of range or not an integer', () => {
    for (const v of [undefined, null, '', 'abc', 1999, 2101, 2026.5, NaN, {}, []]) {
      expect(parseYear(v)).toBe(current)
    }
  })
})
