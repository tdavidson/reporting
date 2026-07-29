import { describe, it, expect } from 'vitest'
import { chunkIds, describeSkipped, summarizeSelection } from './journal-selection'

const entry = (id: string, status: string) => ({ id, status })

describe('summarizeSelection', () => {
  it('splits the selection into what can be ticked and what Post can act on', () => {
    const entries = [entry('a', 'draft'), entry('b', 'posted'), entry('c', 'draft')]
    const s = summarizeSelection(entries, new Set(['a', 'b']))
    expect(s.selectableIds).toEqual(['a', 'b', 'c'])
    expect(s.selectedIds).toEqual(['a', 'b'])
    expect(s.draftIds).toEqual(['a'])
    expect(s.allPageSelected).toBe(false)
  })

  it('never counts void entries — they have no checkbox', () => {
    const entries = [entry('a', 'draft'), entry('v', 'void')]
    const s = summarizeSelection(entries, new Set(['a', 'v']))
    expect(s.selectableIds).toEqual(['a'])
    expect(s.selectedIds).toEqual(['a'])
    // 'v' is ticked in the set but isn't selectable, so the page still counts as fully selected.
    expect(s.allPageSelected).toBe(true)
  })

  it('ignores ids left over from another page', () => {
    const s = summarizeSelection([entry('a', 'draft')], new Set(['a', 'from-page-2']))
    expect(s.selectedIds).toEqual(['a'])
    expect(s.allPageSelected).toBe(true)
  })

  it('is not "all selected" when there is nothing to select', () => {
    expect(summarizeSelection([], new Set()).allPageSelected).toBe(false)
    expect(summarizeSelection([entry('v', 'void')], new Set()).allPageSelected).toBe(false)
  })
})

describe('chunkIds', () => {
  it('splits at the batch size and keeps order', () => {
    expect(chunkIds(['a', 'b', 'c'], 2)).toEqual([['a', 'b'], ['c']])
  })

  it('returns nothing for an empty selection', () => {
    expect(chunkIds([])).toEqual([])
  })

  it('defaults to the endpoint 500-row cap', () => {
    const ids = Array.from({ length: 1001 }, (_, i) => `id-${i}`)
    expect(chunkIds(ids).map(c => c.length)).toEqual([500, 500, 1])
  })

  it('rejects a size that would loop forever', () => {
    expect(() => chunkIds(['a'], 0)).toThrow()
  })
})

describe('describeSkipped', () => {
  const closed = (id: string) => ({ id, reason: 'In a closed period (2026-01-01) — reopen it first.' })
  const unbalanced = (id: string) => ({ id, reason: 'Out of balance by 1.00 — fix it before posting.' })

  it('is empty when nothing was refused, so callers can concatenate it blindly', () => {
    expect(describeSkipped([])).toBe('')
  })

  it('names a single cause without repeating the count', () => {
    expect(describeSkipped([closed('a'), closed('b')])).toBe('2 skipped — closed period.')
  })

  it('breaks down mixed causes', () => {
    expect(describeSkipped([closed('a'), unbalanced('b'), unbalanced('c')]))
      .toBe('3 skipped — 1 closed period, 2 out of balance.')
  })

  it('buckets an unrecognised reason rather than dropping it', () => {
    expect(describeSkipped([{ id: 'a', reason: 'Something new from the server' }]))
      .toBe('1 skipped — not postable.')
  })
})
