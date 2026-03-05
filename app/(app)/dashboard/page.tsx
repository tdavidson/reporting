import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

  // Fetch companies with their first 2 metrics and review counts
  type CompanyRow = {
    id: string; name: string; stage: string | null; status: string
    tags: string[]; industry: string[] | null; portfolio_group: string[] | null
    metrics: { id: string; name: string; unit: string | null; unit_position: string; value_type: string; currency: string | null; display_order: number; is_active: boolean }[]
    inbound_emails: { received_at: string }[]
    parsing_reviews: { id: string; resolution: string | null }[]
  }

  const { data: companiesRaw } = await supabase
    .from('companies')
    .select(`
      id, name, stage, status, tags, industry, portfolio_group,
      metrics(id, name, unit, unit_position, value_type, currency, display_order, is_active),
      inbound_emails(received_at),
      parsing_reviews(id, resolution)
    `)
    .order('name') as { data: CompanyRow[] | null }

  // Find cash metric IDs for each company
  const cashMetricMap = new Map<string, string>()
  for (const c of companiesRaw ?? []) {
    const cashMetric = (c.metrics ?? []).find(m =>
      m.is_active && (m.name.toLowerCase() === 'cash' || /\bcash\b/i.test(m.name))
    )
    if (cashMetric) cashMetricMap.set(c.id, cashMetric.id)
  }

  // Batch fetch latest cash values
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

    // Keep only the first (latest) value per metric
    for (const row of cashRows ?? []) {
      if (!cashValues.has(row.metric_id)) {
        cashValues.set(row.metric_id, row.value_number)
      }
    }
  }

  const companies = (companiesRaw ?? []).map((c) => {
    const emails = c.inbound_emails ?? []
    const lastReportAt = emails.length > 0
      ? emails.reduce((max, e) => (e.received_at > max ? e.received_at : max), emails[0].received_at)
      : null
    const activeMetrics = (c.metrics ?? [])
      .filter((m) => m.is_active)
      .sort((a, b) => a.display_order - b.display_order)
      .slice(0, 2)
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
      lastReportAt,
      openReviews,
      metricsCount: (c.metrics ?? []).filter((m) => m.is_active).length,
      sparkMetrics: activeMetrics,
      latestCash,
    }
  })

  const allGroups = Array.from(new Set(companies.flatMap(c => c.portfolioGroup ?? []))).sort()

  return (
    <DashboardNotesLayout userId={user.id} isAdmin={isAdmin} companies={companies.map(c => ({ id: c.id, name: c.name }))}>
    <div className="p-4 md:py-8 md:pl-8 md:pr-4">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Portfolio Overview</h1>
        <div className="flex items-center gap-2">
          <DashboardChatButton />
          <AnalystToggleButton />
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-7xl w-full">
          <DashboardCompanies companies={companies} allGroups={allGroups} />
        </div>
        <DashboardNotesPanel />
        <AnalystPanel />
      </div>
    </div>
    </DashboardNotesLayout>
  )
}
