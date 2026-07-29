import { describe, it, expect } from 'vitest'
import { describeStrandedCapital } from './pooled-capital-check'
import { commitmentFigures } from './capital-calls'

describe('describeStrandedCapital', () => {
  it('is silent when nothing sits on the pooled account', () => {
    const s = describeStrandedCapital({ pooledPostings: 0, pooledAmount: 0, taggedPostings: 0, perLpAccounts: 20 })
    expect(s.stranded).toBe(false)
    expect(s.message).toBeNull()
  })

  it('flags the Ocrolus shape — capital pooled, not one partner account', () => {
    const s = describeStrandedCapital({ pooledPostings: 32, pooledAmount: -776252.4, taggedPostings: 28, perLpAccounts: 0 })
    expect(s.stranded).toBe(true)
    expect(s.message).toContain('32 postings')
    expect(s.message).toContain('$776,252')
    expect(s.message).toContain('No partner has a capital account')
    // The tagged/untagged split is what decides whether the repair can run unattended.
    expect(s.message).toContain('28 can be attributed automatically; 4 carry no LP')
  })

  it('still flags a HALF-attributed vehicle, and says why that is worse', () => {
    const s = describeStrandedCapital({ pooledPostings: 3, pooledAmount: -100, taggedPostings: 3, perLpAccounts: 12 })
    expect(s.stranded).toBe(true)
    expect(s.message).toContain('makes the rest look like real zeroes')
    expect(s.message).toContain('All 3 can be attributed automatically')
  })
})

describe('commitmentFigures — funded can never be negative', () => {
  it('computes the normal case unchanged', () => {
    const f = commitmentFigures(100_000, 60_000, 10_000)
    expect(f).toMatchObject({ commitment: 100_000, called: 60_000, funded: 50_000, outstanding: 40_000, receivable: 10_000 })
    expect(f.fundedUnderflow).toBe(false)
  })

  it('clamps and flags the impossible case instead of reporting negative cash', () => {
    // The exact Ocrolus reading: capital stranded so called=0, but the 1300 receivable stands.
    const f = commitmentFigures(17_250, 0, 17_250)
    expect(f.funded).toBe(0)
    expect(f.fundedUnderflow).toBe(true)
    // Committed and outstanding are still meaningful — only funded was impossible.
    expect(f.commitment).toBe(17_250)
    expect(f.outstanding).toBe(17_250)
  })

  it('does not flag a sub-cent rounding artefact', () => {
    const f = commitmentFigures(100, 50, 50.004)
    expect(f.fundedUnderflow).toBe(false)
  })

  it('leaves an LP with no receivable alone', () => {
    const f = commitmentFigures(5_750, 0, 0)
    expect(f.funded).toBe(0)
    expect(f.fundedUnderflow).toBe(false)
  })
})
