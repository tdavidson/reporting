import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

interface ManagementRow {
  companyId: string
  name: string
  logoUrl: string | null
  stage: string | null
  status: string
  portfolioGroup: string[]
  ownershipPct: number | null
  capitalInvested: number | null
  entryValuation: number | null
  currentValuation: number | null
  moic: number | null
  evRevenue: number | null
  mrr: number | null
  mrrGrowth: number | null
  cash: number | null
  burn: number | null
  runway: number | null
  lastUpdateAt: string | null
}

type Txn = {
  company_id: string
  transaction_type: string
  transaction_date: string | null
  ownership_pct: number | null
  postmoney_valuation: number | null
  latest_postmoney_valuation: number | null
  exit_valuation: number | null
  investment_cost: number | null
  unrealized_value_change: number | null
}

type MetricMeta = {
  id: string
  company_id: string
  name: string
  value_type: string
  unit: string | null
  unit_position: string
  currency: string | null
}

type ValRow = {
  metric_id: string
  value_number: number | null
  period_year: number
  period_month: number | null
  period_quarter: number | null
  updated_at: string
}

function matchMetric(
  metrics: { id: string; name: string }[],
  keywords: string[]
): string | null {
  for (const kw of keywords) {
    const re = new RegExp(kw, 'i')
    const m = metrics.find(m => re.test(m.name))
    if (m) return m.id
  }
  return null
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

  const fundId = membership.fund_id

  // Companies
  const { data: companiesRaw } = await admin
    .from('companies')
    .select('id, name, stage, status, portfolio_group')
    .eq('fund_id', fundId)
    .order('name')

  const companies = (companiesRaw ?? []) as {
    id: string
    name: string
    stage: string | null
    status: string
    portfolio_group: string[] | null
  }[]

  if (companies.length === 0) return NextResponse.json({ rows: [] })

  const companyIds = companies.map(c => c.id)

  // Investment transactions — cast through unknown to bypass Supabase type inference
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: txnsRaw } = await (admin as any)
    .from('investment_transactions')
    .select(
      'company_id, transaction_type, transaction_date, ownership_pct, postmoney_valuation, latest_postmoney_valuation, exit_valuation, investment_cost, unrealized_value_change'
    )
    .eq('fund_id', fundId)
    .in('company_id', companyIds)
    .order('transaction_date', { ascending: true })

  const txnsByCompany = new Map<string, Txn[]>()
  for (const t of (txnsRaw ?? []) as unknown as Txn[]) {
    const list = txnsByCompany.get(t.company_id) ?? []
    list.push(t)
    txnsByCompany.set(t.company_id, list)
  }

  // Metrics
  const { data: metricsRaw } = await admin
    .from('metrics')
    .select('id, company_id, name, value_type, unit, unit_position, currency')
    .in('company_id', companyIds)
    .eq('is_active', true)

  const metricsByCompany = new Map<string, MetricMeta[]>()
  for (const m of (metricsRaw ?? []) as unknown as MetricMeta[]) {
    const list = metricsByCompany.get(m.company_id) ?? []
    list.push(m)
    metricsByCompany.set(m.company_id, list)
  }

  const relevantMetricIds = new Set<string>()
  const metricRoleMap = new Map<string, { companyId: string; role: 'mrr' | 'cash' | 'burn' | 'revenue' }>()

  for (const [companyId, metrics] of Array.from(metricsByCompany.entries())) {
    const mrrId = matchMetric(metrics, ['\\bmrr\\b', 'monthly recurring revenue', 'receita recorrente'])
    const cashId = matchMetric(metrics, ['\\bcash\\b', 'caixa', 'saldo'])
    const burnId = matchMetric(metrics, ['\\bburn\\b', 'queima', 'cash burn'])
    const revId = matchMetric(metrics, ['\\brevenue\\b', 'receita', 'arr'])

    if (mrrId) { relevantMetricIds.add(mrrId); metricRoleMap.set(mrrId, { companyId, role: 'mrr' }) }
    if (cashId) { relevantMetricIds.add(cashId); metricRoleMap.set(cashId, { companyId, role: 'cash' }) }
    if (burnId) { relevantMetricIds.add(burnId); metricRoleMap.set(burnId, { companyId, role: 'burn' }) }
    if (revId && !mrrId) { relevantMetricIds.add(revId); metricRoleMap.set(revId, { companyId, role: 'revenue' }) }
  }

  const latestValueMap = new Map<string, { value: number | null; date: string | null }>()
  const prevValueMap = new Map<string, number | null>()

  if (relevantMetricIds.size > 0) {
    const { data: valuesRaw } = await admin
      .from('metric_values')
      .select('metric_id, value_number, period_year, period_month, period_quarter, updated_at')
      .in('metric_id', Array.from(relevantMetricIds))
      .not('value_number', 'is', null)
      .order('period_year', { ascending: false })
      .order('period_month', { ascending: false, nullsFirst: false })

    const byMetric = new Map<string, ValRow[]>()
    for (const v of (valuesRaw ?? []) as unknown as ValRow[]) {
      const list = byMetric.get(v.metric_id) ?? []
      list.push(v)
      byMetric.set(v.metric_id, list)
    }

    for (const [metricId, rows] of Array.from(byMetric.entries())) {
      const latest = rows[0]
      const dateStr = latest.period_month
        ? `${latest.period_year}-${String(latest.period_month).padStart(2, '0')}`
        : latest.period_quarter
          ? `${latest.period_year} Q${latest.period_quarter}`
          : `${latest.period_year}`
      latestValueMap.set(metricId, { value: latest.value_number, date: dateStr })
      prevValueMap.set(metricId, rows[1]?.value_number ?? null)
    }
  }

  const lastUpdateByCompany = new Map<string, string>()
  if (relevantMetricIds.size > 0) {
    const { data: lastUpdateRaw } = await admin
      .from('metric_values')
      .select('metric_id, updated_at')
      .in('metric_id', Array.from(relevantMetricIds))
      .order('updated_at', { ascending: false })

    for (const r of (lastUpdateRaw ?? []) as unknown as { metric_id: string; updated_at: string }[]) {
      const role = metricRoleMap.get(r.metric_id)
      if (!role) continue
      const existing = lastUpdateByCompany.get(role.companyId)
      if (!existing || r.updated_at > existing) {
        lastUpdateByCompany.set(role.companyId, r.updated_at)
      }
    }
  }

  const rows: ManagementRow[] = companies.map(c => {
    const txns = txnsByCompany.get(c.id) ?? []
    const metrics = metricsByCompany.get(c.id) ?? []

    let totalInvested = 0
    let ownershipPct: number | null = null
    let entryValuation: number | null = null
    let currentValuation: number | null = null

    for (const t of txns) {
      if (t.transaction_type === 'investment') {
        totalInvested += t.investment_cost ?? 0
        if (t.ownership_pct != null) ownershipPct = t.ownership_pct
        const val = t.postmoney_valuation
        if (val != null) {
          if (entryValuation === null) entryValuation = val
          currentValuation = val
        }
      }
      if (t.transaction_type === 'unrealized_gain_change') {
        if (t.ownership_pct != null) ownershipPct = t.ownership_pct
        const val = t.latest_postmoney_valuation
        if (val != null) currentValuation = val
      }
      if (t.transaction_type === 'round_info') {
        const val = t.postmoney_valuation
        if (val != null) {
          if (entryValuation === null) entryValuation = val
          currentValuation = val
        }
      }
    }

    const moic = totalInvested > 0 && currentValuation != null && ownershipPct != null
      ? (currentValuation * (ownershipPct / 100)) / totalInvested
      : null

    const mrrId = matchMetric(metrics, ['\\bmrr\\b', 'monthly recurring revenue', 'receita recorrente'])
    const cashId = matchMetric(metrics, ['\\bcash\\b', 'caixa', 'saldo'])
    const burnId = matchMetric(metrics, ['\\bburn\\b', 'queima', 'cash burn'])
    const revId = matchMetric(metrics, ['\\brevenue\\b', 'receita', 'arr'])

    const mrrVal = mrrId ? (latestValueMap.get(mrrId)?.value ?? null) : null
    const mrrPrev = mrrId ? (prevValueMap.get(mrrId) ?? null) : null
    const mrrGrowth = mrrVal != null && mrrPrev != null && mrrPrev !== 0
      ? (mrrVal - mrrPrev) / Math.abs(mrrPrev)
      : null

    const cashVal = cashId ? (latestValueMap.get(cashId)?.value ?? null) : null
    const burnVal = burnId ? (latestValueMap.get(burnId)?.value ?? null) : null
    const runway = cashVal != null && burnVal != null && burnVal > 0
      ? Math.round(cashVal / burnVal)
      : null

    const revenueForEv = mrrVal != null
      ? mrrVal * 12
      : revId ? (latestValueMap.get(revId)?.value ?? null) : null
    const evRevenue = currentValuation != null && revenueForEv != null && revenueForEv > 0
      ? currentValuation / revenueForEv
      : null

    return {
      companyId: c.id,
      name: c.name,
      logoUrl: null,
      stage: c.stage,
      status: c.status,
      portfolioGroup: c.portfolio_group ?? [],
      ownershipPct,
      capitalInvested: totalInvested > 0 ? totalInvested : null,
      entryValuation,
      currentValuation,
      moic,
      evRevenue,
      mrr: mrrVal,
      mrrGrowth,
      cash: cashVal,
      burn: burnVal,
      runway,
      lastUpdateAt: lastUpdateByCompany.get(c.id) ?? null,
    }
  })

  return NextResponse.json({ rows })
}
