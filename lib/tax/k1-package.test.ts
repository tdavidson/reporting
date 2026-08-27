import { describe, it, expect } from 'vitest'
import { blockersIn, type K1PackageWarning } from './k1-package'

function warn(kind: K1PackageWarning['kind'], detail = 'x'): K1PackageWarning {
  return { kind, detail }
}

describe('blockersIn', () => {
  it('blocks on a missing or lapsed tax form', () => {
    // The K-1 would carry no certified identification, which is the problem the whole chain from
    // T3 onward exists to prevent.
    expect(blockersIn([warn('tax_form')])).toHaveLength(1)
  })

  it('blocks on a capital account that does not foot', () => {
    // Item L is an assertion about the partner's basis. One that does not add up is not a
    // disclosure, it is an error.
    expect(blockersIn([warn('roll_forward')])).toHaveLength(1)
  })

  it('does not block on a tie-out variance', () => {
    // The fund's character does not cover every allocated dollar — uncharacterised distributions,
    // income nobody classified. Real, and more useful reported beside the K-1 than as a refusal.
    expect(blockersIn([warn('tie_out')])).toEqual([])
  })

  it('does not block on gain nobody could date', () => {
    // Average cost has no lots to point at. That limits the short/long split; it does not make
    // the package wrong.
    expect(blockersIn([warn('undetermined_gain')])).toEqual([])
  })

  it('does not block on a line that could not be derived', () => {
    expect(blockersIn([warn('not_derivable')])).toEqual([])
  })

  it('does not block on fund income with no partner bucket', () => {
    expect(blockersIn([warn('unallocated')])).toEqual([])
  })

  it('picks the blockers out of a mixed list, keeping their details', () => {
    const warnings = [
      warn('not_derivable', 'qualified dividends'),
      warn('tax_form', 'W-8BEN expired 2025-12-31'),
      warn('tie_out', 'variance of 1200'),
      warn('roll_forward', 'item L does not foot'),
    ]
    const blockers = blockersIn(warnings)
    expect(blockers.map(b => b.kind)).toEqual(['tax_form', 'roll_forward'])
    expect(blockers[0].detail).toContain('expired')
  })

  it('is empty for a clean package', () => {
    expect(blockersIn([])).toEqual([])
  })
})
