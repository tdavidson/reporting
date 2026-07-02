// Marry bank inflows to capital calls. Two paths:
//   allocate — turn the inflow into a per-LP allocated capital call (pro-rata by
//              commitment), replacing the auto-drafted two-line entry.
//   link     — match the inflow to a call the GP already recorded from a notice
//              (e.g. via the allocations page or draft-from-document): post that
//              entry, drop the auto-draft, and mark the transaction reconciled.

import type { SupabaseClient } from '@supabase/supabase-js'
import { loadOwnership } from './load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from './persist'
import { buildCapitalCallEntry } from './entries'

async function getTxn(admin: SupabaseClient, fundId: string, txnId: string) {
  const { data } = await admin
    .from('bank_transactions' as any)
    .select('id, journal_entry_id, amount, txn_date, description, status')
    .eq('id', txnId)
    .eq('fund_id', fundId)
    .maybeSingle()
  return data as any
}

/** Replace an inflow's draft with a per-LP allocated capital-call entry. */
export async function bookCapitalCallFromInflow(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  txnId: string
): Promise<{ entryId: string } | { error: string }> {
  const txn = await getTxn(admin, fundId, txnId)
  if (!txn) return { error: 'Transaction not found' }
  const total = Number(txn.amount)
  if (total <= 0) return { error: 'Only an inflow (deposit) can be booked as a capital call' }

  const owners = await loadOwnership(admin, fundId)
  if (owners.length === 0 || owners.every(o => o.commitment <= 0)) {
    return { error: 'No LP commitments found — add investors/commitments before allocating a call' }
  }
  const codes = await accountIdByCode(admin, fundId)
  const cashId = codes.get('1000')
  if (!cashId) return { error: 'Seed the chart of accounts first' }
  const capMap = await ensureCapitalAccounts(admin, fundId, owners.map(o => o.lpEntityId))

  const entry = buildCapitalCallEntry(
    { fundId, entryDate: txn.txn_date, memo: `Capital call — ${txn.description || ''}`.trim() },
    total,
    owners,
    capMap,
    cashId
  )
  const result = await persistEntry(admin, fundId, userId, entry, 'draft')
  if ('error' in result) return { error: result.error }

  // Point the transaction at the new entry, then drop the old two-line draft.
  const oldEntryId = txn.journal_entry_id
  await admin.from('bank_transactions' as any).update({ journal_entry_id: result.entryId, suggested_account_code: '3100' }).eq('id', txnId).eq('fund_id', fundId)
  if (oldEntryId && oldEntryId !== result.entryId) {
    await admin.from('journal_entries' as any).delete().eq('id', oldEntryId).eq('fund_id', fundId)
  }
  return { entryId: result.entryId }
}

/** Link an inflow to an existing recorded entry (post it, mark reconciled). */
export async function linkInflowToEntry(
  admin: SupabaseClient,
  fundId: string,
  txnId: string,
  entryId: string
): Promise<{ ok: true } | { error: string }> {
  const txn = await getTxn(admin, fundId, txnId)
  if (!txn) return { error: 'Transaction not found' }

  const { data: target } = await admin.from('journal_entries' as any).select('id').eq('id', entryId).eq('fund_id', fundId).maybeSingle()
  if (!target) return { error: 'Entry not found' }

  // Drop the auto-drafted entry (if any), then link + post the target.
  const oldEntryId = txn.journal_entry_id
  if (oldEntryId && oldEntryId !== entryId) {
    await admin.from('journal_entries' as any).delete().eq('id', oldEntryId).eq('fund_id', fundId)
  }
  await admin.from('journal_entries' as any).update({ status: 'posted', posted_at: new Date().toISOString() }).eq('id', entryId).eq('fund_id', fundId)
  await admin.from('bank_transactions' as any).update({ journal_entry_id: entryId, status: 'reconciled' }).eq('id', txnId).eq('fund_id', fundId)
  return { ok: true }
}

export interface CallCandidate {
  entryId: string
  amount: number
  entryDate: string
  memo: string | null
  status: string
}

/**
 * Recorded capital-call entries not yet linked to a bank transaction, with the
 * cash amount of each — the candidates an inflow can be matched to.
 */
export async function capitalCallCandidates(admin: SupabaseClient, fundId: string): Promise<CallCandidate[]> {
  const codes = await accountIdByCode(admin, fundId)
  const cashId = codes.get('1000')
  if (!cashId) return []

  const { data: entries } = await admin
    .from('journal_entries' as any)
    .select('id, entry_date, memo, status, journal_postings(account_id, amount)')
    .eq('fund_id', fundId)
    .eq('source_type', 'capital_call')
    .neq('status', 'void')
    .order('entry_date', { ascending: false })
    .limit(200)

  const { data: linkedRows } = await admin
    .from('bank_transactions' as any)
    .select('journal_entry_id')
    .eq('fund_id', fundId)
    .not('journal_entry_id', 'is', null)
  const linked = new Set(((linkedRows as any[]) ?? []).map(r => r.journal_entry_id))

  return ((entries as any[]) ?? [])
    .filter(e => !linked.has(e.id))
    .map(e => {
      const cash = (e.journal_postings ?? []).filter((p: any) => p.account_id === cashId).reduce((s: number, p: any) => s + Number(p.amount), 0)
      return { entryId: e.id, amount: cash, entryDate: e.entry_date, memo: e.memo, status: e.status }
    })
    .filter(c => c.amount > 0)
}
