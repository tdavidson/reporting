// Run AI categorization over staged bank transactions and apply the results by
// re-pointing each draft entry's non-cash posting. Shared by the REST route and
// the agent tool. Only touches simple two-line bank drafts — an entry that's
// been turned into an allocated capital call (many postings) is left alone.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import { loadPostedLedger } from './load'
import { accountIdByCode } from './persist'
import { buildCategorizePrompt, parseCategorizations, type TxnToCategorize } from './categorize-ai'

export interface CategorizeResult {
  considered: number
  updated: number
  errors: string[]
}

export async function runCategorization(
  admin: SupabaseClient,
  fundId: string,
  ids?: string[]
): Promise<CategorizeResult | { error: string }> {
  let q = admin
    .from('bank_transactions' as any)
    .select('id, journal_entry_id, txn_date, amount, description')
    .eq('fund_id', fundId)
    .eq('status', 'drafted')
  if (ids && ids.length) q = q.in('id', ids)
  const { data: rows } = await q
  const txns = (rows as any[]) ?? []
  if (txns.length === 0) return { considered: 0, updated: 0, errors: [] }

  const { accounts } = await loadPostedLedger(admin, fundId)
  if (accounts.length === 0) return { error: 'Seed the chart of accounts first' }
  const codes = await accountIdByCode(admin, fundId)
  const cashId = codes.get('1000')

  const toCategorize: TxnToCategorize[] = txns.map(t => ({ id: t.id, date: t.txn_date, amount: Number(t.amount), description: t.description ?? '' }))
  const { system, content } = buildCategorizePrompt(accounts, toCategorize)

  let provider
  try {
    provider = await createFundAIProviderWithOverride(admin, fundId)
  } catch (e) {
    return { error: `AI provider not configured: ${(e as Error).message}` }
  }

  let parsed
  try {
    const result = await provider.provider.createMessage({ model: provider.model, maxTokens: 2000, system, content })
    parsed = parseCategorizations(result.text)
  } catch (e) {
    return { error: `AI categorization failed: ${(e as Error).message}` }
  }

  const byId = new Map(parsed.map(c => [c.id, c]))
  const errors: string[] = []
  let updated = 0

  for (const t of txns) {
    const cat = byId.get(t.id)
    if (!cat) continue
    const newAccountId = codes.get(cat.accountCode)
    if (!newAccountId) { errors.push(`${t.id}: unknown account ${cat.accountCode}`); continue }

    // Only re-point simple two-line drafts (exactly one non-cash posting).
    const { data: postings } = await admin
      .from('journal_postings' as any)
      .select('id, account_id')
      .eq('journal_entry_id', t.journal_entry_id)
    const nonCash = ((postings as any[]) ?? []).filter(p => p.account_id !== cashId)
    if (nonCash.length !== 1) continue

    await admin.from('journal_postings' as any).update({ account_id: newAccountId }).eq('id', nonCash[0].id)
    await admin.from('journal_entries' as any).update({ source_type: cat.sourceType }).eq('id', t.journal_entry_id).eq('fund_id', fundId)
    await admin.from('bank_transactions' as any).update({ suggested_account_code: cat.accountCode }).eq('id', t.id).eq('fund_id', fundId)
    updated++
  }

  return { considered: txns.length, updated, errors }
}
