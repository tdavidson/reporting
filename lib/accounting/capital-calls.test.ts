import { describe, it, expect } from 'vitest'
import { commitmentFigures } from './capital-calls'

// Capital is recognized when it is CALLED, not when the cash lands. These pin the four
// commitment-side numbers, which quietly disagreed with each other before:
//
//   outstanding used to be `commitment - funded` — uncalled capital PLUS the receivable —
//   so it overlapped with `receivable`, and every surface showing both double-counted.
//   It also contradicted live-report.ts (`commitment - paidIn`) and the LP snapshot's
//   `outstanding_balance`, so an LP could read a different number on their statement than
//   on their snapshot.
describe('commitmentFigures', () => {
  it('called but not yet funded: outstanding and receivable are disjoint', () => {
    // Committed 1,000,000. Called 400,000. Only 250,000 of that has actually arrived.
    const f = commitmentFigures(1_000_000, 400_000, 150_000)
    expect(f.called).toBe(400_000)
    expect(f.funded).toBe(250_000)        // called - receivable
    expect(f.outstanding).toBe(600_000)   // remaining to be CALLED, NOT 750,000
    expect(f.receivable).toBe(150_000)
  })

  it('total still owed is outstanding + receivable — the old, conflated definition', () => {
    const f = commitmentFigures(1_000_000, 400_000, 150_000)
    expect(f.outstanding + f.receivable).toBe(f.commitment - f.funded)
  })

  it('fully called and fully funded: nothing outstanding, nothing receivable', () => {
    const f = commitmentFigures(1_000_000, 1_000_000, 0)
    expect(f.funded).toBe(1_000_000)
    expect(f.outstanding).toBe(0)
    expect(f.receivable).toBe(0)
  })

  it('fully called, none funded: outstanding is zero — the whole commitment is a receivable', () => {
    // The case the old formula got most visibly wrong: it reported outstanding = 1,000,000
    // AND receivable = 1,000,000, i.e. the LP appeared to owe twice their commitment.
    const f = commitmentFigures(1_000_000, 1_000_000, 1_000_000)
    expect(f.outstanding).toBe(0)
    expect(f.receivable).toBe(1_000_000)
    expect(f.funded).toBe(0)
  })

  it('an events vehicle has no receivable, so called == funded', () => {
    const f = commitmentFigures(500_000, 300_000, 0)
    expect(f.called).toBe(f.funded)
    expect(f.outstanding).toBe(200_000)
  })

  it('rounds to cents', () => {
    const f = commitmentFigures(1000.005, 333.333, 0.005)
    expect(f.commitment).toBe(1000.01)
    expect(f.called).toBe(333.33)
    expect(f.funded).toBe(333.32)
  })
})
