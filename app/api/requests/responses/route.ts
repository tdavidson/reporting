import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

function getRecentQuarters(now: Date) {
  const month = now.getMonth()
  const year = now.getFullYear()
  const currentQ = Math.floor(month / 3) + 1

  // Include current quarter + 3 prior quarters (4 total)
  const quarters: { label: string; year: number; quarter: number }[] = []
  let q = currentQ
  let y = year

  for (let i = 0; i < 4; i++) {
    quarters.push({ label: `Q${q} ${y}`, year: y, quarter: q })
    q--
    if (q <= 0) { q = 4; y-- }
  }

  return quarters.reverse()
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  // Get active companies
  const { data: companies } = await admin
    .from('companies')
    .select('id, name')
    .eq('fund_id', membership.fund_id)
    .eq('holding_type', 'company')   // fund holdings have their own surfaces
    .eq('status', 'active')
    .order('name')

  if (!companies || companies.length === 0) {
    return NextResponse.json({ quarters: [], data: [] })
  }

  const quarters = getRecentQuarters(new Date())

  // Get metric_values for these companies in the relevant quarters
  const companyIds = companies.map((c) => c.id)
  const minYear = quarters[0].year
  const maxYear = quarters[quarters.length - 1].year

  const [{ data: metricValues }, { data: overrides }] = await Promise.all([
    admin
      .from('metric_values')
      .select('company_id, period_year, period_quarter, period_month')
      .eq('fund_id', membership.fund_id)
      .in('company_id', companyIds)
      .gte('period_year', minYear)
      .lte('period_year', maxYear),
    admin
      .from('ask_response_overrides' as any)
      .select('company_id, quarter, year, status')
      .eq('fund_id', membership.fund_id)
      .in('company_id', companyIds)
      .gte('year', minYear)
      .lte('year', maxYear),
  ])

  // Build a set for fast lookup: "companyId:year:quarter"
  const valueSet = new Set<string>()
  for (const mv of metricValues ?? []) {
    const q = mv.period_quarter ?? (mv.period_month ? Math.ceil(mv.period_month / 3) : null)
    if (q != null) {
      valueSet.add(`${mv.company_id}:${mv.period_year}:${q}`)
    }
  }

  // Build override map: "companyId:year:quarter" -> status
  const overrideMap = new Map<string, string>()
  for (const o of ((overrides ?? []) as unknown as { company_id: string; year: number; quarter: number; status: string }[])) {
    overrideMap.set(`${o.company_id}:${o.year}:${o.quarter}`, o.status)
  }

  const data = companies.map((c) => ({
    companyId: c.id,
    companyName: c.name,
    quarters: quarters.map((q) => {
      const key = `${c.id}:${q.year}:${q.quarter}`
      const override = overrideMap.get(key)
      if (override) {
        return { status: override as 'yes' | 'no' | 'na' }
      }
      return { status: valueSet.has(key) ? 'yes' as const : 'no' as const }
    }),
  }))

  return NextResponse.json({
    quarters: quarters.map((q) => ({ label: q.label, year: q.year, quarter: q.quarter })),
    data,
  })
}

// Update a single company's response status for a quarter
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()
  const { company_id, quarter, year, status } = body

  if (!company_id || !quarter || !year || !status) {
    return NextResponse.json({ error: 'company_id, quarter, year, and status required' }, { status: 400 })
  }

  const VALID_STATUSES = ['yes', 'no', 'na']
  if (!VALID_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'status must be yes, no, or na' }, { status: 400 })
  }

  // If setting back to auto-detected value, remove the override
  // Otherwise upsert
  if (status === 'yes' || status === 'no') {
    // Check if auto-detected value matches — if so, delete override
    const { data: metricValues } = await admin
      .from('metric_values')
      .select('id')
      .eq('fund_id', fundId)
      .eq('company_id', company_id)
      .eq('period_year', year)
      .eq('period_quarter', quarter)
      .limit(1)

    const autoDetected = (metricValues && metricValues.length > 0) ? 'yes' : 'no'
    if (status === autoDetected) {
      // Remove override, fall back to auto-detection
      await admin
        .from('ask_response_overrides' as any)
        .delete()
        .eq('fund_id', fundId)
        .eq('company_id', company_id)
        .eq('quarter', quarter)
        .eq('year', year)

      return NextResponse.json({ status, source: 'auto' })
    }
  }

  const { data, error } = await admin
    .from('ask_response_overrides' as any)
    .upsert({
      fund_id: fundId,
      company_id,
      quarter: Number(quarter),
      year: Number(year),
      status,
      set_by: user.id,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'fund_id,company_id,quarter,year' })
    .select()
    .single()

  if (error) return dbError(error, 'requests-responses')
  return NextResponse.json(data)
}
