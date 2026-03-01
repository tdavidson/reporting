import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function getPast4Quarters(now: Date) {
  const month = now.getMonth()
  const year = now.getFullYear()
  const currentQ = Math.floor(month / 3) + 1

  const quarters: { label: string; year: number; quarter: number }[] = []
  let q = currentQ - 1
  let y = year
  if (q <= 0) { q = 4; y-- }

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
    .eq('status', 'active')
    .order('name')

  if (!companies || companies.length === 0) {
    return NextResponse.json({ quarters: [], data: [] })
  }

  const quarters = getPast4Quarters(new Date())

  // Get metric_values for these companies in the relevant quarters
  const companyIds = companies.map((c) => c.id)
  const minYear = quarters[0].year
  const maxYear = quarters[quarters.length - 1].year

  const { data: metricValues } = await admin
    .from('metric_values')
    .select('company_id, period_year, period_quarter')
    .eq('fund_id', membership.fund_id)
    .in('company_id', companyIds)
    .gte('period_year', minYear)
    .lte('period_year', maxYear)
    .not('period_quarter', 'is', null)

  // Build a set for fast lookup: "companyId:year:quarter"
  const valueSet = new Set<string>()
  for (const mv of metricValues ?? []) {
    if (mv.period_quarter != null) {
      valueSet.add(`${mv.company_id}:${mv.period_year}:${mv.period_quarter}`)
    }
  }

  const data = companies.map((c) => ({
    companyId: c.id,
    companyName: c.name,
    quarters: quarters.map((q) => ({
      responded: valueSet.has(`${c.id}:${q.year}:${q.quarter}`),
    })),
  }))

  return NextResponse.json({
    quarters: quarters.map((q) => ({ label: q.label })),
    data,
  })
}
