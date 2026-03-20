import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { createFundAIProvider } from '@/lib/ai'
import { logAIUsage } from '@/lib/ai/usage'
import { logActivity } from '@/lib/activity'
import { rateLimit } from '@/lib/rate-limit'

interface ParsedCashFlow {
  portfolio_group: string
  flow_date: string
  flow_type: 'commitment' | 'called_capital' | 'distribution'
  amount: number
  notes?: string
}

const VALID_FLOW_TYPES = new Set(['commitment', 'called_capital', 'distribution'])

function sanitize(val: string): string {
  return val
    .replace(/<[^>]*>/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .trim()
    .slice(0, 10_000)
}

export async function POST(req: NextRequest) {
  try {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const limited = await rateLimit({ key: `import-cash-flows:${user.id}`, limit: 10, windowSeconds: 300 })
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

  const { data: funds } = await admin
    .from('funds')
    .select('id, name')
    .eq('id', fundId)
    .single()

  let existingGroups: string[] = []
  try {
    const { data: existingFlows } = await admin
      .from('fund_cash_flows' as any)
      .select('portfolio_group')
      .eq('fund_id', fundId)
    existingGroups = Array.from(new Set((existingFlows ?? []).map((f: any) => f.portfolio_group))).filter(Boolean) as string[]
  } catch { /* table may not exist yet */ }

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
      content: `Parse the following fund cash flow data (CSV, spreadsheet, capital call notices, distribution notices, or free-form text) into structured JSON.

Return ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "cash_flows": [
    {
      "portfolio_group": "Fund I",
      "flow_date": "2024-01-15",
      "flow_type": "commitment",
      "amount": 10000000,
      "notes": "Initial commitment"
    }
  ]
}

Rules:
- flow_type must be one of: "commitment", "called_capital", "distribution"
  - "commitment" = capital committed/pledged by LPs
  - "called_capital" = capital called/drawn down from LPs (also known as: capital call, drawdown, contribution, paid-in capital)
  - "distribution" = capital returned to LPs (also known as: return of capital, proceeds, payout)
- Dates should be in YYYY-MM-DD format. Parse any date format (MM/DD/YYYY, DD-Mon-YYYY, etc.)
- All amounts should be positive plain numbers (no currency symbols, no negatives)
- portfolio_group identifies the fund/vehicle (e.g. "Fund I", "Fund II", "SPV 1", "Sidecar"). Use the group name exactly as it appears in the data.
${existingGroups.length > 0 ? `- Existing portfolio groups in the system: ${existingGroups.join(', ')}. Match to these when the name is similar.` : ''}
${funds?.name ? `- The fund is named "${funds.name}". If no group is specified, use this as the portfolio_group.` : ''}
- If the data mentions "call #1", "call #2" etc., those are called_capital entries
- If the data mentions "distribution #1" etc., those are distribution entries
- Capital commitment/subscription amounts are "commitment" type
- Notes are optional — include if the data has descriptions, memo text, or reference numbers
- If amounts include thousands separators (commas, periods) or currency symbols, strip them
- If percentages of commitment are given instead of absolute amounts, and a total commitment is known, calculate the absolute amount

Data to parse:
${text}`,
    })
    responseText = aiResult.text

    logAIUsage(admin, {
      fundId,
      userId: user.id,
      provider: aiProviderType,
      model: claudeModel,
      feature: 'import.fund_cash_flows',
      usage: aiResult.usage,
    })
  } catch (err) {
    console.error('[import-fund-cash-flows] AI API error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'AI API call failed' }, { status: 500 })
  }

  let parsed: { cash_flows: ParsedCashFlow[] }
  try {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error('No JSON found in response')
    parsed = JSON.parse(jsonMatch[0])
  } catch {
    console.error('[import-fund-cash-flows] Failed to parse AI response:', responseText)
    return NextResponse.json({ error: 'Failed to parse AI response as JSON' }, { status: 500 })
  }

  if (!parsed.cash_flows || !Array.isArray(parsed.cash_flows)) {
    return NextResponse.json({ error: 'Invalid response structure' }, { status: 500 })
  }

  if (parsed.cash_flows.length > 5000) {
    return NextResponse.json({ error: 'Too many cash flows in parsed result (max 5000)' }, { status: 400 })
  }

  const results = {
    created: 0,
    skipped: 0,
    errors: [] as string[],
  }

  for (let i = 0; i < parsed.cash_flows.length; i++) {
    const cf = parsed.cash_flows[i]
    const rowLabel = `Row ${i + 1}`

    if (!cf.portfolio_group || typeof cf.portfolio_group !== 'string' || !cf.portfolio_group.trim()) {
      results.errors.push(`${rowLabel}: missing portfolio group`)
      continue
    }

    if (!cf.flow_date || typeof cf.flow_date !== 'string') {
      results.errors.push(`${rowLabel}: missing date`)
      continue
    }

    if (!cf.flow_type || !VALID_FLOW_TYPES.has(cf.flow_type)) {
      results.errors.push(`${rowLabel}: invalid flow type "${cf.flow_type}"`)
      continue
    }

    const amount = typeof cf.amount === 'number' ? cf.amount : parseFloat(String(cf.amount))
    if (isNaN(amount) || amount <= 0) {
      results.errors.push(`${rowLabel}: invalid amount`)
      continue
    }

    if (isUpsert) {
      const { data: existing } = await admin
        .from('fund_cash_flows' as any)
        .select('id')
        .eq('fund_id', fundId)
        .eq('portfolio_group', sanitize(cf.portfolio_group))
        .eq('flow_date', cf.flow_date)
        .eq('flow_type', cf.flow_type)
        .eq('amount', amount)
        .maybeSingle()

      if (existing) {
        results.skipped++
        continue
      }
    }

    const { error: insertError } = await admin
      .from('fund_cash_flows' as any)
      .insert({
        fund_id: fundId,
        portfolio_group: sanitize(cf.portfolio_group),
        flow_date: cf.flow_date,
        flow_type: cf.flow_type,
        amount,
        notes: cf.notes ? sanitize(cf.notes) : null,
      })

    if (insertError) {
      results.errors.push(`${rowLabel}: ${insertError.message}`)
      continue
    }

    results.created++
  }

  logActivity(admin, fundId, user.id, 'import.fund_cash_flows', {
    created: results.created,
  })

  return NextResponse.json(results)
  } catch (err) {
    console.error('[import-fund-cash-flows] Unhandled error:', err)
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 })
  }
}
