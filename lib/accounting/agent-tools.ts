// Agent tool registry — merges the pure manifest (name/description/scope/schema)
// with server-side handlers. Both the MCP endpoint and the REST agent endpoint
// dispatch through this list, so the tool surface is identical however an agent
// connects. Client code that only needs the metadata imports the manifest.

import type { SupabaseClient } from '@supabase/supabase-js'
import { AGENT_TOOL_MANIFEST, type AgentToolMeta } from './agent-tools-manifest'
import { DEFAULT_CHART } from './chart'
import { loadPostedLedger, loadEntityNames, loadOwnership } from './load'
import { accountIdByCode, persistEntry } from './persist'
import { computeCapitalAccounts, totalNav } from './capital-account'
import { trialBalance, balanceSheet, incomeStatement } from './statements'
import { reconcileCapital, type AdminCapitalAccount } from './reconcile'
import { runWaterfall } from './waterfall'
import { buildAllocationEntry, type AllocationBody } from './allocation-actions'
import { importBankTransactions } from './bank-import'
import { runCategorization } from './categorize-run'
import { bookCapitalCallFromInflow } from './bank-match'
import { summarizeBankRec, type BankTxnState } from './bank'
import { accountBalances } from './ledger'
import type { JournalEntry, Posting } from './types'

export interface AgentToolContext {
  admin: SupabaseClient
  fundId: string
  userId: string | null
}

export type AgentToolHandler = (ctx: AgentToolContext, input: any) => Promise<any>
export interface AgentTool extends AgentToolMeta {
  handler: AgentToolHandler
}

const HANDLERS: Record<string, AgentToolHandler> = {
  list_accounts: async ({ admin, fundId }) => {
    const { accounts } = await loadPostedLedger(admin, fundId)
    return accounts.map(a => ({ code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
  },

  seed_chart: async ({ admin, fundId }) => {
    const { count } = await admin.from('chart_of_accounts' as any).select('id', { count: 'exact', head: true }).eq('fund_id', fundId)
    if ((count ?? 0) > 0) return { seeded: 0, message: 'Chart already exists' }
    const rows = DEFAULT_CHART.map(a => ({ fund_id: fundId, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
    const { data, error } = await admin.from('chart_of_accounts' as any).insert(rows).select('code')
    if (error) throw new Error(error.message)
    return { seeded: (data as any[])?.length ?? 0 }
  },

  list_entities: async ({ admin, fundId }) => {
    const [names, ownership] = await Promise.all([loadEntityNames(admin, fundId), loadOwnership(admin, fundId)])
    const commitment = new Map(ownership.map(o => [o.lpEntityId, o.commitment]))
    return Array.from(names.entries()).map(([lpEntityId, name]) => ({ lpEntityId, name, commitment: commitment.get(lpEntityId) ?? 0 }))
  },

  capital_accounts: async ({ admin, fundId }) => {
    const [{ capitalPostings }, names] = await Promise.all([loadPostedLedger(admin, fundId), loadEntityNames(admin, fundId)])
    const accounts = computeCapitalAccounts(capitalPostings)
    const rows = Array.from(accounts.entries()).map(([lpEntityId, account]) => ({ lpEntityId, name: names.get(lpEntityId) ?? lpEntityId, ...account }))
    return { rows, nav: totalNav(accounts) }
  },

  financial_statements: async ({ admin, fundId }) => {
    const { accounts, postings } = await loadPostedLedger(admin, fundId)
    return {
      trialBalance: trialBalance(accounts, postings),
      balanceSheet: balanceSheet(accounts, postings),
      incomeStatement: incomeStatement(accounts, postings),
    }
  },

  list_journal: async ({ admin, fundId }, input) => {
    const limit = Math.min(Number(input?.limit ?? 100), 500)
    const { data } = await admin.from('journal_entries' as any).select('*, journal_postings(*)').eq('fund_id', fundId).order('entry_date', { ascending: false }).limit(limit)
    return data ?? []
  },

  post_entry: async ({ admin, fundId, userId }, input) => {
    const codes = await accountIdByCode(admin, fundId)
    const postings: Posting[] = (input.postings ?? []).map((p: any) => {
      const accountId = p.accountId ?? codes.get(p.accountCode)
      if (!accountId) throw new Error(`Unknown account code ${p.accountCode}`)
      return { accountId, amount: Number(p.amount), currency: p.currency ?? 'USD', lpEntityId: p.lpEntityId ?? null }
    })
    const entry: JournalEntry = { fundId, entryDate: input.entryDate, memo: input.memo ?? null, sourceType: input.sourceType ?? 'manual', postings }
    const result = await persistEntry(admin, fundId, userId, entry, input.status === 'draft' ? 'draft' : 'posted')
    if ('error' in result) throw new Error(result.error)
    return { entryId: result.entryId }
  },

  allocation: async ({ admin, fundId, userId }, input) => {
    const built = await buildAllocationEntry(admin, fundId, input as AllocationBody)
    if ('error' in built) throw new Error(built.error)
    if (input.post === false) return { preview: built.entry }
    const result = await persistEntry(admin, fundId, userId, built.entry, 'posted')
    if ('error' in result) throw new Error(result.error)
    return { entryId: result.entryId, entry: built.entry }
  },

  reconcile: async ({ admin, fundId }, input) => {
    const { capitalPostings } = await loadPostedLedger(admin, fundId)
    const ledger = computeCapitalAccounts(capitalPostings)
    const adminMap = new Map<string, AdminCapitalAccount>(Object.entries(input?.admin ?? {}))
    return reconcileCapital(ledger, adminMap, typeof input?.tolerance === 'number' ? input.tolerance : 0.01)
  },

  run_waterfall: async (_ctx, input) => runWaterfall(Number(input.distributable), input.terms, input.state),

  import_bank_transactions: async ({ admin, fundId, userId }, input) => {
    const result = await importBankTransactions(admin, fundId, userId, String(input.csv ?? ''), String(input.source ?? 'csv'))
    if ('error' in result) throw new Error(result.error)
    return result
  },

  categorize_bank_transactions: async ({ admin, fundId }, input) => {
    const result = await runCategorization(admin, fundId, Array.isArray(input?.ids) ? input.ids : undefined)
    if ('error' in result) throw new Error(result.error)
    return result
  },

  book_capital_call: async ({ admin, fundId, userId }, input) => {
    const result = await bookCapitalCallFromInflow(admin, fundId, userId, String(input.bankTransactionId))
    if ('error' in result) throw new Error(result.error)
    return result
  },

  list_bank_transactions: async ({ admin, fundId }) => {
    const { data } = await admin
      .from('bank_transactions' as any)
      .select('id, txn_date, amount, description, counterparty, status, suggested_account_code, journal_entry_id')
      .eq('fund_id', fundId)
      .order('txn_date', { ascending: false })
      .limit(1000)
    return data ?? []
  },

  bank_reconciliation: async ({ admin, fundId }) => {
    const { accounts, postings } = await loadPostedLedger(admin, fundId)
    const cash = accounts.find(a => a.code === '1000')
    const ledgerCashBalance = cash ? (accountBalances(postings).get(cash.id) ?? 0) : 0
    const { data } = await admin.from('bank_transactions' as any).select('amount, status').eq('fund_id', fundId).neq('status', 'ignored')
    const txns: BankTxnState[] = ((data as any[]) ?? []).map(t => ({ amount: Number(t.amount), matched: t.status === 'reconciled' }))
    return summarizeBankRec(txns, ledgerCashBalance)
  },
}

export const AGENT_TOOLS: AgentTool[] = AGENT_TOOL_MANIFEST.map(meta => {
  const handler = HANDLERS[meta.name]
  if (!handler) throw new Error(`No handler for agent tool ${meta.name}`)
  return { ...meta, handler }
})

export function getTool(name: string): AgentTool | undefined {
  return AGENT_TOOLS.find(t => t.name === name)
}
