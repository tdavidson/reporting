// Inline accounting assistant. Gathers the vehicle's books (chart, balances,
// recent entries) as context, optionally alongside a source document the user
// uploaded, asks the fund's AI to review the work and/or draft the entry, and
// returns structured findings + proposals. Nothing is posted automatically: a
// proposal is applied as a DRAFT entry the user reviews and posts.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import { withTopicalGuardrail } from '@/lib/ai/topical-guard'
import { loadPostedLedger, loadEntityNames } from './load'
import { accountBalances, assertBalanced } from './ledger'
import { accountIdByCode, persistEntry } from './persist'
import { closedPeriodRanges, dateInAnyClosedPeriod } from './periods'
import { fundCurrency } from './currency'
import { vehicleIdByName } from './vehicle-id'
import { lpCapitalSummary } from './capital-calls'
import { ENTRY_SOURCE_TYPES } from './source-types'
import type { JournalEntry, Posting } from './types'

export interface AssistantProposalPosting { accountCode: string; amount: number; lpEntity?: string | null }
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
- review the books for problems; draft or fix double-entry journal entries; and
- convert a SOURCE DOCUMENT (capital-call notice, invoice, wire confirmation, distribution notice) into a balanced entry.

You are given the PRIMARY vehicle being viewed (chart, balances, recent entries, partner capital) plus any RELATED GP/associate entities as read-only reference. A SOURCE DOCUMENT may also be attached.

Sign convention: every posting amount is the signed change to the account — DEBIT positive, CREDIT negative — and each entry's postings MUST sum to exactly 0.

When ANSWERING a question (interpretation, explanation, reconciliation), put the answer in "summary" — a few short paragraphs are fine — and leave "proposals" empty unless the user asked you to draft or fix an entry.
When a SOURCE DOCUMENT is attached, default to proposing ONE balanced entry that records it, and explain your reading of it in "summary".
When drafting/fixing: only use account codes that exist in the PRIMARY vehicle's chart (never invent codes), and only propose entries for the PRIMARY vehicle (related entities are reference only — describe any needed entries for them in the summary instead).
Set "sourceType" to one of: ${ENTRY_SOURCE_TYPES.join(', ')}.
Do NOT split a capital call pro-rata across ALL partners — that belongs in the Bank "Book as call" flow. But when the document or request names ONE specific partner, attribute that posting to them by putting their exact name in the posting's "lpEntity" field; otherwise omit it and work at the standard chart level (e.g. 3100 LP capital, 3000 GP capital).
When reviewing, surface issues as findings: entries that don't balance, postings that debit and credit the SAME account (always wrong), mis-categorized postings, missing counterparts (e.g. a loan drawn but never repaid), fund-vs-GP reconciliation gaps, and unusual amounts.
Respond with STRICT JSON ONLY (no prose, no code fences) of this exact shape:
{
  "summary": "one short paragraph",
  "findings": [{"severity":"info|warning|error","title":"...","detail":"...","entryId":"<id or null>"}],
  "proposals": [{"type":"create|edit","entryId":"<id for edit, else null>","entryDate":"YYYY-MM-DD","memo":"...","sourceType":"manual","postings":[{"accountCode":"1100","amount":5000000,"lpEntity":null},{"accountCode":"2200","amount":-5000000,"lpEntity":null}],"rationale":"why"}]
}
Return findings and proposals only when warranted; empty arrays are fine.
If a request is outside this fund's accounting (general knowledge, coding, personal/legal/tax advice, current events, etc.), do NOT act on it: put a one-sentence polite decline in "summary" and return empty findings and proposals.`

export async function runAssistant(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  message: string,
  documentText?: string
): Promise<AssistantResult | { error: string }> {
  const context = await gatherContext(admin, fundId, group)

  let provider
  try {
    provider = await createFundAIProviderWithOverride(admin, fundId)
  } catch (e) {
    return { error: `AI provider not configured: ${(e as Error).message}` }
  }

  const doc = documentText?.trim()
  const fallback = doc
    ? 'Draft a balanced journal entry that records the source document above.'
    : 'Review these books and flag anything that looks wrong.'
  const content = [
    context,
    ...(doc ? [`---\nSOURCE DOCUMENT:\n${doc}`] : []),
    `---\nUSER REQUEST: ${message || fallback}`,
  ].join('\n\n')
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
  const [codes, names] = await Promise.all([
    accountIdByCode(admin, fundId, group),
    loadEntityNames(admin, fundId, group),
  ])
  // Partner name → id, so a proposal drafted from a document that names one
  // partner lands on that partner's capital account rather than the pooled one.
  const entityByName = new Map(Array.from(names.entries()).map(([id, name]) => [name.toLowerCase(), id]))

  const postings: Posting[] = []
  for (const p of proposal.postings ?? []) {
    const accountId = codes.get(String(p.accountCode))
    if (!accountId) return { error: `Unknown account code ${p.accountCode}` }
    const lpEntityId = p.lpEntity ? entityByName.get(String(p.lpEntity).toLowerCase()) ?? null : null
    // Denominated in the fund's currency, not assumed dollars. The create path gets this from
    // persistEntry; the edit path inserts postings directly, so it has to stamp them itself.
    postings.push({ accountId, amount: Number(p.amount), currency: await fundCurrency(admin, fundId), lpEntityId })
  }
  if (postings.length === 0) return { error: 'The proposal has no postings' }

  if (proposal.type === 'edit' && proposal.entryId) {
    const vehicleId = await vehicleIdByName(admin, fundId, group)
    if (!vehicleId) return { error: `Unknown vehicle "${group}".` }

    const { data: existing } = await admin.from('journal_entries' as any)
      .select('id, status, entry_date').eq('id', proposal.entryId).eq('fund_id', fundId).eq('vehicle_id', vehicleId).maybeSingle()
    if (!existing) return { error: 'Entry to edit not found' }

    // THE GUARDS THE CREATE PATH GETS FOR FREE FROM persistEntry, AND THIS PATH USED TO SKIP.
    //
    // These postings came out of an LLM's JSON. Without the balance check, a hallucinated
    // edit saved an unbalanced entry as a draft — and the journal's Post action checks the
    // period lock but NOT balance, so one click later it was posted and the trial balance
    // was silently off. Without the period check, the edit could rewrite `entry_date` INTO a
    // closed month, or amend an entry already sitting in one.
    try {
      assertBalanced({ fundId, entryDate: proposal.entryDate, postings } as JournalEntry)
    } catch (e) {
      return { error: `The proposed edit doesn't balance: ${(e as Error).message}` }
    }

    const closed = await closedPeriodRanges(admin, fundId, group)
    // Check the date it's moving TO and the date it's moving FROM — an entry may neither be
    // smuggled into a locked period nor out of one.
    if (dateInAnyClosedPeriod(closed, proposal.entryDate)) {
      return { error: `The period covering ${proposal.entryDate} is closed — reopen it to post there.` }
    }
    const currentDate = (existing as any).entry_date
    if (currentDate && dateInAnyClosedPeriod(closed, currentDate)) {
      return { error: `That entry is dated ${currentDate}, inside a closed period — reopen it to amend it.` }
    }

    // Bring a posted entry back to draft first (and any bank txn that points at it).
    if ((existing as any).status !== 'draft') {
      await admin.from('journal_entries' as any).update({ status: 'draft', posted_at: null }).eq('id', proposal.entryId).eq('fund_id', fundId)
      await admin.from('bank_transactions' as any).update({ status: 'drafted' }).eq('journal_entry_id', proposal.entryId).eq('fund_id', fundId)
    }

    const { data: oldRows } = await admin.from('journal_postings' as any).select('id').eq('journal_entry_id', proposal.entryId)
    const { error: insErr } = await admin.from('journal_postings' as any).insert(
      postings.map(p => ({ fund_id: fundId, portfolio_group: group, vehicle_id: vehicleId, journal_entry_id: proposal.entryId, account_id: p.accountId, amount: p.amount, currency: p.currency, lp_entity_id: p.lpEntityId }))
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
