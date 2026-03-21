import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { createFundAIProvider } from '@/lib/ai'
import { logAIUsage } from '@/lib/ai/usage'
import { logActivity } from '@/lib/activity'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 300;

interface ParsedTransaction {
  company_name: string
  company_status?: 'active' | 'exited' | 'written-off'
  transaction_type: 'investment' | 'proceeds' | 'unrealized_gain_change' | 'round_info'
  round_name?: string
  transaction_date?: string
  notes?: string
  investment_cost?: number
  interest_converted?: number
  shares_acquired?: number
  share_price?: number
  ownership_pct?: number
  cost_basis_exited?: number
  proceeds_received?: number
  proceeds_escrow?: number
  proceeds_written_off?: number
  proceeds_per_share?: number
  unrealized_value_change?: number
  current_share_price?: number
  postmoney_valuation?: number
  latest_postmoney_valuation?: number
  exit_valuation?: number
  original_currency?: string
  original_investment_cost?: number
  original_share_price?: number
  original_postmoney_valuation?: number
  original_proceeds_received?: number
  original_proceeds_per_share?: number
  original_exit_valuation?: number
  original_unrealized_value_change?: number
  original_current_share_price?: number
  original_latest_postmoney_valuation?: number
  portfolio_group?: string
}

const VALID_TYPES = new Set(['investment', 'proceeds', 'unrealized_gain_change', 'round_info'])

function sanitize(val: string): string {
  return val
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 10_000)
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const limited = await rateLimit({ key: `import-investments:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const fundId = membership.fund_id
  const body = await req.json()
  const { text, mode } = body
  const isUpsert = mode === 'upsert'

  if (typeof text !== 'string' || !text.trim()) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  if (text.length > 500_000) {
    return NextResponse.json({ error: 'Input too large. Maximum 500KB of text allowed.' }, { status: 400 })
  }

  let provider: Awaited<ReturnType<typeof createFundAIProvider>>['provider']
  let claudeModel: string
  let aiProviderType: string
  try {
    const result = await createFundAIProvider(admin, fundId)
    provider = result.provider
    claudeModel = result.model
    aiProviderType = result.providerType
  } catch {
    return NextResponse.json({ error: 'AI API key not configured. Add one in Settings.' }, { status: 400 })
  }

  let responseText: string
  try {
    const aiResult = await provider.createMessage({
      model: claudeModel,
      maxTokens: 8192,
      content: `Parse the following investment data (CSV, spreadsheet, or free-form text) into structured JSON.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "transactions": [
    {
      "company_name": "Company Name",
      "company_status": "active",
      "transaction_type": "investment",
      "round_name": "Series A",
      "transaction_date": "2024-01-15",
      "investment_cost": 500000,
      "interest_converted": 0,
      "shares_acquired": 50000,
      "share_price": 10.00,
      "ownership_pct": 15.5
    },
    {
      "company_name": "Company Name",
      "company_status": "exited",
      "transaction_type": "proceeds",
      "round_name": "Exit",
      "transaction_date": "2025-06-01",
      "cost_basis_exited": 500000,
      "proceeds_received": 1500000,
      "proceeds_escrow": 100000,
      "proceeds_written_off": 0,
      "proceeds_per_share": 30.00
    },
    {
      "company_name": "Company Name",
      "company_status": "active",
      "transaction_type": "unrealized_gain_change",
      "round_name": "Series B",
      "transaction_date": "2025-12-31",
      "unrealized_value_change": 200000,
      "current_share_price": 14.00
    },
    {
      "company_name": "Company Name",
      "company_status": "active",
      "transaction_type": "round_info",
      "round_name": "Series C",
      "transaction_date": "2026-01-15",
      "share_price": 18.00,
      "postmoney_valuation": 500000000
    }
  ]
}

Rules:
- transaction_type must be one of: "investment", "proceeds", "unrealized_gain_change", "round_info".
- company_status must be one of: "active", "exited", "written-off". Infer from context.

CRITICAL MAPPING RULES (DO NOT IGNORE):
1. OWNERSHIP: If the source data has an "Ownership", "% Owned", or "Equity %" column, you MUST extract it and map it to "ownership_pct" (as a pure number, e.g., 2.9325). You MUST do this for EVERY row where a value exists, regardless of the transaction type (investment, round_info, etc.). DO NOT drop this value.
2. POST-MONEY VALUATION: If the source data has a "Post-Money Valuation" or "Valuation" column, you MUST extract it. Map it to "postmoney_valuation" (for investment or round_info) or "latest_postmoney_valuation" (for unrealized_gain_change). DO NOT drop this value on investment rows.
3. BLANK TRANSACTION TYPES: If the source data has a row where the transaction type is BLANK or empty, but it contains an updated Ownership % and/or Post-Money Valuation, treat it as a "round_info" transaction type. You MUST include the "ownership_pct" and "postmoney_valuation" for this row.
4. ROUND NAMES: If the source data does NOT explicitly have a "Round" or "Round Name" column, DO NOT invent one. Do not use generic words like "Round". Just omit the "round_name" field entirely.
5. DATES: Format as YYYY-MM-DD.
6. NUMBERS: All monetary values and percentages must be plain numbers (no currency symbols, no commas for thousands, no % signs).
7. COLUMNS: "AMOUNT" or "Cost" maps to "investment_cost". "Proceeds" maps to "proceeds_received". "Group" maps to "portfolio_group".

- CRITICAL: You must return the COMPLETE JSON object. Do not truncate the response. Ensure the JSON is properly closed.

Schedule of Investments (SOI) handling:
- SOIs are point-in-time snapshots from fund administrators showing each position's cost basis and current fair value
- For each position in an SOI, create TWO transactions:
  1. An "investment" row with investment_cost set to the cost basis (and shares_acquired/share_price if available)
  2. An "unrealized_gain_change" row with current_share_price set to the fair value per share, or if only total fair value is given, set unrealized_value_change to (fair_value - cost_basis)
- Common SOI column names: "Cost", "Cost Basis", "Original Cost" → investment_cost; "Fair Value", "FMV", "Market Value", "Carrying Value", "Current Value" → use for unrealized_gain_change; "Unrealized Gain/Loss", "Appreciation/Depreciation" → unrealized_value_change
- If the SOI has a report date or "as of" date, use that as transaction_date for all rows
- If a position shows zero cost and zero value, or is marked "written off" / "written down to zero", set company_status to "written-off"
- If a position shows realized proceeds or is marked as exited/distributed, create a "proceeds" row instead of unrealized_gain_change

Data to parse:
${text}`,
    })
    responseText = aiResult.text

    logAIUsage(admin, {
      fundId,
      userId: user.id,
      provider: aiProviderType,
      model: claudeModel,
      feature: 'import.investments',
      usage: aiResult.usage,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[import-investments] AI API error:', message)
    return NextResponse.json({ error: 'AI API call failed. Check your API key in Settings.' }, { status: 500 })
  }

  let parsed: { transactions: ParsedTransaction[] }
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    return NextResponse.json({
      error: 'Failed to parse AI response as JSON. Try importing fewer rows at a time.',
    }, { status: 500 })
  }

  if (!parsed.transactions || !Array.isArray(parsed.transactions)) {
    return NextResponse.json({ error: 'Invalid response structure' }, { status: 500 })
  }

  if (parsed.transactions.length > 5000) {
    return NextResponse.json({ error: 'Too many transactions in parsed result (max 5000)' }, { status: 400 })
  }

  const { data: existingCompanies } = await admin
    .from('companies')
    .select('id, name')
    .eq('fund_id', fundId)

  const companyByName = new Map(
    (existingCompanies ?? []).map(c => [c.name.toLowerCase(), c.id])
  )

  const results = {
    investmentsCreated: 0,
    proceedsCreated: 0,
    unrealizedCreated: 0,
    companiesMatched: 0,
    companiesCreated: 0,
    skipped: 0,
    errors: [] as string[],
  }

  const matchedCompanies = new Set<string>()

  for (const pt of parsed.transactions) {
    if (!pt.company_name || typeof pt.company_name !== 'string' || !pt.company_name.trim()) {
      results.errors.push('Skipped transaction with no company name')
      continue
    }

    const companyName = sanitize(pt.company_name)
    if (!companyName) {
      results.errors.push('Skipped transaction with empty company name after sanitization')
      continue
    }

    let companyId = companyByName.get(companyName.toLowerCase())
    if (!companyId) {
      const status = (['active', 'exited', 'written-off'] as const).includes(pt.company_status as any)
        ? pt.company_status!
        : 'active'
      const { data: newCompany, error: companyError } = await admin
        .from('companies')
        .insert({
          fund_id: fundId,
          name: companyName,
          status,
          tags: [],
        })
        .select('id')
        .single()

      if (companyError || !newCompany) {
        results.errors.push(`Failed to create company "${companyName}": ${companyError?.message}`)
        continue
      }

      companyId = newCompany.id
      companyByName.set(companyName.toLowerCase(), companyId)
      results.companiesCreated++
    }

    if (!matchedCompanies.has(companyId)) {
      matchedCompanies.add(companyId)
      results.companiesMatched++
    }

    const txnType = pt.transaction_type
    if (!txnType || !VALID_TYPES.has(txnType)) {
      results.errors.push(`Invalid transaction type "${txnType}" for "${companyName}"`)
      continue
    }

    if (isUpsert) {
      const query = admin
        .from('investment_transactions' as any)
        .select('id')
        .eq('company_id', companyId)
        .eq('fund_id', fundId)
        .eq('transaction_type', txnType)

      if (pt.transaction_date) query.eq('transaction_date', pt.transaction_date)
      if (pt.round_name) query.eq('round_name', sanitize(pt.round_name))
      if (pt.investment_cost != null) query.eq('investment_cost', pt.investment_cost)
      if (pt.proceeds_received != null) query.eq('proceeds_received', pt.proceeds_received)

      const { data: existing } = await query.maybeSingle()
      if (existing) {
        results.skipped++
        continue
      }
    }

    const { error: insertError } = await admin
      .from('investment_transactions' as any)
      .insert({
        company_id: companyId,
        fund_id: fundId,
        transaction_type: txnType,
        round_name: pt.round_name ? sanitize(pt.round_name) : null,
        transaction_date: pt.transaction_date || null,
        notes: pt.notes ? sanitize(pt.notes) : null,
        investment_cost: pt.investment_cost ?? null,
        interest_converted: pt.interest_converted ?? 0,
        shares_acquired: pt.shares_acquired ?? null,
        share_price: pt.share_price ?? null,
        ownership_pct: pt.ownership_pct ?? null,
        cost_basis_exited: pt.cost_basis_exited ?? null,
        proceeds_received: pt.proceeds_received ?? null,
        proceeds_escrow: pt.proceeds_escrow ?? 0,
        proceeds_written_off: pt.proceeds_written_off ?? 0,
        proceeds_per_share: pt.proceeds_per_share ?? null,
        unrealized_value_change: pt.unrealized_value_change ?? null,
        current_share_price: pt.current_share_price ?? null,
        postmoney_valuation: pt.postmoney_valuation ?? null,
        latest_postmoney_valuation: pt.latest_postmoney_valuation ?? null,
        exit_valuation: pt.exit_valuation ?? null,
        original_currency: pt.original_currency ?? null,
        original_investment_cost: pt.original_investment_cost ?? null,
        original_share_price: pt.original_share_price ?? null,
        original_postmoney_valuation: pt.original_postmoney_valuation ?? null,
        original_proceeds_received: pt.original_proceeds_received ?? null,
        original_proceeds_per_share: pt.original_proceeds_per_share ?? null,
        original_exit_valuation: pt.original_exit_valuation ?? null,
        original_unrealized_value_change: pt.original_unrealized_value_change ?? null,
        original_current_share_price: pt.original_current_share_price ?? null,
        original_latest_postmoney_valuation: pt.original_latest_postmoney_valuation ?? null,
        portfolio_group: pt.portfolio_group ?? null,
      })

    if (insertError) {
      results.errors.push(`Failed to insert ${txnType} for "${companyName}": ${insertError.message}`)
      continue
    }

    if (txnType === 'investment') results.investmentsCreated++
    else if (txnType === 'proceeds') results.proceedsCreated++
    else if (txnType === 'unrealized_gain_change') results.unrealizedCreated++
  }

  logActivity(admin, fundId, user.id, 'import.investments', {
    investmentsCreated: results.investmentsCreated,
    proceedsCreated: results.proceedsCreated,
    unrealizedCreated: results.unrealizedCreated,
    companiesCreated: results.companiesCreated,
    companiesMatched: results.companiesMatched,
  })

  return NextResponse.json(results)
}
