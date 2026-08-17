import { describe, it, expect } from 'vitest'
import { exitPostings, type ExitAccounts } from './from-portfolio'

/**
 * CHARACTERIZATION, not a change request. A fund-of-funds distribution retires part of a
 * position's basis and leaves the rest outstanding; the FoF register (lib/portfolio/fof-register.ts)
 * produces `proceeds` rows on that assumption. If this test ever fails, the register is
 * misstating every partially-realized position — fix the register or the exit path deliberately,
 * do not update these numbers to match.
 */
/**
 * `unrealizedIncomeId` is REQUIRED for marks to unwind: the unwind is a reclassification
 * (credit the 1200 asset, debit the 4200 income that recognised it), so without the income
 * leg there is nowhere to put the other side and exitPostings correctly does nothing rather
 * than unbalancing the entry. Real callers pass it — from-portfolio.ts:505 supplies the
 * pooled UNREALIZED_INCOME account. A fixture that omits it silently tests the wrong branch.
 */
const acc: ExitAccounts = {
  cashId: 'cash', gainId: 'gain', costId: 'cost', unrealizedId: 'unreal', fxId: 'fx',
  unrealizedIncomeId: 'unreal-income', fxIncomeId: 'fx-income',
}

const balance = (ps: { amount: number }[]) => ps.reduce((a, p) => a + p.amount, 0)
const forAccount = (ps: { accountId: string; amount: number }[], id: string) =>
  balance(ps.filter(p => p.accountId === id))

describe('exitPostings — partial realization', () => {
  it('retires only the basis given and leaves the rest of the position standing', () => {
    // Position: 1,000 cost, 400 accumulated unrealized. Distribution returns 250 of basis.
    const ps = exitPostings(
      { proceeds: 300, basis: 250, carried: { cost: 1000, unrealized: 400, fx: 0 } },
      acc,
    )
    expect(balance(ps)).toBe(0)                                   // balanced, always
    expect(forAccount(ps, 'cost')).toBe(-250)                     // credit 250, not 1000

    // Marks unwind PRO-RATA to basis retired: 250/1000 = 25% of the 400 unrealized.
    expect(forAccount(ps, 'unreal')).toBe(-100)
  })

  it('leaves no residual unrealized when the whole position is retired', () => {
    const ps = exitPostings(
      { proceeds: 1500, basis: 1000, carried: { cost: 1000, unrealized: 400, fx: 0 } },
      acc,
    )
    expect(balance(ps)).toBe(0)
    expect(forAccount(ps, 'unreal')).toBe(-400)
  })

  it('unwinds the mark as a reclassification, not a new gain', () => {
    // Both legs, netting to zero on cumulative P&L: the gain MOVES from unrealized to
    // realized rather than being recognised twice.
    const ps = exitPostings(
      { proceeds: 300, basis: 250, carried: { cost: 1000, unrealized: 400, fx: 0 } },
      acc,
    )
    expect(forAccount(ps, 'unreal')).toBe(-100)
    expect(forAccount(ps, 'unreal-income')).toBe(100)
  })

  it('skips the unwind entirely when no unrealized-income account is available', () => {
    // A chart seeded before 4200 existed. Retiring cost without the income leg would
    // unbalance the entry, so the mark is deliberately left in place.
    const { unrealizedIncomeId: _omit, ...noIncome } = acc
    const ps = exitPostings(
      { proceeds: 300, basis: 250, carried: { cost: 1000, unrealized: 400, fx: 0 } },
      noIncome as ExitAccounts,
    )
    expect(balance(ps)).toBe(0)
    expect(forAccount(ps, 'unreal')).toBe(0)
  })

  it('books a return-of-capital distribution with no gain', () => {
    // The common FoF case: proceeds exactly equal the basis retired.
    const ps = exitPostings(
      { proceeds: 500, basis: 500, carried: { cost: 2000, unrealized: 0, fx: 0 } },
      acc,
    )
    expect(balance(ps)).toBe(0)
    expect(forAccount(ps, 'gain')).toBe(0)
    expect(forAccount(ps, 'cash')).toBe(500)
  })
})
