// Inline accounting assistant. Gathers the vehicle's books (chart, balances,
// recent entries) as context, asks the fund's AI to review the work and/or draft
// the entry the user describes, and returns structured findings + proposals.
// Nothing is posted automatically: a proposal is applied as a DRAFT entry the
// user reviews and posts. Proposals reference standard chart codes (per-LP
// capital calls stay in the Bank "Book as call" flow, not here).

import type { SupabaseClient } from '@supabase/supabase-js'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import { withTopicalGuardrail } from '@/lib/ai/topical-guard'
import { loadPostedLedger } from './load'
import { accountBalances } from './ledger'
import { accountIdByCode, persistEntry } from './persist'
import { vehicleIdByName } from './vehicle-id'
import { lpCapitalSummary } from './capital-calls'
import type { JournalEntry, Posting } from './types'

export interface AssistantProposalPosting { accountCode: string; amount: number }
export interface AssistantProposal {
  type: 'create' | 'edit'
  entryId?: string | null
  entryDate: string
  memo: string
  sourceType?: string | null
  postings: AssistantProposalPosting[]
  rationale: string
}
export interface AssistantFinding {
  severity: 'info' | 'warning' | 'error'
  title: string
  detail: string
  entryId?: string | null
}
export interface AssistantResult {
  summary: string
  findings: AssistantFinding[]
  proposals: AssistantProposal[]
}

/** A readable snapshot of one vehicle's books. `full` includes the chart and more
 *  history (for the primary vehicle); related entities get a compact version. */
async function vehicleBooks(admin: SupabaseClient, fundId: string, group: string, label: string, full: boolean): Promise<string> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const [{ data: acctRows }, { accounts, postings }, { data: entryRows }] = await Promise.all([
    admin.from('chart_of_accounts' as any).select('id, code, name, type, subtype').eq('fund_id', fundId).eq('vehicle_id', vehicleId).order('code'),
    loadPostedLedger(admin, fundId, group),
    admin.from('journal_entries' as any)
      .select('id, entry_date, memo, source_type, status, journal_postings(account_id, amount)')
      .eq('fund_id', fundId).eq('vehicle_id', vehicleId).neq('status', 'void')
      .order('entry_date', { ascending: false }).limit(full ? 40 : 12),
  ])

  const codeById = new Map<string, string>(((acctRows as any[]) ?? []).map(a => [a.id, `${a.code} ${a.name}`]))
  const bal = accountBalances(postings)
  const balLines = accounts
    .map(a => ({ a, b: bal.get(a.id) ?? 0 }))
    .filter(x => Math.abs(x.b) > 0.005)
    .map(x => `  ${x.a.code} ${x.a.name} (${x.a.type}): ${x.b.toFixed(2)}`)
    .join('\n')
  const entryLines = ((entryRows as any[]) ?? []).map(e => {
    const posts = ((e.journal_postings ?? []) as any[])
      .map(p => `${codeById.get(p.account_id) ?? p.account_id.slice(0, 8)} ${Number(p.amount).toFixed(2)}`)
      .join('; ')
    return `  [${e.id}] ${e.entry_date} "${e.memo ?? e.source_type ?? ''}" (${e.status}): ${posts}`
  }).join('\n')

  const parts = [`### ${label}`]
  if (full) {
    const chartLines = ((acctRows as any[]) ?? []).map(a => `  ${a.code}  ${a.name} (${a.type}${a.subtype ? '/' + a.subtype : ''})`).join('\n')
    parts.push(`CHART OF ACCOUNTS:\n${chartLines || '  (none)'}`)
  }
  parts.push(`ACCOUNT BALANCES (debit +, credit -):\n${balLines || '  (all zero)'}`)
  parts.push(`RECENT ENTRIES (id, date, memo, status, postings "code amount"):\n${entryLines || '  (none)'}`)
  return parts.join('\n')
}

/** The full context: the primary vehicle (chart, balances, entries, partner
 *  capital) plus any GP/associate entities related to it (compact). */
async function gatherContext(admin: SupabaseClient, fundId: string, group: string): Promise<string> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)

  const primary = await vehicleBooks(admin, fundId, group, `PRIMARY VEHICLE: ${group}`, true)

  let capText = ''
  try {
    const rows = await lpCapitalSummary(admin, fundId, group)
    if (rows.length) {
      capText = '\nPARTNER CAPITAL (per partner — commitment / called / funded / outstanding / NAV):\n' +
        rows.map(r => `  ${r.name}${r.partnerClass === 'gp' ? ' [GP]' : ''}: commit ${r.commitment.toFixed(2)}, called ${r.called.toFixed(2)}, funded ${r.funded.toFixed(2)}, outstanding ${r.outstanding.toFixed(2)}, NAV ${r.ending.toFixed(2)}`).join('\n')
    }
  } catch { /* LP data may be absent */ }

  // Related GP/associate entities: those explicitly linked to this vehicle, else
  // (before any links are set) every associate entity in the fund.
  let veh: any[] = []
  try {
    const { data, error } = await admin.from('fund_vehicles' as any).select('id, name, kind, serves_vehicle_id').eq('fund_id', fundId)
    if (error) throw error
    veh = (data as any[]) ?? []
  } catch {
    const { data } = await admin.from('fund_vehicles' as any).select('id, name, kind').eq('fund_id', fundId)
    veh = (data as any[]) ?? []
  }
  const current = veh.find(v => v.id === vehicleId)
  const associates = veh.filter(v => v.kind === 'associate' && v.id !== vehicleId)
  const linked = associates.filter(v => v.serves_vehicle_id && v.serves_vehicle_id === vehicleId)
  let related = linked
  // If the current vehicle is itself a GP/associate, include the fund it serves.
  if (current?.serves_vehicle_id) {
    const served = veh.find(v => v.id === current.serves_vehicle_id)
    if (served) related = [...related, served]
  }
  if (related.length === 0 && current?.kind !== 'associate') related = associates

  const relatedBlocks: string[] = []
  for (const r of related) {
    relatedBlocks.push(await vehicleBooks(admin, fundId, r.name, `RELATED ${r.kind === 'associate' ? 'GP/ASSOCIATE' : 'FUND'} ENTITY: ${r.name}`, false))
  }

  return [primary + capText, ...relatedBlocks].join('\n\n=====\n\n')
}

const SYSTEM = `You are an expert fund-accounting assistant embedded in the Accounting section of a fund platform. You help across the WHOLE section, not just journal entries:
- interpret and explain financial statements (statement of assets/liabilities & partners' capital i.e. balance sheet, statement of operations i.e. income statement, statement of changes in partners' capital, cash flows, schedule of investments) from the chart, balances, and entries provided;
- explain capital accounts and capital calls (commitment / called / funded / outstanding / NAV per partner);
- answer reconciliation questions — including between a fund and its GP/associate entity, whose own books reconcile to the fund (a GP entity's "Investment in Fund" should equal its capital-account balance on the fund's books);
- review the books for problems; and draft or fix double-entry journal entries.

You are given the PRIMARY vehicle being viewed (chart, balances, recent entries, partner capital) plus any RELATED GP/associate entities as read-only reference.

Sign convention: every posting amount is the signed change to the account — DEBIT positive, CREDIT negative — and each entry's postings MUST sum to exactly 0.

When ANSWERING a question (interpretation, explanation, reconciliation), put the answer in "summary" — a few short paragraphs are fine — and leave "proposals" empty unless the user asked you to draft or fix an entry.
When drafting/fixing: only use account codes that exist in the PRIMARY vehicle's chart (never invent codes), and only propose entries for the PRIMARY vehicle (related entities are reference only — describe any needed entries for them in the summary instead). Do NOT propose per-LP capital-call allocations (handled elsewhere); work at the standard chart level (e.g. 3100 LP capital, 3000 GP capital).
When reviewing, surface issues as findings: entries that don't balance, mis-categorized postings, missing counterparts (e.g. a loan drawn but never repaid), fund-vs-GP reconciliation gaps, and unusual amounts.
Respond with STRICT JSON ONLY (no prose, no code fences) of this exact shape:
{
  "summary": "one short paragraph",
  "findings": [{"severity":"info|warning|error","title":"...","detail":"...","entryId":"<id or null>"}],
  "proposals": [{"type":"create|edit","entryId":"<id for edit, else null>","entryDate":"YYYY-MM-DD","memo":"...","sourceType":"manual","postings":[{"accountCode":"1100","amount":5000000},{"accountCode":"2200","amount":-5000000}],"rationale":"why"}]
}
Return findings and proposals only when warranted; empty arrays are fine.
If a request is outside this fund's accounting (general knowledge, coding, personal/legal/tax advice, current events, etc.), do NOT act on it: put a one-sentence polite decline in "summary" and return empty findings and proposals.`

export async function runAssistant(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  message: string
): Promise<AssistantResult | { error: string }> {
  const context = await gatherContext(admin, fundId, group)

  let provider
  try {
    provider = await createFundAIProviderWithOverride(admin, fundId)
  } catch (e) {
    return { error: `AI provider not configured: ${(e as Error).message}` }
  }

  const content = `${context}\n\n---\nUSER REQUEST: ${message || 'Review these books and flag anything that looks wrong.'}`
  let text: string
  try {
    const result = await provider.provider.createMessage({ model: provider.model, maxTokens: 3000, system: withTopicalGuardrail(SYSTEM), content })
    text = result.text
  } catch (e) {
    return { error: `AI request failed: ${(e as Error).message}` }
  }

  const parsed = parseAssistant(text)
  if (!parsed) return { error: 'The assistant returned an unreadable response — try again or rephrase.' }
  return parsed
}

function parseAssistant(text: string): AssistantResult | null {
  const cleaned = text.replace(/```json\s*|\s*```/g, '').trim()
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start < 0 || end < 0) return null
  try {
    const obj = JSON.parse(cleaned.slice(start, end + 1))
    return {
      summary: typeof obj.summary === 'string' ? obj.summary : '',
      findings: Array.isArray(obj.findings) ? obj.findings : [],
      proposals: Array.isArray(obj.proposals) ? obj.proposals : [],
    }
  } catch {
    return null
  }
}

/** Apply one proposal as a DRAFT entry (create, or edit an existing entry). */
export async function applyProposal(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  userId: string | null,
  proposal: AssistantProposal
): Promise<{ entryId: string } | { error: string }> {
  const codes = await accountIdByCode(admin, fundId, group)
  const postings: Posting[] = []
  for (const p of proposal.postings ?? []) {
    const accountId = codes.get(String(p.accountCode))
    if (!accountId) return { error: `Unknown account code ${p.accountCode}` }
    postings.push({ accountId, amount: Number(p.amount), currency: 'USD', lpEntityId: null })
  }
  if (postings.length === 0) return { error: 'The proposal has no postings' }

  if (proposal.type === 'edit' && proposal.entryId) {
    const vehicleId = await vehicleIdByName(admin, fundId, group)
    const { data: existing } = await admin.from('journal_entries' as any)
      .select('id, status').eq('id', proposal.entryId).eq('fund_id', fundId).eq('vehicle_id', vehicleId).maybeSingle()
    if (!existing) return { error: 'Entry to edit not found' }

    // Bring a posted entry back to draft first (and any bank txn that points at it).
    if ((existing as any).status !== 'draft') {
      await admin.from('journal_entries' as any).update({ status: 'draft', posted_at: null }).eq('id', proposal.entryId).eq('fund_id', fundId)
      await admin.from('bank_transactions' as any).update({ status: 'drafted' }).eq('journal_entry_id', proposal.entryId).eq('fund_id', fundId)
    }

    const { data: oldRows } = await admin.from('journal_postings' as any).select('id').eq('journal_entry_id', proposal.entryId)
    const { error: insErr } = await admin.from('journal_postings' as any).insert(
      postings.map(p => ({ fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId, journal_entry_id: proposal.entryId, account_id: p.accountId, amount: p.amount, currency: p.currency, lp_entity_id: null }))
    )
    if (insErr) return { error: insErr.message }
    const oldIds = ((oldRows as any[]) ?? []).map(r => r.id)
    if (oldIds.length) await admin.from('journal_postings' as any).delete().in('id', oldIds)
    await admin.from('journal_entries' as any).update({ entry_date: proposal.entryDate, memo: proposal.memo ?? null }).eq('id', proposal.entryId).eq('fund_id', fundId)
    return { entryId: proposal.entryId }
  }

  const entry: JournalEntry = {
    fundId,
    entryDate: proposal.entryDate,
    memo: proposal.memo ?? null,
    sourceType: proposal.sourceType ?? 'manual',
    postings,
  }
  const result = await persistEntry(admin, fundId, group, userId, entry, 'draft')
  if ('error' in result) return { error: result.error }
  return { entryId: result.entryId }
}
