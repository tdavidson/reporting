// Server glue for the text authoring surface: export the vehicle's ledger to
// text, and post authored text back as entries. Shared by the REST route and the
// agent tools. Account names are resolved by exact name or by the
// chart code embedded as the last component; unknown accounts are reported.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Account, AccountType, JournalEntry, Posting } from './types'
import { serializeLedger, parseLedgerText, textAccountName, codeFromAccountName, type TextEntryInput } from './text-ledger'
import { persistEntry } from './persist'
import { vehicleIdByName } from './vehicle-id'
import { isBalanced } from './ledger'

async function loadAccounts(admin: SupabaseClient, fundId: string, group: string): Promise<Account[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const { data } = await admin.from('chart_of_accounts' as any).select('id, code, name, type, subtype, lp_entity_id').eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  return ((data as any[]) ?? []).map(a => ({ id: a.id, fundId, code: a.code, name: a.name, type: a.type as AccountType, subtype: a.subtype ?? null, lpEntityId: a.lp_entity_id ?? null }))
}

/** Serialize a vehicle's books (excluding void entries) to plain text. Pass
 *  `asOf` to snapshot only entries on or before that date. */
export async function exportLedgerText(admin: SupabaseClient, fundId: string, group: string, asOf?: string): Promise<string> {
  const accounts = await loadAccounts(admin, fundId, group)
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  let q = admin
    .from('journal_entries' as any)
    .select('id, entry_date, memo, source_type, status, journal_postings(account_id, amount, currency)')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .neq('status', 'void')
  if (asOf) q = q.lte('entry_date', asOf)
  const { data } = await q.order('entry_date', { ascending: true }).limit(2000)

  const entries: TextEntryInput[] = ((data as any[]) ?? []).map(e => ({
    entryDate: e.entry_date,
    memo: e.memo,
    sourceType: e.source_type,
    status: e.status,
    postings: (e.journal_postings ?? []).map((p: any) => ({ accountId: p.account_id, amount: Number(p.amount), currency: p.currency ?? 'USD' })),
  }))
  return serializeLedger(accounts, entries)
}

export interface PostTextResult {
  posted: number
  errors: string[]
  unknownAccounts: string[]
}

/**
 * Parse authored text and persist each balanced entry. Default status is 'posted'
 * unless the entry's flag is '!' (draft) or `defaultStatus` overrides.
 */
export async function postLedgerText(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  text: string,
  defaultStatus?: 'draft' | 'posted'
): Promise<PostTextResult> {
  const { entries, errors } = parseLedgerText(text)
  const accounts = await loadAccounts(admin, fundId, group)

  const byName = new Map(accounts.map(a => [textAccountName(a), a.id]))
  const byCode = new Map(accounts.map(a => [a.code, a.id]))
  const resolve = (name: string): string | null => byName.get(name) ?? byCode.get(codeFromAccountName(name)) ?? null

  const unknownAccounts = new Set<string>()
  let posted = 0

  for (const e of entries) {
    const postings: Posting[] = []
    let ok = true
    for (const p of e.postings) {
      const accountId = resolve(p.account)
      if (!accountId) { unknownAccounts.add(p.account); ok = false; continue }
      postings.push({ accountId, amount: p.amount ?? 0, currency: p.currency, lpEntityId: null })
    }
    if (!ok) continue

    const entry: JournalEntry = { fundId, entryDate: e.date, memo: e.narration, sourceType: e.sourceType ?? 'manual', postings }
    if (!isBalanced(entry)) { errors.push(`Entry ${e.date} does not balance after resolving accounts`); continue }

    const status = defaultStatus ?? (e.flag === '!' ? 'draft' : 'posted')
    const result = await persistEntry(admin, fundId, group, userId, entry, status)
    if ('error' in result) errors.push(`Entry ${e.date}: ${result.error}`)
    else posted++
  }

  return { posted, errors, unknownAccounts: Array.from(unknownAccounts) }
}
