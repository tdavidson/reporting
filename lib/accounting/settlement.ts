// Which call, or which distribution, did this wire settle?
//
// The ledger answers "how much does this partner still owe" (their 1300 balance) and "how much
// are they still owed" (their 2300 balance), and nothing more: a funding entry credits the
// receivable for a partner, not for a call. So a partner with two open calls and one wire has a
// receivable that is half of the two and a register that says nothing about which half.
//
// This decides it the way a bank would: OLDEST FIRST. A partner's settlements are applied to their
// lines in date order, each line taking what it can before the next. It is derived at read time,
// never stored — the register keeps what was asked for, the ledger keeps what arrived, and this is
// the join. Nothing to drift, nothing to backfill, and a corrected wire corrects every status.
//
// A settlement that exceeds every open line (a partner who overpaid, or wired before the call was
// posted) is left over rather than invented onto a line; the receivable balance still shows it.

import { roundCents } from './ledger'

export type LineStatus = 'open' | 'partial' | 'settled'

/** A frozen register line: a partner's amount on one call or distribution. */
export interface RegisterLine {
  id: string
  lpEntityId: string
  /** The call or declaration date. Ordering key for FIFO. */
  date: string
  amount: number
}

/** Money that moved against a partner's receivable or payable. Always positive. */
export interface Settlement {
  lpEntityId: string
  date: string
  amount: number
}

export interface SettledLine {
  id: string
  amount: number
  settled: number
  outstanding: number
  status: LineStatus
  /** The date of the settlement that completed the line, once it is complete. */
  settledOn: string | null
  /** The date of the most recent settlement applied to the line, complete or not. */
  lastSettlementOn: string | null
}

const CENT = 0.005

/** Apply each partner's settlements to their lines, oldest line first. Pure. */
export function applySettlements(lines: RegisterLine[], settlements: Settlement[]): Map<string, SettledLine> {
  const out = new Map<string, SettledLine>()

  const linesByLp = new Map<string, RegisterLine[]>()
  for (const l of lines) {
    const arr = linesByLp.get(l.lpEntityId) ?? []
    arr.push(l)
    linesByLp.set(l.lpEntityId, arr)
  }
  const settlementsByLp = new Map<string, Settlement[]>()
  for (const s of settlements) {
    if (!(s.amount > CENT)) continue
    const arr = settlementsByLp.get(s.lpEntityId) ?? []
    arr.push(s)
    settlementsByLp.set(s.lpEntityId, arr)
  }

  for (const [lpEntityId, lpLines] of Array.from(linesByLp.entries())) {
    const ordered = [...lpLines].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    const pool = [...(settlementsByLp.get(lpEntityId) ?? [])].sort((a, b) => a.date.localeCompare(b.date))
    let poolIndex = 0
    let poolRemaining = pool.length > 0 ? pool[0].amount : 0

    for (const line of ordered) {
      const amount = roundCents(line.amount)
      let settled = 0
      let settledOn: string | null = null
      let lastSettlementOn: string | null = null
      while (settled + CENT < amount && poolIndex < pool.length) {
        const take = roundCents(Math.min(amount - settled, poolRemaining))
        settled = roundCents(settled + take)
        poolRemaining = roundCents(poolRemaining - take)
        if (take > 0) lastSettlementOn = pool[poolIndex].date
        if (settled + CENT >= amount) settledOn = pool[poolIndex].date
        if (poolRemaining <= CENT) {
          poolIndex++
          poolRemaining = poolIndex < pool.length ? pool[poolIndex].amount : 0
        }
      }
      const outstanding = roundCents(Math.max(0, amount - settled))
      const status: LineStatus = outstanding <= CENT ? 'settled' : settled > CENT ? 'partial' : 'open'
      out.set(line.id, { id: line.id, amount, settled, outstanding, status, settledOn: status === 'settled' ? settledOn : null, lastSettlementOn })
    }
  }
  return out
}

export interface RegisterStatus {
  status: LineStatus
  settled: number
  outstanding: number
  /** Something is still outstanding past the due date. */
  overdue: boolean
}

/** Roll a call's or distribution's lines up to one status. Pure. */
export function registerStatus(
  lines: Pick<SettledLine, 'settled' | 'outstanding'>[],
  dueDate: string | null | undefined,
  today: string,
): RegisterStatus {
  const settled = roundCents(lines.reduce((s, l) => s + l.settled, 0))
  const outstanding = roundCents(lines.reduce((s, l) => s + l.outstanding, 0))
  const status: LineStatus = outstanding <= CENT ? 'settled' : settled > CENT ? 'partial' : 'open'
  return { status, settled, outstanding, overdue: outstanding > CENT && !!dueDate && dueDate < today }
}

/**
 * Settlements from the posted ledger, for one direction.
 *
 * A call is funded by a CREDIT to the receivable (negative posting) carrying the partner; a
 * distribution is paid by a DEBIT to the payable (positive posting). The issuing and declaring
 * entries post the opposite sign, so a sign filter is the whole distinction.
 */
export function settlementsFromPostings(
  postings: { accountId: string; amount: number; lpEntityId?: string | null; entryDate?: string | null }[],
  accountId: string,
  direction: 'receivable' | 'payable',
): Settlement[] {
  const out: Settlement[] = []
  for (const p of postings) {
    if (p.accountId !== accountId || !p.lpEntityId) continue
    const amount = direction === 'receivable' ? -p.amount : p.amount
    if (amount <= CENT) continue
    out.push({ lpEntityId: p.lpEntityId, date: p.entryDate ?? '', amount: roundCents(amount) })
  }
  return out
}
