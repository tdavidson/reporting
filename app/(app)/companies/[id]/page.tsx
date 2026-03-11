import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { ArrowLeft } from 'lucide-react'

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const supabase = createClient()
  const { data } = await supabase.from('companies').select('name').eq('id', params.id).maybeSingle() as { data: { name: string } | null }
  return { title: data?.name ?? 'Company' }
}
import { Badge } from '@/components/ui/badge'
import { getCurrencySymbol } from '@/components/currency-context'
import type { Company, Metric, CompanyStatus } from '@/lib/types/database'
import { CompanyCharts } from './company-charts'
import { CompanySummary } from './company-summary'
import { CompanyEditButton } from './company-edit-button'
import { CompanyPanelProvider } from './company-panel-context'
import { ChatButton, CompanyNotesPanel } from './company-notes'
import { AnalystButton } from './company-analyst'
import { AnalystPanel } from '@/components/analyst-panel'
import { CompanyDocuments } from './company-documents'
import { CompanyInvestments } from './company-investments'
import { CompanyInteractions } from './company-interactions'
import { isFeatureVisible, DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'

function formatHighlightValue(value: number, metric: Metric, fundCurrency: string) {
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

  // Use explicit metric unit if set, otherwise fall back to metric/fund currency for currency-type metrics
  const metricCurrency = metric.currency ?? fundCurrency
  const unit = metric.unit ?? (metric.value_type === 'currency' ? getCurrencySymbol(metricCurrency) : null)
  const unitPosition = metric.unit ? metric.unit_position : 'prefix'

  if (!unit) return formatted
  return unitPosition === 'prefix'
    ? `${unit}${formatted}`
    : `${formatted} ${unit}`
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
    .select('claude_api_key_encrypted, openai_api_key_encrypted, default_ai_provider, currency, file_storage_provider, google_drive_folder_id, dropbox_folder_path, feature_visibility')
    .eq('fund_id', company.fund_id)
    .maybeSingle() as { data: { claude_api_key_encrypted: string | null; openai_api_key_encrypted: string | null; default_ai_provider: string | null; currency: string | null; file_storage_provider: string | null; google_drive_folder_id: string | null; dropbox_folder_path: string | null; feature_visibility: Record<string, string> | null } | null }

  const fundCurrency = fundSettings?.currency ?? 'USD'
  const featureVisibility = { ...DEFAULT_FEATURE_VISIBILITY, ...(fundSettings?.feature_visibility as Partial<FeatureVisibilityMap> | null) }

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
    <CompanyPanelProvider companyId={company.id} userId={user.id} isAdmin={isAdmin}>
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
          {isFeatureVisible(featureVisibility, 'notes', isAdmin) && <ChatButton />}
          <AnalystButton companyId={company.id} pushRight={!isFeatureVisible(featureVisibility, 'notes', isAdmin)} />
        </div>

        {(latestMrr || latestCash) && (
          <div className="flex items-center gap-4 mt-1.5">
            {latestMrr && (
              <span className="text-sm">
                <span className="text-muted-foreground">MRR:</span>{' '}
                <span className="font-medium">{formatHighlightValue(latestMrr.value, latestMrr.metric, fundCurrency)}</span>
                <span className="text-xs text-muted-foreground ml-1">({latestMrr.period})</span>
              </span>
            )}
            {latestCash && (
              <span className="text-sm">
                <span className="text-muted-foreground">Cash:</span>{' '}
                <span className="font-medium">{formatHighlightValue(latestCash.value, latestCash.metric, fundCurrency)}</span>
                <span className="text-xs text-muted-foreground ml-1">({latestCash.period})</span>
              </span>
            )}
          </div>
        )}
      </div>

      {/* Content + Notes panel side by side */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-6xl w-full [&>*:first-child]:mt-0">
          {company.status !== 'exited' && company.status !== 'written-off' && (
            <>
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
            </>
          )}

          {isFeatureVisible(featureVisibility, 'investments', isAdmin) && (
            <CompanyInvestments companyId={company.id} companyStatus={company.status as CompanyStatus} portfolioGroups={company.portfolio_group ?? []} adminOnly={featureVisibility.investments === 'admin'} />
          )}

          <CompanyDocuments
            companyId={company.id}
            storageProvider={fundSettings?.file_storage_provider ?? null}
            googleDriveFolderId={fundSettings?.google_drive_folder_id ?? null}
            dropboxFolderPath={fundSettings?.dropbox_folder_path ?? null}
          />

          {isFeatureVisible(featureVisibility, 'interactions', isAdmin) && (
            <CompanyInteractions companyId={company.id} adminOnly={featureVisibility.interactions === 'admin'} />
          )}

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

        {isFeatureVisible(featureVisibility, 'notes', isAdmin) && <CompanyNotesPanel />}
        <AnalystPanel />
      </div>
    </div>
    </CompanyPanelProvider>
  )
}
