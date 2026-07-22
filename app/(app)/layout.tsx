import { redirect } from 'next/navigation'
import Script from 'next/script'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/app-shell'
import { DemoSessionGuard } from '@/components/demo-session-guard'
import {
  getReviewBadge,
  getNotesBadge,
  getPendingRequests,
  getPendingActionsBadge,
  getFundData,
  getFundSettings,
  getMembership,
  getDomainGrants,
  getUpdateAvailable,
} from '@/lib/cache/layout'
import { accessContextFrom } from '@/lib/access/effective'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureVisibilityMap } from '@/lib/types/features'
import { themeCssVars, type FundTheme } from '@/lib/theme'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // Auth — uncached (uses cookies)
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // Get fund ID (uncached — quick single query, needed to key everything else)
  const { data: fund } = await supabase.from('funds').select('id').limit(1).single() as { data: { id: string } | null }
  if (!fund) redirect('/onboarding')

  // All cached queries in parallel
  const [fundData, membership, fundSettings, reviewBadge, notesBadge, domainGrants] = await Promise.all([
    getFundData(fund.id),
    getMembership(user.id, fund.id),
    getFundSettings(fund.id),
    getReviewBadge(fund.id),
    getNotesBadge(user.id),
    getDomainGrants(user.id, fund.id),
  ])

  const isAdmin = membership?.role === 'admin'
  const isViewer = membership?.role === 'viewer'
  const [pendingRequestCount, updateAvailable, pendingActionsBadge] = await Promise.all([
    isAdmin ? getPendingRequests(fund.id) : Promise.resolve(0),
    isAdmin ? getUpdateAvailable() : Promise.resolve(false),
    isAdmin ? getPendingActionsBadge(fund.id) : Promise.resolve(0),
  ])

  const featureVisibility = { ...DEFAULT_FEATURE_VISIBILITY, ...(fundSettings?.feature_visibility as Partial<FeatureVisibilityMap> | null) }
  // The LP portal is a master switch: when off, the LP Portal management page and
  // the nested LP Activity page are unavailable for everyone (the pages also gate
  // themselves server-side). Hiding the nav keys here keeps the sidebar in sync.
  if (!fundSettings?.lp_portal_enabled) {
    featureVisibility.lp_portal = 'hidden'
    featureVisibility.lp_activity = 'hidden'
  }
  // The resolver's INPUTS go to the client, which runs the same effectiveAccess the server does.
  // Not a precomputed answer per domain: that has to pick one feature key per domain, and several
  // span more than one — which made the nav hide pages the user could actually open.
  const { role, features, grants, defaults } = accessContextFrom({
    fundId: fund.id,
    userId: user.id,
    role: membership?.role,
    features: featureVisibility,
    grants: domainGrants.grants,
    defaults: domainGrants.defaults,
  })
  const domainAccess = { role, features, grants, defaults }

  const fundCurrency = fundSettings?.currency ?? 'USD'
  const configuredProviders = [
    fundSettings?.claude_api_key_encrypted ? 'anthropic' : null,
    fundSettings?.openai_api_key_encrypted ? 'openai' : null,
    fundSettings?.ollama_base_url ? 'ollama' : null,
  ].filter(Boolean) as string[]
  const hasAIKey = configuredProviders.length > 0
  const defaultAIProvider = fundSettings?.default_ai_provider ?? 'anthropic'
  const fathomSiteId = fundSettings?.analytics_fathom_site_id ?? null
  const rawGaId = fundSettings?.analytics_ga_measurement_id ?? null
  const gaMeasurementId = rawGaId && /^[A-Z0-9-]+$/i.test(rawGaId) ? rawGaId : null
  const fundName = fundData?.name ?? 'Portfolio Reporting'
  const fundLogo = fundData?.logo_url ?? null
  // Per-fund branding: override CSS variables app-wide. Empty when no theme set.
  const themeVars = themeCssVars((fundSettings?.theme as FundTheme | null) ?? null)

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {themeVars && <style dangerouslySetInnerHTML={{ __html: `:root{${themeVars}}` }} />}
      {isViewer && (
        <>
          <DemoSessionGuard />
          <div className="bg-blue-500 text-white text-center text-xs py-1.5 px-4 shrink-0 flex items-center justify-center gap-3">
            <span>Viewing demo &mdash; read only</span>
            <a href="/api/auth/logout" className="underline underline-offset-2 hover:text-white/80">Exit demo</a>
          </div>
        </>
      )}

      <div className="w-full max-w-screen-xl mx-auto flex flex-col flex-1">
        <AppShell
          lpPortalEnabled={!!fundSettings?.lp_portal_enabled}
          fundName={fundName}
          fundLogo={fundLogo}
          userEmail={user.email ?? ''}
          reviewBadge={reviewBadge}
          settingsBadge={pendingRequestCount}
          notesBadge={notesBadge}
          pendingActionsBadge={pendingActionsBadge}
          isAdmin={isAdmin}
          currency={fundCurrency}
          hasAIKey={hasAIKey}
          configuredProviders={configuredProviders}
          defaultAIProvider={defaultAIProvider}
          updateAvailable={updateAvailable}
          featureVisibility={featureVisibility}
          domainAccess={domainAccess}
        >
          {children}
        </AppShell>
      </div>

      {fathomSiteId && (
        <Script src="https://cdn.usefathom.com/script.js" data-site={fathomSiteId} strategy="afterInteractive" defer />
      )}
      {gaMeasurementId && (
        <>
          <Script src={`https://www.googletagmanager.com/gtag/js?id=${gaMeasurementId}`} strategy="afterInteractive" />
          <Script id="ga-config" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config',${JSON.stringify(gaMeasurementId)});`}</Script>
        </>
      )}
    </div>
  )
}
