// The dependency graph a fund of funds actually has: which underlying K-1s are outstanding, and
// what they hold up.
//
// Pure logic here; the loader is at the bottom. The rule is small and the value is entirely in
// applying it at the right moment — before a year is closed, rather than after a partner asks
// why their K-1 is late.

export type ReceivedK1Status = 'expected' | 'received' | 'amended' | 'not_expected'

export interface ReceivedK1 {
  companyId: string
  companyName: string
  taxYear: number
  status: ReceivedK1Status
  receivedDate: string | null
}

export interface K1DependencyReport {
  taxYear: number
  /** Holdings that owe a K-1 and have not delivered one. */
  outstanding: ReceivedK1[]
  /** Holdings whose K-1 arrived and was later amended — our own K-1 needs revisiting. */
  amended: ReceivedK1[]
  received: number
  /**
   * Why the year cannot be closed yet, or null.
   *
   * Outstanding blocks; amended does NOT. An amendment upstream means our figures are wrong, but
   * refusing to close for it would be backwards — the year needs closing so the amendment can be
   * made against a stable base, and the amendment path already handles a reopen.
   */
  blocker: string | null
}

export function reportK1Dependencies(rows: ReceivedK1[], taxYear: number): K1DependencyReport {
  const forYear = rows.filter(r => r.taxYear === taxYear)
  const outstanding = forYear.filter(r => r.status === 'expected')
  const amended = forYear.filter(r => r.status === 'amended')
  const received = forYear.filter(r => r.status === 'received').length

  const blocker =
    outstanding.length > 0
      ? `${outstanding.length} underlying fund${outstanding.length === 1 ? '' : 's'} ` +
        `${outstanding.length === 1 ? 'has' : 'have'} not delivered a ${taxYear} K-1: ` +
        outstanding.map(o => o.companyName).slice(0, 5).join(', ') +
        (outstanding.length > 5 ? `, and ${outstanding.length - 5} more` : '') +
        '. Our own figures for this year are provisional until they arrive.'
      : null

  return { taxYear, outstanding, amended, received, blocker }
}

/**
 * Holdings that should be expected to deliver a K-1 for a year.
 *
 * A `fund` holding files a partnership return, so it owes one. A company holding does not — it
 * files its own return and sends nothing. A crypto holding has no return at all. Deriving the
 * expectation rather than making someone enter it is what stops a newly-added fund holding
 * being silently absent from the chase list.
 */
export const K1_EXPECTED_HOLDING_TYPE = 'fund'

export function shouldExpectK1(holdingType: string | null | undefined): boolean {
  return holdingType === K1_EXPECTED_HOLDING_TYPE
}
