import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { ArrowLeft } from 'lucide-react'

export async function generateMetadata(props: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const params = await props.params;
  const supabase = await createClient()
  // Runs BEFORE the page body, so it needs the same gate: the title is a company name, and a
  // member without `portfolio` would otherwise read it off the browser tab on their way to being
  // redirected. Falls back to the generic title rather than 404ing — metadata is not the place to
  // decide whether the page exists.
  const { data: { user } } = await supabase.auth.getUser()
  const page = user ? await resolvePageAccess(user.id) : null
  if (!page || !canViewPage(page, 'portfolio')) return { title: 'Company' }

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
import { CompanyUpdates } from './company-updates'
import { CompanyInvestments } from './company-investments'
import { CompanyInteractions } from './company-interactions'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
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

export default async function CompanyDetailPage(
  props: {
    params: Promise<{ id: string }>
  }
) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getUser()
  if (!user) redirect('/auth')

  // The company itself is `portfolio`. The per-panel checks further down decide which SECTIONS
  // render (notes, interactions, investments each answer to their own domain) — but they were
  // doing that on a page anyone in the fund could open, so a member denied portfolio still got the
  // company and its metrics. The page needs its own gate before any of that.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'portfolio')) redirect('/dashboard')

  const { data: company } = await supabase
    .from('companies')
    .select('*')
    .eq('id', params.id)
    .maybeSingle() as { data: Company | null }

  if (!company) redirect('/dashboard')

  const isAdmin = page.isAdmin

  // Fetch AI provider settings for the summary component
  const { data: fundSettings } = await supabase
    .from('fund_settings')
    .select('claude_api_key_encrypted, openai_api_key_encrypted, default_ai_provider, currency, file_storage_provider, google_drive_folder_id, feature_visibility')
    .eq('fund_id', company.fund_id)
    .maybeSingle() as { data: { claude_api_key_encrypted: string | null; openai_api_key_encrypted: string | null; default_ai_provider: string | null; currency: string | null; file_storage_provider: string | null; google_drive_folder_id: string | null; feature_visibility: Record<string, string> | null } | null }

  const fundCurrency = fundSettings?.currency ?? 'USD'
  const featureVisibility = { ...DEFAULT_FEATURE_VISIBILITY, ...(fundSettings?.feature_visibility as Partial<FeatureVisibilityMap> | null) }

  // These panels each belong to a domain, and their APIs are gated to it. Rendering one for a
  // member without the grant would show an empty panel that 403s on load, so ask the resolver —
  // the feature switch alone is only half the answer. (`page` is resolved above, where it decides
  // whether this page renders at all.)
  const showNotes = canViewPage(page, 'relationships', 'notes')
  const showInvestments = canViewPage(page, 'portfolio', 'investments')
  const showInteractions = canViewPage(page, 'relationships', 'interactions')

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

  const [mrrRow, cashRow, capturedUpdates] = await Promise.all([
    mrrMetric ? getLatestValue(mrrMetric.id) : null,
    cashMetric ? getLatestValue(cashMetric.id) : null,
    // Once the company has captured Company Updates, that section owns reporting mail and the
    // documents panel drops its legacy email listing. Until the backfill reaches a company, the
    // legacy listing is still how its email history is reachable.
    supabase.from('company_updates').select('id', { count: 'exact', head: true }).eq('company_id', params.id),
  ])
  const hasCapturedUpdates = (capturedUpdates?.count ?? 0) > 0

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
      <div className="mb-6 max-w-page">
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
          {showNotes && <ChatButton />}
          <AnalystButton companyId={company.id} pushRight={!showNotes} />
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
        <div className="flex-1 min-w-0 max-w-page w-full [&>*:first-child]:mt-0">
          {company.status !== 'exited' && company.status !== 'written-off' && (
            <>
              <CompanySummary
                companyId={company.id}
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

          {showInvestments && (
            <CompanyInvestments companyId={company.id} companyStatus={company.status as CompanyStatus} portfolioGroups={company.portfolio_group ?? []} adminOnly={featureVisibility.investments === 'admin'} />
          )}

          <div id="updates">
            <CompanyUpdates companyId={company.id} />
          </div>

          <CompanyDocuments
            companyId={company.id}
            fundId={company.fund_id}
            storageProvider={fundSettings?.file_storage_provider ?? null}
            googleDriveFolderId={fundSettings?.google_drive_folder_id ?? null}
            includeEmailHistory={!hasCapturedUpdates}
          />

          {showInteractions && (
            <CompanyInteractions companyId={company.id} adminOnly={featureVisibility.interactions === 'admin'} />
          )}

          {(company.founders || (company.contact_email && company.contact_email.length > 0) || company.overview || company.why_invested || company.current_update) && (
            <div className="mt-6 space-y-3">
              {company.founders && (
                <div>
                  <h3 className="text-base font-medium text-muted-foreground mb-1">Founders</h3>
                  <p className="text-sm">{company.founders}</p>
                </div>
              )}

              {company.contact_email && company.contact_email.length > 0 && (
                <div>
                  <h3 className="text-base font-medium text-muted-foreground mb-1">Contact{company.contact_email.length > 1 ? 's' : ''}</h3>
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
                  <h3 className="text-base font-medium text-muted-foreground mb-1">Overview</h3>
                  <p className="text-sm">{company.overview}</p>
                </div>
              )}

              {company.why_invested && (
                <div>
                  <h3 className="text-base font-medium text-muted-foreground mb-1">Why We Invested</h3>
                  <p className="text-sm">{company.why_invested}</p>
                </div>
              )}

              {company.current_update && (
                <div>
                  <h3 className="text-base font-medium text-muted-foreground mb-1">Current Business Update</h3>
                  <p className="text-sm">{company.current_update}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {showNotes && <CompanyNotesPanel />}
        <AnalystPanel />
      </div>
    </div>
    </CompanyPanelProvider>
  )
}
