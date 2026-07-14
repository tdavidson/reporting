// Shared bank-import logic used by the REST route and the agent tool, so humans
// and agents ingest through the identical path: parse → dedup → stage → draft.

import type { SupabaseClient } from '@supabase/supabase-js'
import { accountIdByCode, persistEntry } from './persist'
import { vehicleIdByName } from './vehicle-id'
import { parseTransactionsCsv, dedupHash, legacyDedupHash, suggestCategory, bankEntryPostings } from './bank'
import type { JournalEntry } from './types'

export interface ImportResult {
  imported: number
  skipped: number
  /** Which rows were skipped as duplicates, and why — so "12 skipped" is auditable rather
   *  than indistinguishable from "12 transactions silently lost". */
  skippedRows: string[]
  errors: string[]
}

export async function importBankTransactions(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  csv: string,
  source = 'csv'
): Promise<ImportResult | { error: string; errors?: string[] }> {
  const { rows, errors } = parseTransactionsCsv((csv ?? '').toString())
  if (rows.length === 0) return { error: errors[0] ?? 'No transactions found', errors }

  const codes = await accountIdByCode(admin, fundId, group)
  const cashId = codes.get('1000')
  if (!cashId) return { error: 'Seed the chart of accounts first' }

  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data: existing } = await admin.from('bank_transactions' as any).select('dedup_hash').eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  const seen = new Set(((existing as any[]) ?? []).map(r => r.dedup_hash))

  let imported = 0
  let skipped = 0
  /** WHICH rows were skipped, not just how many. A silent "12 skipped" is indistinguishable
   *  from "12 transactions we lost", and the user can't tell which without the detail. */
  const skippedRows: string[] = []

  // How many times we've already seen this exact (date, amount, description) in THIS file.
  // Two identical wire fees on one day are two transactions, not one — see dedupHash.
  const occurrences = new Map<string, number>()

  for (const row of rows) {
    const base = dedupHash(row, 0)
    const n = occurrences.get(base) ?? 0
    occurrences.set(base, n + 1)

    const hash = dedupHash(row, n)
    // Match against the legacy 32-bit hash too, so a file imported before the hash changed is
    // still recognised as already-imported rather than duplicated wholesale.
    const legacy = n === 0 ? legacyDedupHash(row) : null

    if (seen.has(hash) || (legacy && seen.has(legacy))) {
      skipped++
      skippedRows.push(`${row.date} ${row.description || ''} ${row.amount.toFixed(2)} — already imported`)
      continue
    }
    seen.add(hash)

    const cat = suggestCategory(row)
    const otherId = codes.get(cat.accountCode) ?? cashId
    const entry: JournalEntry = {
      fundId,
      entryDate: row.date,
      memo: row.description || cat.label,
      sourceType: cat.sourceType,
      postings: bankEntryPostings(row.amount, cashId, otherId),
    }
    const result = await persistEntry(admin, fundId, group, userId, entry, 'draft')
    if ('error' in result) { errors.push(`${row.date} ${row.description}: ${result.error}`); continue }

    const { error: insErr } = await admin.from('bank_transactions' as any).insert({
      fund_id: fundId,
      portfolio_group: group,
      vehicle_id: vehicleId,
      source,
      dedup_hash: hash,
      txn_date: row.date,
      amount: row.amount,
      description: row.description,
      counterparty: row.counterparty ?? null,
      status: 'drafted',
      journal_entry_id: result.entryId,
      suggested_account_code: cat.accountCode,
      imported_by: userId,
      raw: row,
    })
    if (insErr) {
      // The entry exists but its bank transaction doesn't — most often because a concurrent
      // import (a double-click) already claimed this hash via the unique constraint. Without
      // this cleanup the draft entry survives as an ORPHAN: unlinked, invisible on the bank
      // page, and postable from the Journal, which would DOUBLE-POST the transaction — once
      // through the orphan and once through the row that won the race.
      await admin.from('journal_entries' as any)
        .delete()
        .eq('id', result.entryId)
        .eq('fund_id', fundId)
      errors.push(`${row.date}: ${insErr.message}`)
      continue
    }
    imported++
  }

  return { imported, skipped, skippedRows, errors }
}
