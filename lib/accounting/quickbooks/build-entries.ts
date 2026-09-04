import { createHash } from 'crypto'
import type { QbTransaction } from './parse-journal'
import type { JournalEntry, Posting } from '@/lib/accounting/types'

/**
 * QuickBooks transactions + a confirmed mapping → journal entries. Pure.
 *
 * IDEMPOTENCE is the whole design constraint. Migrating years of history takes several passes:
 * import, spot a mis-mapped account, fix it, re-import. Each entry therefore carries a content
 * hash as `sourceRef` (`qb:<hash>`) — the same mechanism `txnRef` uses for portfolio
 * transactions and `dedupHash` for bank rows. Re-importing the same transaction finds the
 * existing entry instead of writing a second one; genuinely editing it in QuickBooks changes
 * the hash, which is what makes a corrected export re-import cleanly.
 *
 * The hash is line-ORDER-INSENSITIVE, because QuickBooks does not promise a stable split order
 * between exports and an order-sensitive hash would duplicate the whole ledger on a re-run.
 */

export function qbSourceRef(t: QbTransaction): string {
  const lines = t.lines
    .map(l => `${l.account}|${l.debit.toFixed(2)}|${l.credit.toFixed(2)}`)
    .sort()                                   // order-insensitive — see note above
    .join(';')
  const payload = `${t.date}|${t.type ?? ''}|${t.num ?? ''}|${lines}`
  return `qb:${createHash('sha256').update(payload).digest('hex').slice(0, 32)}`
}

export interface SkippedTransaction {
  transaction: QbTransaction
  reason: string
}

/** The payee a QuickBooks transaction names — the first split line that carries one. */
export function qbVendorName(t: QbTransaction): string | null {
  const line = t.lines.find(l => l.name && l.name.trim())
  return line?.name?.trim() ?? null
}

export function buildEntries(
  txns: QbTransaction[],
  /** QuickBooks account name → our account code. From the confirmed mapping. */
  mapping: Map<string, string>,
  /** Our account code → chart_of_accounts.id. From accountIdByCode(). */
  accountIds: Map<string, string>,
  fundId: string,
  /**
   * QuickBooks Name (lower-cased) → vendors.id, for the payee on each entry. Optional: without it
   * the Name column is read and dropped, as it was before vendors existed.
   */
  vendorIdByName?: Map<string, string>,
): { entries: JournalEntry[]; skipped: SkippedTransaction[] } {
  const entries: JournalEntry[] = []
  const skipped: SkippedTransaction[] = []

  for (const t of txns) {
    const postings: Posting[] = []
    let problem: string | null = null

    for (const l of t.lines) {
      const code = mapping.get(l.account)
      if (!code) { problem = `No mapping for QuickBooks account "${l.account}".`; break }
      const accountId = accountIds.get(code)
      if (!accountId) { problem = `Mapped code ${code} has no account in this vehicle's chart.`; break }

      // QuickBooks prints two positive columns; our ledger is signed (debit +, credit −).
      postings.push({
        accountId,
        amount: round2(l.debit - l.credit),
        currency: 'USD',        // persistEntry restamps this with the fund's currency.
      })
    }

    if (problem) { skipped.push({ transaction: t, reason: problem }); continue }

    const vendorName = qbVendorName(t)
    entries.push({
      fundId,
      entryDate: t.date,
      memo: memoFor(t),
      sourceType: 'quickbooks',
      sourceRef: qbSourceRef(t),
      vendorId: vendorName && vendorIdByName ? (vendorIdByName.get(vendorName.toLowerCase()) ?? null) : null,
      // Nothing posts on import. Every entry is reviewed on the journal page and posted
      // through the existing bulk-post surface — a bad mapping is then re-runnable rather
      // than needing reversal.
      status: 'draft',
      postings,
    })
  }

  return { entries, skipped }
}

/** Keep the QuickBooks identity in the memo — this is how someone traces an entry back. */
function memoFor(t: QbTransaction): string {
  const id = [t.type, t.num].filter(Boolean).join(' ')
  const body = t.memo ?? t.lines.find(l => l.memo)?.memo ?? ''
  return [id, body].filter(Boolean).join(' — ') || `QuickBooks ${t.date}`
}

const round2 = (n: number) => Math.round(n * 100) / 100
