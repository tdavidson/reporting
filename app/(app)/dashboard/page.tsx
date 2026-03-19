import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeSummary } from '@/lib/investments'
import type { InvestmentTransaction, CompanyStatus } from '@/lib/types/database'

export const metadata: Metadata = { title: 'Portfolio' }
import { DashboardCompanies } from './dashboard-companies'
import { DashboardNotesLayout, DashboardChatButton, DashboardNotesPanel } from './dashboard-notes'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  const isAdmin = membership?.role === 'admin'

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString()

  type CompanyRow = {
    id: string; name: string; stage: string | null; status: string
    tags: string[]; industry: string[] | null; portfolio_group: string[] | null
    logo_url: string | null
    metrics: { id: string; name: string; unit: string | null; unit_position: string; value_type: string; currency: string | null; display_order: number; is_active: boolean }[]
    parsing_reviews: { id: string; resolution: string | null }[]
  }

  const { data: companiesRaw } = await supabase
    .from('companies')
    .select(`
      id, name, stage, status, tags, industry, portfolio_group, logo_url,
      metrics(id, name, unit, unit_position, value_type, currency, display_order, is_active),
      parsing_reviews(id, resolution)
    `)
    .order('name') as { data: CompanyRow[] | null }

  const cashMetricMap = new Map<string, string>()
  for (const c of companiesRaw ?? []) {
    const cashMetric = (c.metrics ?? []).find(m =>
      m.is_active && (m.name.toLowerCase() === 'cash' || /\bcash\b/i.test(m.name))
    )
    if (cashMetric) cashMetricMap.set(c.id, cashMetric.id)
  }

  const cashMetricIds = Array.from(cashMetricMap.values())
  const cashValues = new Map<string, number>()
  if (cashMetricIds.length > 0) {
    const { data: cashRows } = await supabase
      .from('metric_values')
      .select('metric_id, value_number')
      .in('metric_id', cashMetricIds)
      .not('value_number', 'is', null)
      .order('period_year', { ascending: false })
      .order('created_at', { ascending: false }) as { data: { metric_id: string; value_number: number }[] | null }

    for (const row of cashRows ?? []) {
      if (!cashValues.has(row.metric_id)) {
        cashValues.set(row.metric_id, row.value_number)
      }
    }
  }

  const { data: latestPeriodRows } = await supabase
    .from('metric_values')
    .select('company_id, period_year, period_quarter, period_month')
    .in('company_id', (companiesRaw ?? []).map(c => c.id))
    .order('period_year', { ascending: false })
    .order('period_quarter', { ascending: false, nullsFirst: false })
    .order('period_month', { ascending: false, nullsFirst: false }) as { data: { company_id: string; period_year: number; period_quarter: number | null; period_month: number | null }[] | null }

  const lastMetricPeriod = new Map<string, string>()
  for (const row of latestPeriodRows ?? []) {
    if (lastMetricPeriod.has(row.company_id)) continue
    if (row.period_month) {
      const lastDay = new Date(row.period_year, row.period_month, 0)
      lastMetricPeriod.set(row.company_id, lastDay.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }))
    } else if (row.period_quarter) {
      const qLabels = ['Q1', 'Q2', 'Q3', 'Q4']
      lastMetricPeriod.set(row.company_id, `${qLabels[row.period_quarter - 1]} ${row.period_year}`)
    } else {
      lastMetricPeriod.set(row.company_id, `${row.period_year}`)
    }
  }

  const companies = (companiesRaw ?? []).map((c) => {
    const lastReportAt = lastMetricPeriod.get(c.id) ?? null
    const activeMetrics = (c.metrics ?? [])
      .filter((m) => m.is_active)
      .sort((a, b) => a.display_order - b.display_order)
    const openReviews = (c.parsing_reviews ?? []).filter((r) => r.resolution === null).length
    const cashMetricId = cashMetricMap.get(c.id)
    const latestCash = cashMetricId ? cashValues.get(cashMetricId) ?? null : null

    return {
      id: c.id,
      name: c.name,
      stage: c.stage,
      status: c.status,
      tags: c.tags ?? [],
      industry: c.industry,
      portfolioGroup: c.portfolio_group,
      logoUrl: c.logo_url ?? null,
      lastReportAt,
      openReviews,
      activeMetrics: activeMetrics.map(m => ({ id: m.id, name: m.name, unit: m.unit, unit_position: m.unit_position, value_type: m.value_type, currency: m.currency })),
      latestCash,
    }
  })

  const allCompanyIds = companies.map(c => c.id)
  const admin = createAdminClient()
  const { data: allTxns } = await admin
    .from('investment_transactions' as any)
    .select('*')
    .in('company_id', allCompanyIds)
    .order('transaction_date', { ascending: true }) as { data: InvestmentTransaction[] | null }

  const txnsByCompany = new Map<string, InvestmentTransaction[]>()
  for (const txn of allTxns ?? []) {
    if (!txnsByCompany.has(txn.company_id)) txnsByCompany.set(txn.company_id, [])
    txnsByCompany.get(txn.company_id)!.push(txn)
  }

  const firstInvestmentDates = new Map<string, string>()
  for (const companyId of Array.from(txnsByCompany.keys())) {
    const txns = txnsByCompany.get(companyId)!
    const investmentTxns = txns.filter((t: InvestmentTransaction) => t.transaction_type === 'investment' && t.transaction_date)
    if (investmentTxns.length > 0) {
      firstInvestmentDates.set(companyId, investmentTxns[0].transaction_date!)
    }
  }

  const exitedIds = companies
    .filter(c => c.status === 'exited' || c.status === 'written-off')
    .map(c => c.id)

  const investmentSummaries = new Map<string, { moic: number | null; grossIrr: number | null; totalInvested: number; totalRealized: number; unrealizedValue: number }>()

  for (const id of exitedIds) {
    const txns = txnsByCompany.get(id) ?? []
    const status = companies.find(c => c.id === id)!.status as CompanyStatus
    if (txns.length > 0) {
      const summary = computeSummary(txns, status)
      investmentSummaries.set(id, { moic: summary.moic, grossIrr: summary.grossIrr, totalInvested: summary.totalInvested, totalRealized: summary.totalRealized, unrealizedValue: summary.unrealizedValue })
    } else {
      investmentSummaries.set(id, { moic: null, grossIrr: null, totalInvested: 0, totalRealized: 0, unrealizedValue: 0 })
    }
  }

  const companiesWithInvestments = companies.map(c => ({
    ...c,
    firstInvestmentDate: firstInvestmentDates.get(c.id) ?? null,
    moic: investmentSummaries.get(c.id)?.moic ?? null,
    grossIrr: investmentSummaries.get(c.id)?.grossIrr ?? null,
    totalInvested: investmentSummaries.get(c.id)?.totalInvested ?? null,
    totalRealized: investmentSummaries.get(c.id)?.totalRealized ?? null,
    unrealizedValue: investmentSummaries.get(c.id)?.unrealizedValue ?? null,
  }))

  const allGroups = Array.from(new Set(companiesWithInvestments.flatMap(c => c.portfolioGroup ?? []))).sort()

  return (
    <DashboardNotesLayout userId={user.id} isAdmin={isAdmin} companies={companiesWithInvestments.map(c => ({ id: c.id, name: c.name }))}>
      <div className="p-4 md:py-8 md:pl-8 md:pr-4">
        <div className="mb-6 space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">Portfolio</h1>
            <div className="flex items-center gap-2">
              <DashboardChatButton />
              <AnalystToggleButton />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Track performance and activity across your portfolio companies</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-6 items-start">
          <div className="flex-1 min-w-0 max-w-7xl w-full">
            <DashboardCompanies companies={companiesWithInvestments} allGroups={allGroups} />
          </div>
          <DashboardNotesPanel />
          <AnalystPanel />
        </div>
      </div>
    </DashboardNotesLayout>
  )
}
