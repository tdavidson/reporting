// Shared AI parser for pasted LP data (spreadsheet / CSV text → structured rows).
//
// Extracted so both the legacy snapshot import (app/api/lps/import) and the new positions
// import (app/api/accounting/positions/import) parse identically — one prompt, one repair
// path, no drift between the two surfaces.

import type { SupabaseClient } from '@supabase/supabase-js'
import { createFundAIProvider } from '@/lib/ai'
import { logAIUsage } from '@/lib/ai/usage'

export const MAX_LP_IMPORT_SIZE = 500_000

export interface ParsedLpRow {
  investor_name: string
  entity_name?: string
  portfolio_group: string
  commitment?: number | null
  total_value?: number | null
  nav?: number | null
  called_capital?: number | null
  paid_in_capital?: number | null
  distributions?: number | null
  outstanding_balance?: number | null
  /** Reported IRR as a fraction (0.185 for 18.5%). DPI/RVPI/TVPI/% funded are derived, not parsed. */
  irr?: number | null
}

export function toSafeNumber(val: unknown): number | null {
  if (val == null) return null
  const n = Number(val)
  if (!isFinite(n)) return null
  if (Math.abs(n) > 1e15) return null
  return n
}

const SYSTEM = 'You are a data parser. You ONLY output valid JSON. No markdown, no code fences, no explanation, just the JSON object.'

function prompt(rawData: string): string {
  return `Parse this LP investment data into JSON.

Output format:
{
  "investments": [
    {
      "investor_name": "Investor Name or LP Name",
      "entity_name": "Legal entity name if different from investor name, otherwise omit",
      "portfolio_group": "Fund name or vehicle name",
      "commitment": 1000000,
      "total_value": 1100000,
      "nav": 900000,
      "called_capital": 750000,
      "paid_in_capital": 750000,
      "distributions": 200000,
      "outstanding_balance": 250000,
      "irr": 0.185
    }
  ]
}

Rules:
- Each row typically represents one LP's position in a specific fund/vehicle
- investor_name: the LP name, investor name, or limited partner name (REQUIRED)
- portfolio_group: the fund name, vehicle name, or portfolio group (REQUIRED)
- entity_name: only include if there's a separate legal entity name column distinct from investor name
- commitment: total capital commitment
- total_value: total value (distributions + NAV)
- nav: net asset value, net asset balance, residual value, or current value
- called_capital: capital called or drawn down
- paid_in_capital: paid-in capital, contributions, or capital contributed (same as called for LP positions)
- distributions: distributed capital, distributions received
- outstanding_balance: remaining uncalled commitment, unfunded balance
- irr: reported IRR / net IRR, as a DECIMAL FRACTION (18.5% or "18.5" → 0.185). Omit if absent. Do NOT parse DPI, RVPI, TVPI, or % funded — those are derived downstream, so ignore those columns.
- All monetary values are plain numbers (no currency symbols, commas, or formatting)
- If a value is not present, omit it or set to null
- Match columns by MEANING, not exact header text; parse %, "x" multiples, and currency correctly
- If you can't parse a field, skip it rather than guessing

Data to parse:
${rawData}`
}

/** Repair the AI's JSON output — strip fences, extract the object, recover from truncation. */
function extractInvestments(responseText: string): ParsedLpRow[] {
  let cleaned = responseText.replace(/^```(?:json)?\s*\n?/gm, '').replace(/\n?```\s*$/gm, '').trim()
  let parsed: { investments?: ParsedLpRow[] }
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('No JSON object found in AI response')
    try {
      parsed = JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      const partial = cleaned.slice(start)
      const lastComplete = partial.lastIndexOf('},')
      if (lastComplete <= 0) throw new Error('Could not repair truncated JSON')
      parsed = JSON.parse(partial.slice(0, lastComplete + 1) + ']}')
    }
  }
  if (!parsed.investments || !Array.isArray(parsed.investments)) {
    throw new Error('Invalid response structure, expected { investments: [...] }')
  }
  return parsed.investments
}

/**
 * Parse pasted LP data into rows via the fund's AI provider. Filters obvious header/blank
 * artefacts but keeps intentional zero-value rows (e.g. a GP with 0 committed).
 */
export async function parseLpData(
  admin: SupabaseClient,
  fundId: string,
  userId: string | null,
  rawData: string,
): Promise<ParsedLpRow[]> {
  const { provider, model, providerType } = await createFundAIProvider(admin, fundId)
  const result = await provider.createMessage({ model, maxTokens: 16384, system: SYSTEM, content: prompt(rawData) })
  logAIUsage(admin, { fundId, userId: userId ?? undefined, provider: providerType, model, feature: 'lp-positions-import', usage: result.usage })

  let rows = extractInvestments(result.text)
  if (rows.length > 5000) throw new Error('Too many rows in parsed result (max 5000)')

  // paid-in IS called; fill either from the other so downstream always has the figure.
  for (const r of rows) {
    if (r.paid_in_capital == null && r.called_capital != null) r.paid_in_capital = r.called_capital
    if (r.called_capital == null && r.paid_in_capital != null) r.called_capital = r.paid_in_capital
    if (!r.commitment && r.paid_in_capital) r.commitment = r.paid_in_capital
  }

  rows = rows.filter(r => {
    const hasValue =
      (r.commitment != null && r.commitment !== 0) ||
      (r.nav != null && r.nav !== 0) ||
      (r.paid_in_capital != null && r.paid_in_capital !== 0) ||
      (r.total_value != null && r.total_value !== 0) ||
      (r.distributions != null && r.distributions !== 0)
    if (hasValue) return true
    return r.commitment === 0 || r.paid_in_capital === 0
  })

  return rows
}

/** Resolve (creating if needed) the lp_entity for a row. Returns the entity id, or null on error. */
export async function resolveOrCreateEntity(
  admin: SupabaseClient,
  fundId: string,
  investorName: string,
  entityName: string,
  caches: { investorByName: Map<string, string>; entityByName: Map<string, string>; entityInvestor: Map<string, string> },
): Promise<string | null> {
  const entKey = entityName.toLowerCase()
  let entityId = caches.entityByName.get(entKey)
  let investorId: string | undefined = entityId ? caches.entityInvestor.get(entityId) : undefined

  if (!investorId) {
    investorId = caches.investorByName.get(investorName.toLowerCase())
    if (!investorId) {
      const { data, error } = await (admin as any)
        .from('lp_investors').insert({ fund_id: fundId, name: investorName }).select('id').single()
      if (error || !data) return null
      investorId = data.id as string
      caches.investorByName.set(investorName.toLowerCase(), investorId)
    }
  }
  if (!entityId) {
    const { data, error } = await (admin as any)
      .from('lp_entities').insert({ fund_id: fundId, investor_id: investorId, entity_name: entityName }).select('id').single()
    if (error || !data) return null
    entityId = data.id as string
    caches.entityByName.set(entKey, entityId)
    caches.entityInvestor.set(entityId, investorId)
  }
  return entityId
}

/** Build the investor/entity caches a batch import resolves against. */
export async function loadEntityCaches(admin: SupabaseClient, fundId: string) {
  const [{ data: investors }, { data: entities }] = await Promise.all([
    (admin as any).from('lp_investors').select('id, name').eq('fund_id', fundId),
    (admin as any).from('lp_entities').select('id, entity_name, investor_id').eq('fund_id', fundId),
  ])
  const investorByName = new Map<string, string>()
  for (const i of (investors ?? [])) investorByName.set(String(i.name).toLowerCase(), i.id)
  const entityByName = new Map<string, string>()
  const entityInvestor = new Map<string, string>()
  for (const e of (entities ?? [])) {
    entityByName.set(String(e.entity_name).toLowerCase(), e.id)
    entityInvestor.set(e.id, e.investor_id)
  }
  return { investorByName, entityByName, entityInvestor }
}
