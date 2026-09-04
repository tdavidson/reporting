// The account register: one account's postings between two dates, with the balance carried in,
// each line's effect, and a running balance — what QuickBooks shows when you click a balance.
//
// Pure. The statements compute balances per account from the same postings (statements.ts); this
// is the detail behind one of those balances, laid out the way a bank statement is: opening,
// lines, closing. It exists so that "I posted an entry — where did it go?" has an answer on
// screen, and so the general-ledger workpaper can be built from the same rows.
//
// SIGN CONVENTION. Postings are signed with debits positive (types.ts). A register reads in the
// account's NORMAL side: a cash register goes up on a debit, a capital register goes up on a
// credit. `change` and `running` are on that side, so "the balance went up" means the same thing
// on every account. `debit` and `credit` are the raw columns for the accountant who wants them.

import type { Account, AccountType } from './types'
import { NORMAL_SIDE } from './types'

/** The posting shape the register needs — SourcedPosting (load.ts) satisfies it. */
export interface RegisterPosting {
  accountId: string
  /** Signed: debit > 0, credit < 0. */
  amount: number
  entryDate?: string | null
  entryId: string
  memo: string | null
  sourceType: string | null
}

export interface RegisterCounterAccount {
  id: string
  code: string
  name: string
}

export interface RegisterLine {
  entryId: string
  entryDate: string | null
  memo: string | null
  sourceType: string | null
  /** The OTHER accounts on the same entry, by code — what the cash went to, or came from. */
  counterAccounts: RegisterCounterAccount[]
  debit: number
  credit: number
  /** The posting's effect on the balance in the account's normal side. */
  change: number
  /** Balance after this line, in the account's normal side. */
  running: number
}

export interface AccountRegister {
  account: {
    id: string
    code: string
    name: string
    type: AccountType
    normalSide: 'debit' | 'credit'
  }
  period: { start: string | null; end: string | null }
  /** Balance carried in at `start` — zero when the window opens at inception. */
  opening: number
  lines: RegisterLine[]
  totals: { debit: number; credit: number }
  /** opening + every line's change. Equals the trial balance for this account as of `end`. */
  closing: number
}

const r = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Build the register for one account.
 *
 * `postings` is the whole ledger (every account), because a line's counter-accounts come from
 * the other postings on its entry. `accountsById` names them. `period` follows the statements'
 * convention: `start` and `end` are inclusive, either may be null, and a posting with no
 * entryDate is treated as inside the window rather than dropped — losing a posting would make
 * the closing balance disagree with the trial balance, which is worse than a line without a date.
 */
export function accountRegister(
  account: Account,
  postings: RegisterPosting[],
  accountsById: Map<string, Account>,
  period: { start?: string | null; end?: string | null } = {},
): AccountRegister {
  const start = period.start ?? null
  const end = period.end ?? null
  const normalSide = NORMAL_SIDE[account.type]
  const sign = normalSide === 'debit' ? 1 : -1

  // Counter-accounts per entry, built once over the whole ledger: every account on the entry
  // except this one, deduplicated, ordered by code so the same entry reads the same way from
  // any of its accounts' registers.
  const accountsByEntry = new Map<string, Set<string>>()
  for (const p of postings) {
    if (p.accountId === account.id) continue
    let set = accountsByEntry.get(p.entryId)
    if (!set) { set = new Set(); accountsByEntry.set(p.entryId, set) }
    set.add(p.accountId)
  }
  const counterFor = (entryId: string): RegisterCounterAccount[] =>
    Array.from(accountsByEntry.get(entryId) ?? [])
      .map(id => accountsById.get(id))
      .filter((a): a is Account => !!a)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map(a => ({ id: a.id, code: a.code, name: a.name }))

  let opening = 0
  const inWindow: RegisterPosting[] = []
  for (const p of postings) {
    if (p.accountId !== account.id) continue
    const d = p.entryDate ?? null
    if (d && start && d < start) { opening = r(opening + p.amount); continue }
    if (d && end && d > end) continue
    inWindow.push(p)
  }
  opening = r(opening * sign)

  // Date, then entry id: a stable order, so two entries on the same day never swap between
  // loads and the running balance is reproducible.
  inWindow.sort((a, b) =>
    (a.entryDate ?? '').localeCompare(b.entryDate ?? '') || a.entryId.localeCompare(b.entryId))

  let running = opening
  let totalDebit = 0
  let totalCredit = 0
  const lines: RegisterLine[] = inWindow.map(p => {
    const debit = p.amount > 0 ? p.amount : 0
    const credit = p.amount < 0 ? -p.amount : 0
    totalDebit = r(totalDebit + debit)
    totalCredit = r(totalCredit + credit)
    const change = r(p.amount * sign)
    running = r(running + change)
    return {
      entryId: p.entryId,
      entryDate: p.entryDate ?? null,
      memo: p.memo,
      sourceType: p.sourceType,
      counterAccounts: counterFor(p.entryId),
      debit, credit, change, running,
    }
  })

  return {
    account: { id: account.id, code: account.code, name: account.name, type: account.type, normalSide },
    period: { start, end },
    opening,
    lines,
    totals: { debit: totalDebit, credit: totalCredit },
    closing: running,
  }
}

/** Resolve `?account=` — a code ("1000") or an id — against the vehicle's chart. */
export function findAccount(accounts: Account[], ref: string): Account | undefined {
  const needle = ref.trim()
  if (!needle) return undefined
  return accounts.find(a => a.id === needle) ?? accounts.find(a => a.code === needle)
}
