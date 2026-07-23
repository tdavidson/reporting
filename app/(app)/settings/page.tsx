'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { DefaultsEditor } from './memo-agent/defaults/editor'
import { LedgerAgentAccess } from '@/components/ledger-agent-access'
import { DefaultMetricsSettings } from '@/components/settings/default-metrics-settings'
import { AppearanceEditor } from './appearance/editor'
import { ProfileSection } from './_sections/account/profile-section'
import { MfaSection } from './_sections/account/mfa-section'
import { NotificationPreferencesSection } from './_sections/account/notification-preferences-section'
import { VersionSection } from './_sections/fund/version-section'
import { CurrencySection } from './_sections/fund/currency-section'
import { FundNameSection } from './_sections/fund/fund-name-section'
import { AuthEmailTemplatesSection } from './_sections/fund/auth-email-templates-section'
import { WhitelistSection } from './_sections/fund/whitelist-section'
import { TeamSection } from './_sections/fund/team-section'
import { DangerZone } from './_sections/fund/danger-zone'
import { AnalyticsSection } from './_sections/fund/analytics-section'
import { UsageTrackingSection } from './_sections/fund/usage-tracking-section'
import { AIProvidersSection } from './_sections/platform/ai-providers-section'
import { InboundEmailSection } from './_sections/platform/inbound-email-section'
import { StorageSection } from './_sections/platform/storage-section'
import { OutboundEmailSection } from './_sections/platform/outbound-email-section'
import { SendersSection } from './_sections/platform/senders-section'
import { AiSummaryPromptSection, AiSummaryPromptReadOnly } from './_sections/products/portfolio/ai-summary-prompt-section'
import { DealScreeningSection } from './_sections/products/investment/deal-screening-section'
import { KnownReferrersSection } from './_sections/products/investment/known-referrers-section'
import { MemoAgentSection } from './_sections/products/investment/memo-agent-section'
import { LpPortalCard } from './_sections/products/lp/lp-portal-card'
import { ProductGroup } from './_sections/products/product-group'
import { isProductActive } from '@/lib/access/products'
import { Unlink, ArrowDownCircle, Eye } from 'lucide-react'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureKey, FeatureVisibility, FeatureVisibilityMap } from '@/lib/types/features'
import { FEATURE_META } from '@/lib/types/feature-meta'
import { AnalystToggleButton } from '@/components/analyst-button'
import { SettingsCard, SettingsCardGrid } from '@/components/settings-card'
import { AnalystPanel } from '@/components/analyst-panel'
import { AffinityConnect } from '@/components/settings/affinity-connect'
import { HeartbeatConnect } from '@/components/settings/heartbeat-connect'
import { DealResearchSettings } from '@/components/settings/deal-research-settings'
import { AdminSectionContext, GroupHeader, Section } from '@/components/settings/section'
import type { SettingsData, Saved } from './_sections/types'

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<SettingsData | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings')
    if (res.ok) setSettings(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) {
    return (
      <div className="p-4 md:p-8">
        <div className="mb-6 space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <AnalystToggleButton />
          </div>
          <p className="text-sm text-muted-foreground">Configure your fund, integrations, and team preferences</p>
        </div>
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-3xl w-full">
          <div className="animate-pulse space-y-4">
            {[1, 2, 3].map(i => <div key={i} className="h-24 bg-muted rounded-lg" />)}
          </div>
        </div>
        <AnalystPanel />
        </div>
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-4 md:p-8">
        <div className="mb-6 space-y-1">
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
            <AnalystToggleButton />
          </div>
          <p className="text-sm text-muted-foreground">Configure your fund, integrations, and team preferences</p>
        </div>
        <div className="flex flex-col lg:flex-row gap-6 items-start">
        <div className="flex-1 min-w-0 max-w-3xl w-full">
          <p className="text-muted-foreground">Could not load settings.</p>
        </div>
        <AnalystPanel />
        </div>
      </div>
    )
  }

  const fv = settings.featureVisibility as unknown as FeatureVisibilityMap

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <AnalystToggleButton />
      </div>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
      <div className="flex-1 min-w-0 max-w-3xl w-full space-y-8">

      <ProfileSection displayName={settings.displayName} onSaved={load} />
      <MfaSection />
      {settings.isAdmin && (
        <AdminSectionContext.Provider value={true}>
          <VersionSection appVersion={settings.appVersion} updateAvailable={settings.updateAvailable} />
          <FundNameSection name={settings.fundName} logo={settings.fundLogo} address={settings.fundAddress} onSaved={load} />
          <Section title="Appearance">
            <AppearanceEditor />
          </Section>
          <CurrencySection currency={settings.currency} onSaved={load} />
          <FeatureVisibilitySection featureVisibility={settings.featureVisibility} lpPortalEnabled={settings.lpPortalEnabled} onSaved={load} />
          {/* Investment-vehicle management moved out of Settings: add/edit (name, type, vintage,
              aliases, active) on /investments; GP linking on /funds/status. */}
        </AdminSectionContext.Provider>
      )}
      {/* Per-USER, not per-fund: the Affinity key is the caller's own personal access
          token and every user needs their own. This section used for all external data integrations. */}
      <GroupHeader label="External Data" />
      <AffinityConnect />
      {/* Heartbeat, unlike Affinity, is a per-FUND credential that reads the whole
          community — so the card is admin-only and renders nothing for everyone else. */}
      <HeartbeatConnect />

      <GroupHeader label="Notes" />
      <NotificationPreferencesSection />
      {/* No longer gated on the accounting feature: the agent surface now covers the
          portfolio, companies, performance and LPs as well as the ledger, so a fund with
          accounting switched off still has most of it. */}
      <GroupHeader label="AI agents" />
      <Section title="Agent access (MCP + REST API keys)">
        <LedgerAgentAccess isAdmin={settings.isAdmin} />
      </Section>
      {!settings.isAdmin && (
        <AiSummaryPromptReadOnly prompt={settings.aiSummaryPrompt} />
      )}
      {settings.isAdmin && (
        <AdminSectionContext.Provider value={true}>
          <GroupHeader label="Inbound Email" />
          <InboundEmailSection
            provider={settings.inboundEmailProvider}
            postmarkAddress={settings.postmarkInboundAddress}
            postmarkToken={settings.postmarkWebhookToken}
            mailgunInboundDomain={settings.mailgunInboundDomain}
            hasMailgunSigningKey={settings.hasMailgunSigningKey}
            onSaved={load}
          />
          <SendersSection senders={settings.senders} onChanged={load} />

          <GroupHeader label="Outbound Email" />
          <OutboundEmailSection
            provider={settings.outboundEmailProvider}
            asksProvider={settings.asksEmailProvider}
            approvalEmailSubject={settings.approvalEmailSubject}
            approvalEmailBody={settings.approvalEmailBody}
            systemEmailFromName={settings.systemEmailFromName}
            systemEmailFromAddress={settings.systemEmailFromAddress}
            hasResendKey={settings.hasResendKey}
            hasPostmarkServerToken={settings.hasPostmarkServerToken}
            hasMailgunApiKey={settings.hasMailgunApiKey}
            mailgunSendingDomain={settings.mailgunSendingDomain}
            googleConnected={settings.googleDriveConnected}
            hasGoogleCredentials={settings.hasGoogleCredentials}
            googleClientId={settings.googleClientId}
            onSaved={load}
          />

          <GroupHeader label="AI" />
          <AIProvidersSection
            hasClaudeKey={settings.hasClaudeKey}
            claudeModel={settings.claudeModel}
            hasOpenAIKey={settings.hasOpenAIKey}
            openaiModel={settings.openaiModel}
            hasOpenRouterKey={settings.hasOpenRouterKey}
            openrouterModel={settings.openrouterModel}
            openrouterBaseUrl={settings.openrouterBaseUrl}
            defaultAIProvider={settings.defaultAIProvider}
            onSaved={load}
          />

          <ProductGroup product="portfolio_reporting" active={isProductActive('portfolio_reporting', fv)}>
            <Section title="Default metrics">
              <DefaultMetricsSettings />
            </Section>
            <AiSummaryPromptSection currentPrompt={settings.aiSummaryPrompt} onSaved={load} />
          </ProductGroup>

          <ProductGroup product="investment_workflow" active={isProductActive('investment_workflow', fv)}>
            <DealScreeningSection
              thesis={settings.dealThesis}
              prompt={settings.dealScreeningPrompt}
              intakeEnabled={settings.dealIntakeEnabled}
              hasSubmissionToken={settings.hasSubmissionToken}
              onSaved={load}
            />
            <DealResearchSettings />
            <KnownReferrersSection />
            <Section title="AI">
              <p className="text-xs text-muted-foreground mb-3">
                AI provider and model for the key deal features: the inbound email classifier, deal screening, and inbound portfolio extraction.
              </p>
              <DefaultsEditor embedded section="features" />
            </Section>
            <MemoAgentSection />
          </ProductGroup>

          <ProductGroup product="lp_reporting" active={isProductActive('lp_reporting', fv)}>
            <Section title="LP Reporting">
              <p className="text-xs text-muted-foreground">
                LP capital accounts, the LP portal, and shared documents are managed via Feature
                visibility above and the LPs area — there are no additional settings here yet.
              </p>
            </Section>
          </ProductGroup>

          <ProductGroup product="fund_operations" active={isProductActive('fund_operations', fv)}>
            <Section title="Fund Operations">
              <p className="text-xs text-muted-foreground mb-3">
                Fund accounting, GP economics and carry, and compliance are configured on the fund
                status page, not here.
              </p>
              <Link href="/funds/status" className="text-xs underline underline-offset-2 hover:text-foreground">
                Go to fund status
              </Link>
            </Section>
          </ProductGroup>

          <GroupHeader label="Storage" />
          <StorageSection
            fundId={settings.fundId}
            fileStorageProvider={settings.fileStorageProvider}
            googleDriveConnected={settings.googleDriveConnected}
            googleDriveFolderId={settings.googleDriveFolderId}
            googleDriveFolderName={settings.googleDriveFolderName}
            hasGoogleCredentials={settings.hasGoogleCredentials}
            googleClientId={settings.googleClientId}
            onChanged={load}
          />
          <GroupHeader label="Analytics" />
          <AnalyticsSection
            fathomSiteId={settings.analyticsFathomSiteId}
            gaMeasurementId={settings.analyticsGaMeasurementId}
            onSaved={load}
          />
          <UsageTrackingSection
            disableUserTracking={settings.disableUserTracking}
            onSaved={load}
          />
          <GroupHeader label="Access Control" />
          <AuthEmailTemplatesSection />
          <WhitelistSection />
          <TeamSection isAdmin={settings.isAdmin} featureVisibility={settings.featureVisibility} />
          <DangerZone onDeleted={() => router.push('/auth')} />
        </AdminSectionContext.Provider>
      )}

    </div>
    <AnalystPanel />
    </div>
    </div>
  )
}

// ──────────────────────────── Profile ────────────────────────────

// ──────────────────────────── Feature Visibility ────────────────────────────


// These four set the fund-level CEILING, not the answer: a member also needs the matching per-user
// grant (Team, below). "Members" therefore means "each member reaches it subject to their grant" —
// hence labels that name the grant rather than promising blanket visibility.
//
// "Hidden" used to read "Removed from sidebar, still accessible via URL". That was accurate and it
// was the bug: hiding a page while its API still served the data is not access control. Hidden now
// denies every surface.
const VISIBILITY_OPTIONS: { value: FeatureVisibility; label: string; description: string }[] = [
  { value: 'everyone', label: 'Members', description: 'On — each member gets what you grant them below' },
  { value: 'admin', label: 'Admins only', description: 'On — no member can be granted it' },
  { value: 'off', label: 'Off', description: 'Nobody, admins included. Data is kept.' },
]

/** Stored `hidden` is the same as `off` now — show it as Off rather than a fourth button. */
const displayLevel = (level: FeatureVisibility): FeatureVisibility => (level === 'hidden' ? 'off' : level)

function FeatureVisibilitySection({
  featureVisibility,
  lpPortalEnabled,
  onSaved,
}: {
  featureVisibility: Record<string, string>
  lpPortalEnabled: boolean
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>(featureVisibility)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleChange = async (key: FeatureKey, level: FeatureVisibility) => {
    const next = { ...values, [key]: level }
    setValues(next)
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featureVisibility: next }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  const features = Object.keys(DEFAULT_FEATURE_VISIBILITY) as FeatureKey[]

  return (
    <Section title="Feature visibility">
      <p className="text-xs text-muted-foreground mb-4">
        Whether each area is on for the fund, and the most anyone may have. This is only half the
        answer for a member — set what each person gets under Team → Access below. Off denies
        everyone, admins included.
      </p>

      {/* The one switch here that isn't about your team. It decides whether your INVESTORS have a
          portal at all — and the two LP cards below only mean anything while it's on, which is why
          it sits with them rather than in a section of its own further down the page. */}
      <div className="mb-3">
        <LpPortalCard enabled={lpPortalEnabled} onSaved={onSaved} />
      </div>

      <SettingsCardGrid>
        {features.map(key => {
          const current = displayLevel((values[key] ?? DEFAULT_FEATURE_VISIBILITY[key]) as FeatureVisibility)
          const meta = FEATURE_META[key]
          return (
            <SettingsCard
              key={key}
              title={meta.label}
              subtitle={
                <>
                  {meta.description}{' '}
                  <Link href={meta.href} className="underline underline-offset-2 hover:text-foreground">Learn more</Link>
                </>
              }
            >
              {/* One button per level rather than a select: there are only three, and which one is
                  active is the thing you scan a long list for. */}
              <div className="flex flex-wrap gap-1.5">
                {VISIBILITY_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => handleChange(key, opt.value)}
                    title={opt.description}
                    className={`px-3 py-1.5 text-xs rounded-md border transition-colors ${
                      current === opt.value
                        ? 'border-foreground/30 bg-accent font-medium'
                        : 'hover:bg-accent/30'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </SettingsCard>
          )
        })}
      </SettingsCardGrid>
      {saving && <p className="text-xs text-muted-foreground mt-3">Saving...</p>}
      {saved && <p className="text-xs text-green-600 mt-3">Saved</p>}
    </Section>
  )
}

// ──────────────────────────── Notification Preferences ────────────────────────────

// ──────────────────────────── Claude Key ────────────────────────────

// ──────────────────────────── AI Providers ────────────────────────────

// ──────────────────────────── Inbound Email ────────────────────────────

// ──────────────────────────── Google Connection (shared) ────────────────────────────

// ──────────────────────────── Storage ────────────────────────────

// ──────────────────────────── Outbound Email ────────────────────────────

// ──────────────────────────── Senders ────────────────────────────

// ──────────────────────────── Shared ────────────────────────────
//
// GroupHeader / Section / AdminSectionContext now live in components/settings/section.tsx,
// so the settings cards that live in their own files can render with the same admin chrome
// instead of a bare <Card>. They are imported at the top of this file.
