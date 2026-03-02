import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ArrowLeft } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import type { Company, Metric } from '@/lib/types/database'
import { CompanyCharts } from './company-charts'
import { CompanySummary } from './company-summary'
import { CompanyEditButton } from './company-edit-button'
import { CompanyNotesLayout, ChatButton, CompanyNotesPanel } from './company-notes'
import { CompanyDocuments } from './company-documents'

function formatHighlightValue(value: number, metric: Metric) {
  let formatted: string
  if (metric.value_type === 'percentage') {
    formatted = `${value}%`
  } else if (Math.abs(value) >= 1_000_000) {
    formatted = `${(value / 1_000_000).toFixed(1)}M`
  } else if (Math.abs(value) >= 1_000) {
    formatted = `${(value / 1_000).toFixed(0)}K`
  } else {
    formatted = value.toLocaleString('en-US', { maximumFractionDigits: 2 })
  }

  if (!metric.unit) return formatted
  return metric.unit_position === 'prefix'
    ? `${metric.unit}${formatted}`
    : `${formatted} ${metric.unit}`
}

export default async function CompanyDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', params.id)
    .maybeSingle() as { data: Company | null }

  if (!company) redirect('/dashboard')

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  const isAdmin = membership?.role === 'admin'

  // Fetch AI provider settings for the summary component
  const { data: fundSettings } = await supabase
    .from('fund_settings')
    .select('claude_api_key_encrypted, openai_api_key_encrypted, default_ai_provider')
    .eq('fund_id', company.fund_id)
    .maybeSingle() as { data: { claude_api_key_encrypted: string | null; openai_api_key_encrypted: string | null; default_ai_provider: string | null } | null }

  const { data: metrics } = await supabase
    .from('metrics')
    .select('*')
    .eq('company_id', params.id)
    .eq('is_active', true)
    .order('display_order') as { data: Metric[] | null }

  // Find highlight metrics (MRR and Cash)
  const mrrMetric = metrics?.find(m =>
    m.slug === 'mrr' || /\bmrr\b/i.test(m.name) || /monthly recurring revenue/i.test(m.name)
  )
  const cashMetric = metrics?.find(m =>
    m.slug === 'cash' || /\bcash\b/i.test(m.name)
  )

  let latestMrr: { value: number; period: string; metric: Metric } | null = null
  let latestCash: { value: number; period: string; metric: Metric } | null = null

  async function getLatestValue(metricId: string) {
    const { data } = await supabase
      .from('metric_values')
      .select('value_number, period_label')
      .eq('metric_id', metricId)
      .not('value_number', 'is', null)
      .order('period_year', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1) as { data: { value_number: number; period_label: string }[] | null }
    return data?.[0] ?? null
  }

  const [mrrRow, cashRow] = await Promise.all([
    mrrMetric ? getLatestValue(mrrMetric.id) : null,
    cashMetric ? getLatestValue(cashMetric.id) : null,
  ])

  if (mrrRow && mrrMetric) {
    latestMrr = { value: mrrRow.value_number!, period: mrrRow.period_label, metric: mrrMetric }
  }
  if (cashRow && cashMetric) {
    latestCash = { value: cashRow.value_number!, period: cashRow.period_label, metric: cashMetric }
  }

  return (
    <CompanyNotesLayout companyId={company.id} userId={user.id} isAdmin={isAdmin}>
    <div className="p-4 md:p-8">
      {/* Header */}
      <div className="mb-6 max-w-6xl">
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Portfolio
        </Link>

        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold tracking-tight">{company.name}</h1>
          <CompanyEditButton company={company} />
          {(company.portfolio_group ?? []).map((pg) => (
            <Badge key={pg} variant="outline">{pg}</Badge>
          ))}
          {company.stage && (
            <Badge variant="outline">{company.stage}</Badge>
          )}
          {(company.industry ?? []).map((ind) => (
            <Badge key={ind} variant="outline">{ind}</Badge>
          ))}
          <ChatButton />
        </div>

        {(latestMrr || latestCash) && (
          <div className="flex items-center gap-4 mt-1.5">
            {latestMrr && (
              <span className="text-sm">
                <span className="text-muted-foreground">MRR:</span>{' '}
                <span className="font-medium">{formatHighlightValue(latestMrr.value, latestMrr.metric)}</span>
                <span className="text-xs text-muted-foreground ml-1">({latestMrr.period})</span>
              </span>
            )}
            {latestCash && (
              <span className="text-sm">
                <span className="text-muted-foreground">Cash:</span>{' '}
                <span className="font-medium">{formatHighlightValue(latestCash.value, latestCash.metric)}</span>
                <span className="text-xs text-muted-foreground ml-1">({latestCash.period})</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Content + Notes panel side by side */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-6xl w-full">
          <CompanySummary
            companyId={company.id}
            fundId={company.fund_id}
            hasClaudeKey={!!fundSettings?.claude_api_key_encrypted}
            hasOpenAIKey={!!fundSettings?.openai_api_key_encrypted}
            defaultAIProvider={fundSettings?.default_ai_provider ?? 'anthropic'}
          />

          <CompanyCharts
            companyId={company.id}
            companyName={company.name}
            metrics={metrics ?? []}
          />

          <CompanyDocuments companyId={company.id} />

          {(company.founders || (company.contact_email && company.contact_email.length > 0) || company.overview || company.why_invested || company.current_update) && (
            <div className="mt-6 space-y-3">
              {company.founders && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Founders</h3>
                  <p className="text-sm">{company.founders}</p>
                </div>
              )}

              {company.contact_email && company.contact_email.length > 0 && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Contact{company.contact_email.length > 1 ? 's' : ''}</h3>
                  <div className="flex flex-wrap gap-x-4 gap-y-1">
                    {company.contact_email.map((email) => (
                      <p key={email} className="text-sm">
                        <a href={`mailto:${email}`} className="hover:underline">
                          {email}
                        </a>
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {company.overview && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Overview</h3>
                  <p className="text-sm">{company.overview}</p>
                </div>
              )}

              {company.why_invested && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Why We Invested</h3>
                  <p className="text-sm">{company.why_invested}</p>
                </div>
              )}

              {company.current_update && (
                <div>
                  <h3 className="text-sm font-medium text-muted-foreground mb-1">Current Business Update</h3>
                  <p className="text-sm">{company.current_update}</p>
                </div>
              )}
            </div>
          )}
        </div>

        <CompanyNotesPanel />
      </div>
    </div>
    </CompanyNotesLayout>
  )
}
