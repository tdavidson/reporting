'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import Link from 'next/link'
import { DefaultsEditor } from './memo-agent/defaults/editor'
import { LedgerAgentAccess } from '@/components/ledger-agent-access'
import { DefaultMetricsSettings } from '@/components/settings/default-metrics-settings'
import { StyleAnchorsInline } from './memo-agent/style-anchors/style-anchors-inline'
import { SchemasInline } from './memo-agent/schemas/schemas-inline'
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
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2, Copy, FolderOpen, Unlink, X, ArrowDownCircle, Eye } from 'lucide-react'
import { DEFAULT_FEATURE_VISIBILITY } from '@/lib/types/features'
import type { FeatureKey, FeatureVisibility } from '@/lib/types/features'
import { FEATURE_META } from '@/lib/types/feature-meta'
import { AnalystToggleButton } from '@/components/analyst-button'
import { SettingsCard, SettingsCardGrid } from '@/components/settings-card'
import { AnalystPanel } from '@/components/analyst-panel'
import { AffinityConnect } from '@/components/settings/affinity-connect'
import { HeartbeatConnect } from '@/components/settings/heartbeat-connect'
import { DealResearchSettings } from '@/components/settings/deal-research-settings'
import { AdminSectionContext, GroupHeader, Section } from '@/components/settings/section'
import type { SettingsData, Saved, Sender } from './_sections/types'

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
          <Section title="Default metrics">
            <DefaultMetricsSettings />
          </Section>
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
          <AiSummaryPromptSection currentPrompt={settings.aiSummaryPrompt} onSaved={load} />

          <GroupHeader label="Deals" />
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

          <GroupHeader label="Diligence" />
          <MemoAgentSection />

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

function AIProvidersSection({
  hasClaudeKey, claudeModel, hasOpenAIKey, openaiModel, hasOpenRouterKey, openrouterModel, openrouterBaseUrl, defaultAIProvider, onSaved,
}: {
  hasClaudeKey: boolean
  claudeModel: string
  hasOpenAIKey: boolean
  openaiModel: string
  hasOpenRouterKey: boolean
  openrouterModel: string
  openrouterBaseUrl: string
  defaultAIProvider: string
  onSaved: () => void
}) {
  const [defaultProvider, setDefaultProvider] = useState(defaultAIProvider)
  const [savingDefault, setSavingDefault] = useState(false)
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set([defaultAIProvider]))

  useEffect(() => { setDefaultProvider(defaultAIProvider) }, [defaultAIProvider])

  const saveDefaultProvider = async (value: string) => {
    setDefaultProvider(value)
    setSavingDefault(true)
    // Open the newly selected provider section
    setOpenSections(prev => new Set(prev).add(value))
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAIProvider: value }),
    })
    setSavingDefault(false)
    if (res.ok) onSaved()
  }

  const toggleSection = (key: string) => {
    setOpenSections(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <Section title="AI Providers">
      <p className="text-xs text-muted-foreground mb-3">
        Choose which AI provider to use by default for report parsing, summaries, and imports.
        Configure at least one provider below.
      </p>
      <div className="flex items-center gap-2 mb-4">
        <Label className="text-xs text-muted-foreground shrink-0">Default provider</Label>
        <select
          className="flex h-9 w-full max-w-xs rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={defaultProvider}
          onChange={(e) => saveDefaultProvider(e.target.value)}
          disabled={savingDefault}
        >
          <option value="anthropic" disabled={!hasClaudeKey}>
            Anthropic (Claude){!hasClaudeKey ? ', no key configured' : ''}
          </option>
          <option value="openai" disabled={!hasOpenAIKey}>
            OpenAI{!hasOpenAIKey ? ', no key configured' : ''}
          </option>
          <option value="openrouter" disabled={!hasOpenRouterKey}>
            OpenRouter{!hasOpenRouterKey ? ', no key configured' : ''}
          </option>
        </select>
        {savingDefault && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
      </div>

      <div className="space-y-0 border rounded-lg overflow-hidden">
        <AIProviderDisclosure
          label="Anthropic (Claude)"
          providerKey="anthropic"
          isDefault={defaultProvider === 'anthropic'}
          isOpen={openSections.has('anthropic')}
          onToggle={() => toggleSection('anthropic')}
          hasKey={hasClaudeKey}
        >
          <ClaudeKeyContent hasKey={hasClaudeKey} currentModel={claudeModel} onSaved={onSaved} />
        </AIProviderDisclosure>
        <AIProviderDisclosure
          label="OpenAI"
          providerKey="openai"
          isDefault={defaultProvider === 'openai'}
          isOpen={openSections.has('openai')}
          onToggle={() => toggleSection('openai')}
          hasKey={hasOpenAIKey}
        >
          <OpenAIKeyContent hasKey={hasOpenAIKey} currentModel={openaiModel} onSaved={onSaved} />
        </AIProviderDisclosure>
        <AIProviderDisclosure
          label="OpenRouter"
          providerKey="openrouter"
          isDefault={defaultProvider === 'openrouter'}
          isOpen={openSections.has('openrouter')}
          onToggle={() => toggleSection('openrouter')}
          hasKey={hasOpenRouterKey}
        >
          <OpenRouterContent hasKey={hasOpenRouterKey} currentModel={openrouterModel} currentBaseUrl={openrouterBaseUrl} onSaved={onSaved} />
        </AIProviderDisclosure>
      </div>
    </Section>
  )
}

function OpenRouterContent({ hasKey, currentModel, currentBaseUrl, onSaved }: { hasKey: boolean; currentModel: string; currentBaseUrl: string; onSaved: () => void }) {
  const [key, setKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(currentBaseUrl || 'https://openrouter.ai/api/v1')
  const [model, setModel] = useState(currentModel || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true); setError(null)
    try {
      const body: Record<string, string> = { openrouterBaseUrl: baseUrl, openrouterModel: model }
      if (key.trim()) body.openrouterApiKey = key.trim()
      const res = await fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(b.error ?? 'Save failed') }
      setKey(''); setSaved(true); setTimeout(() => setSaved(false), 2000); onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Connect OpenRouter (or any OpenAI-compatible endpoint) to use inexpensive open models — DeepSeek, GLM, Qwen, Llama. Create a key at openrouter.ai.
      </p>
      <div>
        <Label className="text-xs">API key {hasKey && <span className="text-muted-foreground">(saved — leave blank to keep)</span>}</Label>
        <Input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={hasKey ? '••••••••' : 'sk-or-...'} className="h-9" />
      </div>
      <div>
        <Label className="text-xs">Base URL</Label>
        <Input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" className="h-9 font-mono text-xs" />
      </div>
      <div>
        <Label className="text-xs">Model</Label>
        <Input value={model} onChange={e => setModel(e.target.value)} placeholder="e.g. deepseek/deepseek-chat or z-ai/glm-4.6" className="h-9 font-mono text-xs" />
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <Button size="sm" onClick={save} disabled={saving}>
        {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5 mr-1" /> : null}
        Save
      </Button>
    </div>
  )
}

function AIProviderDisclosure({ label, providerKey, isDefault, isOpen, onToggle, hasKey, children }: {
  label: string
  providerKey: string
  isDefault: boolean
  isOpen: boolean
  onToggle: () => void
  hasKey: boolean
  children: React.ReactNode
}) {
  return (
    <div className="border-b last:border-b-0">
      <button
        onClick={onToggle}
        className="flex items-center gap-2 w-full px-4 py-3 text-sm font-medium hover:bg-muted/50 transition-colors text-left"
      >
        {isOpen ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
        <span className="flex-1">{label}</span>
        {isDefault && (
          <span className="text-[9px] font-medium text-emerald-600 bg-emerald-500/10 rounded px-1.5 py-0.5 leading-none uppercase tracking-wider">default</span>
        )}
        {hasKey ? (
          <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
        ) : (
          <span className="text-[10px] text-muted-foreground">Not configured</span>
        )}
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  )
}

function ClaudeKeyContent({ hasKey, currentModel, onSaved }: { hasKey: boolean; currentModel: string; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')

  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(currentModel)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelsFetched, setModelsFetched] = useState(false)

  const fetchModels = useCallback(async () => {
    if (modelsFetched) return
    setModelsLoading(true)
    setModelsError(null)
    try {
      const res = await fetch('/api/claude-models')
      const data = await res.json()
      if (data.error) setModelsError(data.error)
      setModels(data.models ?? [])
      setModelsFetched(true)
    } catch {
      setModelsError('Failed to fetch models')
    } finally {
      setModelsLoading(false)
    }
  }, [modelsFetched])

  useEffect(() => {
    if (hasKey) fetchModels()
  }, [hasKey, fetchModels])

  useEffect(() => { setSelectedModel(currentModel) }, [currentModel])

  const testKey = async () => {
    setTesting(true)
    setStatus('idle')
    const res = await fetch('/api/test-claude-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey }),
    })
    setTesting(false)
    setStatus(res.ok ? 'valid' : 'invalid')
  }

  const saveKey = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeApiKey: newKey }),
    })
    setSaving(false)
    if (res.ok) {
      setStatus('saved')
      setNewKey('')
      setModelsFetched(false)
      onSaved()
    }
  }

  const saveModel = async (modelId: string) => {
    setSelectedModel(modelId)
    setModelSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ claudeModel: modelId }),
    })
    setModelSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <>
      <p className="text-xs text-muted-foreground mb-3">
        {hasKey
          ? 'A Claude API key is configured. Enter a new key below to replace it.'
          : 'No Claude API key configured. Add one to enable report parsing.'}
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>API key</Label>
          <Input
            type="password"
            value={newKey}
            onChange={(e) => { setNewKey(e.target.value); setStatus('idle') }}
            placeholder="sk-ant-..."
          />
        </div>
        <div className="flex gap-2">
          <Button onClick={testKey} disabled={!newKey.trim() || testing} variant="outline" size="sm">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
          </Button>
          <Button onClick={saveKey} disabled={!newKey.trim() || saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
          </Button>
        </div>
      </div>
      {status === 'valid' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key is valid</p>}
      {status === 'invalid' && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Key is invalid</p>}
      {status === 'saved' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key updated</p>}

      {hasKey && (
        <div className="mt-4 pt-4 border-t">
          <Label>Model</Label>
          <p className="text-xs text-muted-foreground mb-2">Choose which Claude model to use.</p>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models…</div>
          ) : modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : (
            <div className="flex items-center gap-2">
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={selectedModel} onChange={(e) => saveModel(e.target.value)} disabled={modelSaving}>
                {models.length === 0 && <option value={selectedModel}>{selectedModel}</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.id})</option>)}
              </select>
              {modelSaving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            </div>
          )}
        </div>
      )}
    </>
  )
}

function OpenAIKeyContent({ hasKey, currentModel, onSaved }: { hasKey: boolean; currentModel: string; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')

  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(currentModel)
  const [modelSaving, setModelSaving] = useState(false)
  const [modelsFetched, setModelsFetched] = useState(false)

  const fetchModels = useCallback(async () => {
    if (modelsFetched) return
    setModelsLoading(true)
    setModelsError(null)
    try {
      const res = await fetch('/api/openai-models')
      const data = await res.json()
      if (data.error) setModelsError(data.error)
      setModels(data.models ?? [])
      setModelsFetched(true)
    } catch {
      setModelsError('Failed to fetch models')
    } finally {
      setModelsLoading(false)
    }
  }, [modelsFetched])

  useEffect(() => { if (hasKey) fetchModels() }, [hasKey, fetchModels])
  useEffect(() => { setSelectedModel(currentModel) }, [currentModel])

  const testKey = async () => {
    setTesting(true)
    setStatus('idle')
    const res = await fetch('/api/test-openai-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey }),
    })
    setTesting(false)
    setStatus(res.ok ? 'valid' : 'invalid')
  }

  const saveKey = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openaiApiKey: newKey }),
    })
    setSaving(false)
    if (res.ok) {
      setStatus('saved')
      setNewKey('')
      setModelsFetched(false)
      onSaved()
    }
  }

  const saveModel = async (modelId: string) => {
    setSelectedModel(modelId)
    setModelSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ openaiModel: modelId }),
    })
    setModelSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <>
      <p className="text-xs text-muted-foreground mb-3">
        {hasKey
          ? 'An OpenAI API key is configured. Enter a new key below to replace it.'
          : 'No OpenAI API key configured. Add one to enable OpenAI as an AI provider.'}
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>API key</Label>
          <Input type="password" value={newKey} onChange={(e) => { setNewKey(e.target.value); setStatus('idle') }} placeholder="sk-..." />
        </div>
        <div className="flex gap-2">
          <Button onClick={testKey} disabled={!newKey.trim() || testing} variant="outline" size="sm">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
          </Button>
          <Button onClick={saveKey} disabled={!newKey.trim() || saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Update'}
          </Button>
        </div>
      </div>
      {status === 'valid' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key is valid</p>}
      {status === 'invalid' && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> Key is invalid</p>}
      {status === 'saved' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key updated</p>}

      {hasKey && (
        <div className="mt-4 pt-4 border-t">
          <Label>Model</Label>
          <p className="text-xs text-muted-foreground mb-2">Choose which OpenAI model to use.</p>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models…</div>
          ) : modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : (
            <div className="flex items-center gap-2">
              <select className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" value={selectedModel} onChange={(e) => saveModel(e.target.value)} disabled={modelSaving}>
                {models.length === 0 && <option value={selectedModel}>{selectedModel}</option>}
                {models.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
              {modelSaving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            </div>
          )}
        </div>
      )}
    </>
  )
}

// ──────────────────────────── AI Summary Prompt ────────────────────────────

const DEFAULT_AI_SUMMARY_PROMPT = `Write a concise analyst summary covering:

1. **Current Status**, How is the company performing right now? Reference specific numbers.
2. **Trends**, What direction are the key metrics heading? Growth rates, acceleration or deceleration.
3. **Progress & Positives**, What's going well? Milestones, improvements, or strong execution.
4. **Challenges & Risks**, What concerns you? Declining metrics, missing data, red flags.
5. **Key Follow-ups**, What should the investment team ask about or monitor next?

Keep it to 2-4 short paragraphs. Be direct and analytical, not promotional. Use specific numbers. Do not use markdown formatting, write in plain prose paragraphs.`

function AiSummaryPromptSection({ currentPrompt, onSaved }: { currentPrompt: string | null; onSaved: () => void }) {
  const [value, setValue] = useState(currentPrompt ?? DEFAULT_AI_SUMMARY_PROMPT)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const isCustomized = currentPrompt !== null

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiSummaryPrompt: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  const handleReset = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aiSummaryPrompt: null }),
    })
    setSaving(false)
    if (res.ok) {
      setValue(DEFAULT_AI_SUMMARY_PROMPT)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="AI summary prompt">
      <p className="text-xs text-muted-foreground mb-3">
        Customize the analysis instructions for AI company summaries. Company data and metrics are provided automatically.
      </p>
      <textarea
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-mono leading-relaxed"
        rows={12}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <div className="flex items-center gap-2 mt-3">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
        {isCustomized && (
          <Button onClick={handleReset} disabled={saving} variant="outline" size="sm">
            Reset to default
          </Button>
        )}
      </div>
    </Section>
  )
}

function AiSummaryPromptReadOnly({ prompt }: { prompt: string | null }) {
  return (
    <Section title="AI summary prompt">
      <p className="text-xs text-muted-foreground mb-3">
        The analysis instructions used for AI company summaries. Contact an admin to change this.
      </p>
      <pre className="whitespace-pre-wrap text-sm bg-muted rounded-md px-3 py-2 font-mono leading-relaxed">
        {prompt || DEFAULT_AI_SUMMARY_PROMPT}
      </pre>
    </Section>
  )
}

// ──────────────────────────── Inbound Email ────────────────────────────

function InboundEmailSection({
  provider,
  postmarkAddress,
  postmarkToken,
  mailgunInboundDomain,
  hasMailgunSigningKey,
  onSaved,
}: {
  provider: string | null
  postmarkAddress: string
  postmarkToken: string
  mailgunInboundDomain: string
  hasMailgunSigningKey: boolean
  onSaved: () => void
}) {
  const [selectedProvider, setSelectedProvider] = useState(provider || '')
  const [addr, setAddr] = useState(postmarkAddress)
  const [mgDomain, setMgDomain] = useState(mailgunInboundDomain)
  const [mgSigningKey, setMgSigningKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const defaultBase = typeof window !== 'undefined' ? window.location.origin : ''
  const [baseUrl, setBaseUrl] = useState(defaultBase)

  const postmarkWebhookUrl = `${baseUrl}/api/inbound-email?token=${postmarkToken}`
  const mailgunWebhookUrl = `${baseUrl}/api/inbound-email/mailgun`

  const handleSave = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = {
      inboundEmailProvider: selectedProvider || null,
    }
    if (selectedProvider === 'postmark') {
      payload.postmarkInboundAddress = addr?.trim() || null
    }
    if (selectedProvider === 'mailgun') {
      payload.mailgunInboundDomain = mgDomain?.trim() || null
      if (mgSigningKey.trim()) {
        payload.mailgunSigningKey = mgSigningKey.trim()
      }
    }
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setMgSigningKey('')
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const providerChanged = selectedProvider !== (provider || '')
  const hasNewData =
    (selectedProvider === 'postmark' && addr !== postmarkAddress) ||
    (selectedProvider === 'mailgun' && (mgDomain !== mailgunInboundDomain || mgSigningKey.trim()))
  const canSave = providerChanged || hasNewData

  return (
    <Section title="Inbound email">
      <p className="text-xs text-muted-foreground mb-3">
        Choose how portfolio companies send reports to your fund.
      </p>
      <div className="space-y-3">
        <div>
          <Label>Provider</Label>
          <select
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={selectedProvider}
            onChange={(e) => setSelectedProvider(e.target.value)}
          >
            <option value="">None (disabled)</option>
            <option value="postmark">Postmark</option>
            <option value="mailgun">Mailgun</option>
          </select>
        </div>

        {selectedProvider === 'postmark' && (
          <>
            <div>
              <Label>Postmark inbound address</Label>
              <Input
                value={addr}
                onChange={(e) => setAddr(e.target.value)}
                placeholder="abc123@inbound.postmarkapp.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                Set this in the Postmark dashboard under Inbound. Portfolio companies forward their reports to this address, and Postmark delivers them to your webhook.
              </p>
            </div>
            {postmarkToken && (
              <div>
                <Label>Webhook URL</Label>
                <div className="flex items-center gap-2">
                  <div className="flex flex-1 items-center rounded-md border border-input shadow-sm overflow-hidden">
                    <input
                      className="h-9 w-40 shrink-0 bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      placeholder="https://your-app.vercel.app"
                    />
                    <span className="text-xs text-muted-foreground bg-muted px-2 py-2 border-l whitespace-nowrap">/api/inbound-email?token={postmarkToken}</span>
                  </div>
                  <Button onClick={() => copyUrl(postmarkWebhookUrl)} variant="outline" size="icon" className="shrink-0 h-9 w-9">
                    {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Paste this into Postmark&#39;s inbound webhook settings. Edit the base URL for local development (e.g. ngrok).
                </p>
              </div>
            )}
          </>
        )}

        {selectedProvider === 'mailgun' && (
          <>
            <div>
              <Label>Mailgun inbound domain</Label>
              <Input
                value={mgDomain}
                onChange={(e) => setMgDomain(e.target.value)}
                placeholder="mg.yourdomain.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The domain configured for inbound routing in Mailgun.
              </p>
            </div>
            <div>
              <Label>Webhook signing key</Label>
              {hasMailgunSigningKey && (
                <p className="text-xs text-muted-foreground mt-1 mb-1.5">
                  A signing key is saved. Enter a new one to replace it.
                </p>
              )}
              <Input
                type="password"
                value={mgSigningKey}
                onChange={(e) => setMgSigningKey(e.target.value)}
                placeholder={hasMailgunSigningKey ? '••••••••' : 'Mailgun webhook signing key'}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Found in Mailgun dashboard under Sending &gt; Webhooks.
              </p>
            </div>
            <div>
              <Label>Webhook URL</Label>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded-md border border-input shadow-sm overflow-hidden">
                  <input
                    className="h-9 w-40 shrink-0 bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://your-app.vercel.app"
                  />
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-2 border-l whitespace-nowrap">/api/inbound-email/mailgun</span>
                </div>
                <Button onClick={() => copyUrl(mailgunWebhookUrl)} variant="outline" size="icon" className="shrink-0 h-9 w-9">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                In Mailgun, go to Receiving &gt; Create Route and forward matching emails to this URL. Edit the base URL for local development (e.g. ngrok).
              </p>
            </div>
          </>
        )}

        <Button onClick={handleSave} disabled={saving || !canSave} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── Google Connection (shared) ────────────────────────────

function GoogleSetupGuide({ show, onToggle }: { show: boolean; onToggle: () => void }) {
  if (!show) {
    return (
      <button onClick={onToggle} className="text-xs text-muted-foreground hover:text-foreground underline">
        Setup guide
      </button>
    )
  }
  return (
    <div className="space-y-1.5">
      <button onClick={onToggle} className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
        <ChevronDown className="h-3 w-3" /> Setup guide
      </button>
      <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal list-inside">
        <li>Go to{' '}
          <a href="https://console.cloud.google.com" target="_blank" rel="noopener noreferrer" className="underline">Google Cloud Console</a>
        </li>
        <li><a href="https://console.cloud.google.com/projectcreate" target="_blank" rel="noopener noreferrer" className="underline">Create a project</a> (or select an existing one)</li>
        <li>Configure the{' '}
          <a href="https://console.cloud.google.com/apis/credentials/consent" target="_blank" rel="noopener noreferrer" className="underline">OAuth consent screen</a>
          <ul className="list-disc list-inside ml-3 mt-0.5 space-y-0.5">
            <li>Set User type to <strong>Internal</strong> (avoids 7-day token expiry)</li>
            <li>App name & support email, fill in anything</li>
            <li>Scopes: add <code className="text-[11px] bg-muted px-1 rounded">drive.file</code> and <code className="text-[11px] bg-muted px-1 rounded">gmail.send</code></li>
          </ul>
        </li>
        <li>Enable APIs:{' '}
          <a href="https://console.cloud.google.com/apis/library/drive.googleapis.com" target="_blank" rel="noopener noreferrer" className="underline">Google Drive API</a>,{' '}
          <a href="https://console.cloud.google.com/apis/library/gmail.googleapis.com" target="_blank" rel="noopener noreferrer" className="underline">Gmail API</a>
        </li>
        <li><a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="underline">Create OAuth credentials</a>
          <ul className="list-disc list-inside ml-3 mt-0.5 space-y-0.5">
            <li>Type: <strong>Web application</strong></li>
            <li>Authorized redirect URI: <code className="text-[11px] bg-muted px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/google/callback</code></li>
          </ul>
        </li>
        <li>Copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the fields above</li>
      </ol>
    </div>
  )
}

function GoogleCredentialsForm({
  clientId,
  onSave,
  onCancel,
  saving,
}: {
  clientId: string
  onSave: (clientId: string, clientSecret: string) => void
  onCancel?: () => void
  saving: boolean
}) {
  const [newClientId, setNewClientId] = useState(clientId)
  const [newClientSecret, setNewClientSecret] = useState('')
  const [showSetupGuide, setShowSetupGuide] = useState(!clientId)

  useEffect(() => { setNewClientId(clientId) }, [clientId])

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">Google OAuth credentials</p>
      <div>
        <Label>Client ID</Label>
        <Input
          value={newClientId}
          onChange={(e) => setNewClientId(e.target.value)}
          placeholder="123456789.apps.googleusercontent.com"
        />
      </div>
      <div>
        <Label>Client secret</Label>
        <Input
          type="password"
          value={newClientSecret}
          onChange={(e) => setNewClientSecret(e.target.value)}
          placeholder="GOCSPX-..."
        />
      </div>
      <GoogleSetupGuide show={showSetupGuide} onToggle={() => setShowSetupGuide(!showSetupGuide)} />
      <div className="flex gap-2">
        <Button size="sm" onClick={() => onSave(newClientId, newClientSecret)} disabled={saving || !newClientId.trim() || !newClientSecret.trim()}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save credentials'}
        </Button>
        {onCancel && (
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </div>
  )
}

function GoogleConnectionUI({
  connected,
  hasCredentials,
  clientId: existingClientId,
  onChanged,
}: {
  connected: boolean
  hasCredentials: boolean
  clientId: string
  onChanged: () => void
}) {
  const [editingCreds, setEditingCreds] = useState(!hasCredentials)
  const [savingCreds, setSavingCreds] = useState(false)
  const [credsSaved, setCredsSaved] = useState(false)
  const [removingCreds, setRemovingCreds] = useState(false)

  useEffect(() => { if (hasCredentials && editingCreds && credsSaved) setEditingCreds(false) }, [hasCredentials, editingCreds, credsSaved])

  const saveCredentials = async (clientId: string, clientSecret: string) => {
    setSavingCreds(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleClientId: clientId.trim(),
        googleClientSecret: clientSecret.trim(),
      }),
    })
    setSavingCreds(false)
    if (res.ok) {
      setEditingCreds(false)
      setCredsSaved(true)
      setTimeout(() => setCredsSaved(false), 2000)
      onChanged()
    }
  }

  const removeCredentials = async () => {
    if (!confirm('Remove Google OAuth credentials? This will also disconnect your Google account.')) return
    setRemovingCreds(true)
    // Clear credentials and disconnect
    await Promise.all([
      fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ googleClientId: '', googleClientSecret: '' }),
      }),
      fetch('/api/settings/drive', { method: 'DELETE' }),
    ])
    setRemovingCreds(false)
    setEditingCreds(true)
    onChanged()
  }

  if (connected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-600 shrink-0" />
          <span>Google account connected.</span>
        </div>
        {editingCreds ? (
          <GoogleCredentialsForm
            clientId={existingClientId}
            onSave={saveCredentials}
            onCancel={() => setEditingCreds(false)}
            saving={savingCreds}
          />
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1">
              Google credentials configured.
              {credsSaved && <span className="text-emerald-600 ml-1">Saved!</span>}
            </p>
            <Button size="sm" variant="outline" onClick={() => setEditingCreds(true)} className="text-xs h-7">
              Update credentials
            </Button>
            <Button size="sm" variant="outline" onClick={() => { window.location.href = '/api/auth/google' }} className="text-xs h-7">
              Reconnect
            </Button>
            <Button size="sm" variant="outline" onClick={removeCredentials} disabled={removingCreds} className="text-xs h-7 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30">
              {removingCreds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Remove'}
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {editingCreds || !hasCredentials ? (
        <GoogleCredentialsForm
          clientId={existingClientId}
          onSave={saveCredentials}
          onCancel={hasCredentials ? () => setEditingCreds(false) : undefined}
          saving={savingCreds}
        />
      ) : (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground flex-1">
            Google credentials configured.
            {credsSaved && <span className="text-emerald-600 ml-1">Saved!</span>}
          </p>
          <Button size="sm" variant="outline" onClick={() => setEditingCreds(true)} className="text-xs h-7">
            Update credentials
          </Button>
          <Button size="sm" variant="outline" onClick={removeCredentials} disabled={removingCreds} className="text-xs h-7 text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30">
            {removingCreds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Remove'}
          </Button>
        </div>
      )}
      {hasCredentials && (
        <Button size="sm" onClick={() => { window.location.href = '/api/auth/google' }}>
          Connect Google account
        </Button>
      )}
    </div>
  )
}

// ──────────────────────────── Google Drive ────────────────────────────

function GoogleDriveSection({
  fundId,
  connected,
  folderId,
  folderName,
  hasCredentials,
  onChanged,
}: {
  fundId: string
  connected: boolean
  folderId: string | null
  folderName: string | null
  hasCredentials: boolean
  onChanged: () => void
}) {
  const [folderError, setFolderError] = useState<string | null>(null)
  const [showPicker, setShowPicker] = useState(false)
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string; shared?: boolean }[]>([{ id: null, name: 'My Drive' }])
  const [saving, setSaving] = useState(false)
  const [browseMode, setBrowseMode] = useState<'my' | 'shared'>('my')
  const [urlInput, setUrlInput] = useState('')

  // Resolve a pasted Drive folder URL directly to the saved folder — skips the
  // browser entirely, which matters for deeply-nested or shared-drive folders
  // ("Shared with me" lists every shared folder flat, unusable on a big drive).
  const selectByUrl = async () => {
    if (!urlInput.trim()) return
    setSaving(true)
    setFolderError(null)
    const res = await fetch('/api/settings/drive/folders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput.trim() }),
    })
    if (!res.ok) {
      setSaving(false)
      const data = await res.json().catch(() => ({}))
      setFolderError(data.error || 'Failed to use folder')
      return
    }
    const { folderId, folderName } = await res.json()
    setUrlInput('')
    await selectFolder({ id: folderId, name: folderName })
  }

  const loadFolders = async (parentId?: string, shared?: boolean) => {
    setLoadingFolders(true)
    setFolderError(null)
    try {
      let url = '/api/settings/drive/folders'
      if (shared) {
        url += '?shared=true'
      } else if (parentId) {
        url += `?parent=${parentId}`
      }
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFolderError(data.error || 'Failed to list folders')
        return
      }
      const data = await res.json()
      setFolders(data.folders ?? [])
    } catch {
      setFolderError('Failed to list folders')
    } finally {
      setLoadingFolders(false)
    }
  }

  const openPicker = () => {
    setShowPicker(true)
    setBrowseMode('my')
    setUrlInput('')
    setBreadcrumbs([{ id: null, name: 'My Drive' }])
    loadFolders()
  }

  const switchToShared = () => {
    setBrowseMode('shared')
    setBreadcrumbs([{ id: null, name: 'Shared with me', shared: true }])
    loadFolders(undefined, true)
  }

  const switchToMyDrive = () => {
    setBrowseMode('my')
    setBreadcrumbs([{ id: null, name: 'My Drive' }])
    loadFolders()
  }

  const navigateInto = (folder: { id: string; name: string }) => {
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }])
    loadFolders(folder.id)
  }

  const navigateToBreadcrumb = (index: number) => {
    const crumb = breadcrumbs[index]
    setBreadcrumbs(prev => prev.slice(0, index + 1))
    if (crumb.shared) {
      loadFolders(undefined, true)
    } else {
      loadFolders(crumb.id ?? undefined)
    }
  }

  const selectFolder = async (folder: { id: string; name: string }) => {
    setSaving(true)
    setFolderError(null)
    const res = await fetch('/api/settings/drive', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folder.id, folder_name: folder.name }),
    })
    setSaving(false)
    if (res.ok) {
      setShowPicker(false)
      onChanged()
    } else {
      const data = await res.json().catch(() => ({}))
      setFolderError(data.error || 'Failed to select folder')
    }
  }

  const selectCurrentFolder = async () => {
    const current = breadcrumbs[breadcrumbs.length - 1]
    if (!current.id) {
      // Root — use 'root' as the ID
      setSaving(true)
      setFolderError(null)
      const res = await fetch('/api/settings/drive', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_id: 'root', folder_name: 'My Drive' }),
      })
      setSaving(false)
      if (res.ok) { setShowPicker(false); onChanged() }
      else {
        const data = await res.json().catch(() => ({}))
        setFolderError(data.error || 'Failed to select folder')
      }
    } else {
      await selectFolder({ id: current.id, name: current.name })
    }
  }

  if (!connected) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium">Google Drive</p>
        <p className="text-xs text-muted-foreground">
          {hasCredentials
            ? 'Google credentials are configured. Connect your Google account to enable Drive storage.'
            : 'Set up your Google OAuth credentials in the Google section in Email settings, then connect your account to enable Drive storage.'}
        </p>
        {hasCredentials && (
          <Button size="sm" onClick={() => { window.location.href = '/api/auth/google' }}>
            Connect Google account
          </Button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">Google Drive</p>
      <p className="text-xs text-muted-foreground">
        Google Drive is connected. Attachments from processed emails will be saved automatically.
      </p>

      {folderName ? (
        <div className="flex items-center gap-2 text-sm">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>Saving to: <span className="font-medium">{folderName}</span></span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No folder selected. Pick a folder to start saving reports.
        </p>
      )}

      {showPicker ? (
        <div className="border rounded-lg p-3 space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">Paste a Google Drive folder URL</label>
            <div className="flex gap-2">
              <Input
                value={urlInput}
                onChange={e => setUrlInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); selectByUrl() } }}
                placeholder="https://drive.google.com/drive/folders/..."
                className="h-8 text-sm"
                disabled={saving}
              />
              <Button size="sm" onClick={selectByUrl} disabled={saving || !urlInput.trim()}>
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Use'}
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-border" />
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">or browse</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={switchToMyDrive}
              className={`px-2 py-1 rounded ${browseMode === 'my' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              My Drive
            </button>
            <button
              onClick={switchToShared}
              className={`px-2 py-1 rounded ${browseMode === 'shared' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              Shared with me
            </button>
          </div>

          <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                <button
                  onClick={() => navigateToBreadcrumb(i)}
                  className={`hover:text-foreground ${i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : ''}`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </div>

          <div className="border rounded max-h-48 overflow-y-auto">
            {loadingFolders ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : folders.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No folders found</p>
            ) : (
              folders.map(f => (
                <div
                  key={f.id}
                  className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 group"
                >
                  <button
                    className="flex items-center gap-2 text-sm flex-1 text-left hover:underline"
                    onClick={() => navigateInto(f)}
                  >
                    <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                    {f.name}
                    <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                  </button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="opacity-0 group-hover:opacity-100 h-7 text-xs"
                    onClick={() => selectFolder(f)}
                    disabled={saving}
                  >
                    Select
                  </Button>
                </div>
              ))
            )}
          </div>

          {folderError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {folderError}
            </p>
          )}

          <div className="flex gap-2 justify-end">
            <Button size="sm" variant="outline" onClick={() => { setShowPicker(false); setFolderError(null); setUrlInput('') }}>
              Cancel
            </Button>
            <Button size="sm" onClick={selectCurrentFolder} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              Use this folder
            </Button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={openPicker}>
          {folderId ? 'Change folder' : 'Pick folder'}
        </Button>
      )}

      {folderId && connected && (
        <GoogleDriveCompanyFolders fundId={fundId} />
      )}
    </div>
  )
}

function GoogleDriveCompanyFolders({ fundId }: { fundId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [companies, setCompanies] = useState<{ id: string; name: string; google_drive_folder_id: string | null; google_drive_folder_name: string | null }[]>([])
  const [loading, setLoading] = useState(false)
  const [pickerCompanyId, setPickerCompanyId] = useState<string | null>(null)
  const [folders, setFolders] = useState<{ id: string; name: string }[]>([])
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<{ id: string | null; name: string; shared?: boolean }[]>([{ id: null, name: 'My Drive' }])
  const [browseMode, setBrowseMode] = useState<'my' | 'shared'>('my')
  const [saving, setSaving] = useState<string | null>(null)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')

  const loadCompanies = async () => {
    setLoading(true)
    const res = await fetch('/api/companies')
    if (res.ok) {
      const data = await res.json()
      // Fetch full details for each company to get folder overrides
      const detailed = await Promise.all(
        data.map(async (c: { id: string; name: string }) => {
          const r = await fetch(`/api/companies/${c.id}`)
          if (r.ok) {
            const d = await r.json()
            return { id: d.id, name: d.name, google_drive_folder_id: d.google_drive_folder_id ?? null, google_drive_folder_name: d.google_drive_folder_name ?? null }
          }
          return { id: c.id, name: c.name, google_drive_folder_id: null, google_drive_folder_name: null }
        })
      )
      setCompanies(detailed)
    }
    setLoading(false)
  }

  const handleExpand = () => {
    if (!expanded) loadCompanies()
    setExpanded(!expanded)
  }

  const loadFolders = async (parentId?: string, shared?: boolean) => {
    setLoadingFolders(true)
    setFolderError(null)
    try {
      let url = '/api/settings/drive/folders'
      if (shared) url += '?shared=true'
      else if (parentId) url += `?parent=${parentId}`
      const res = await fetch(url)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setFolderError(data.error || 'Failed to list folders')
        return
      }
      const data = await res.json()
      setFolders(data.folders ?? [])
    } catch {
      setFolderError('Failed to list folders')
    } finally {
      setLoadingFolders(false)
    }
  }

  const openPicker = (companyId: string) => {
    setPickerCompanyId(companyId)
    setBrowseMode('my')
    setUrlInput('')
    setBreadcrumbs([{ id: null, name: 'My Drive' }])
    setFolderError(null)
    loadFolders()
  }

  // Resolve a pasted Drive folder URL → folder, then save it for this company.
  // Mirrors the fund-level picker; the resolve endpoint reads the folder name,
  // the company PATCH (in selectFolder) persists it.
  const selectByUrl = async (companyId: string) => {
    if (!urlInput.trim()) return
    setSaving(companyId)
    setFolderError(null)
    const res = await fetch('/api/settings/drive/folders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput.trim() }),
    })
    if (!res.ok) {
      setSaving(null)
      const data = await res.json().catch(() => ({}))
      setFolderError(data.error || 'Failed to use folder')
      return
    }
    const { folderId, folderName } = await res.json()
    setUrlInput('')
    await selectFolder(companyId, { id: folderId, name: folderName })
  }

  const selectFolder = async (companyId: string, folder: { id: string; name: string }) => {
    setSaving(companyId)
    const res = await fetch(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_drive_folder_id: folder.id, google_drive_folder_name: folder.name }),
    })
    setSaving(null)
    if (res.ok) {
      setPickerCompanyId(null)
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, google_drive_folder_id: folder.id, google_drive_folder_name: folder.name } : c))
    }
  }

  const clearFolder = async (companyId: string) => {
    setSaving(companyId)
    const res = await fetch(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ google_drive_folder_id: null, google_drive_folder_name: null }),
    })
    setSaving(null)
    if (res.ok) {
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, google_drive_folder_id: null, google_drive_folder_name: null } : c))
    }
  }

  const navigateInto = (folder: { id: string; name: string }) => {
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }])
    loadFolders(folder.id)
  }

  const navigateToBreadcrumb = (index: number) => {
    const crumb = breadcrumbs[index]
    setBreadcrumbs(prev => prev.slice(0, index + 1))
    if (crumb.shared) loadFolders(undefined, true)
    else loadFolders(crumb.id ?? undefined)
  }

  return (
    <div className="border-t pt-3 mt-3">
      <button onClick={handleExpand} className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        Company Folders
        <span className="font-normal">(optional overrides)</span>
      </button>

      {expanded && (
        <div className="mt-2 space-y-1">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : companies.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No companies found.</p>
          ) : (
            <div className="border rounded-lg divide-y">
              {companies.map(c => (
                <div key={c.id} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{c.name}</span>
                    <div className="flex items-center gap-1 shrink-0">
                      {c.google_drive_folder_id ? (
                        <>
                          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{c.google_drive_folder_name}</span>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openPicker(c.id)} disabled={saving === c.id}>
                            Change
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => clearFolder(c.id)} disabled={saving === c.id}>
                            {saving === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">Default (auto-created)</span>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => openPicker(c.id)}>
                            Set folder
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  {pickerCompanyId === c.id && (
                    <div className="border rounded-lg p-3 mt-2 space-y-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-muted-foreground">Paste a Google Drive folder URL</label>
                        <div className="flex gap-2">
                          <Input
                            value={urlInput}
                            onChange={e => setUrlInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); selectByUrl(c.id) } }}
                            placeholder="https://drive.google.com/drive/folders/..."
                            className="h-8 text-sm"
                            disabled={saving === c.id}
                          />
                          <Button size="sm" onClick={() => selectByUrl(c.id)} disabled={saving === c.id || !urlInput.trim()}>
                            {saving === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Use'}
                          </Button>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="h-px flex-1 bg-border" />
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">or browse</span>
                        <div className="h-px flex-1 bg-border" />
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <button
                          onClick={() => { setBrowseMode('my'); setBreadcrumbs([{ id: null, name: 'My Drive' }]); loadFolders() }}
                          className={`px-2 py-1 rounded ${browseMode === 'my' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >My Drive</button>
                        <button
                          onClick={() => { setBrowseMode('shared'); setBreadcrumbs([{ id: null, name: 'Shared with me', shared: true }]); loadFolders(undefined, true) }}
                          className={`px-2 py-1 rounded ${browseMode === 'shared' ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                        >Shared with me</button>
                      </div>

                      <div className="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                        {breadcrumbs.map((crumb, i) => (
                          <span key={i} className="flex items-center gap-1">
                            {i > 0 && <ChevronRight className="h-3 w-3" />}
                            <button onClick={() => navigateToBreadcrumb(i)} className={`hover:text-foreground ${i === breadcrumbs.length - 1 ? 'text-foreground font-medium' : ''}`}>
                              {crumb.name}
                            </button>
                          </span>
                        ))}
                      </div>

                      <div className="border rounded max-h-36 overflow-y-auto">
                        {loadingFolders ? (
                          <div className="flex items-center justify-center py-4">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        ) : folders.length === 0 ? (
                          <p className="text-xs text-muted-foreground text-center py-4">No folders found</p>
                        ) : (
                          folders.map(f => (
                            <div key={f.id} className="flex items-center justify-between px-3 py-2 hover:bg-muted/50 group">
                              <button className="flex items-center gap-2 text-sm flex-1 text-left hover:underline" onClick={() => navigateInto(f)}>
                                <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                                {f.name}
                                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                              </button>
                              <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 h-7 text-xs" onClick={() => selectFolder(c.id, f)} disabled={saving === c.id}>
                                Select
                              </Button>
                            </div>
                          ))
                        )}
                      </div>

                      {folderError && (
                        <p className="text-xs text-destructive flex items-center gap-1">
                          <AlertCircle className="h-3 w-3" /> {folderError}
                        </p>
                      )}

                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="outline" onClick={() => { setPickerCompanyId(null); setFolderError(null); setUrlInput('') }}>
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────── Storage ────────────────────────────

function StorageSection({
  fundId,
  fileStorageProvider,
  googleDriveConnected,
  googleDriveFolderId,
  googleDriveFolderName,
  hasGoogleCredentials,
  googleClientId,
  onChanged,
}: {
  fundId: string
  fileStorageProvider: string | null
  googleDriveConnected: boolean
  googleDriveFolderId: string | null
  googleDriveFolderName: string | null
  hasGoogleCredentials: boolean
  googleClientId: string
  onChanged: () => void
}) {
  const [selectedProvider, setSelectedProvider] = useState(fileStorageProvider || '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleProviderChange = async (value: string) => {
    setSelectedProvider(value)
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileStorageProvider: value || null }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onChanged()
    }
  }

  return (
    <Section title="Storage">
      <p className="text-xs text-muted-foreground mb-4">
        All portfolio data, company details, metrics, and email content are stored in the database (Supabase/PostgreSQL). By default, email attachments are also stored in the database. Optionally, connect Google Drive to store portfolio reports and attachments externally.
      </p>

      <div className="space-y-4">
        <div>
          <Label>File storage provider</Label>
          <div className="flex items-center gap-2">
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={selectedProvider}
              onChange={(e) => handleProviderChange(e.target.value)}
              disabled={saving}
            >
              <option value="">None (database only)</option>
              <option value="google_drive">Google Drive</option>
            </select>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            {saved && <Check className="h-3.5 w-3.5 text-emerald-600 shrink-0" />}
          </div>
        </div>

        {selectedProvider === 'google_drive' && (
          <div className="border-t pt-4">
            <GoogleDriveSection
              fundId={fundId}
              connected={googleDriveConnected}
              folderId={googleDriveFolderId}
              folderName={googleDriveFolderName}
              hasCredentials={hasGoogleCredentials}
              onChanged={onChanged}
            />
          </div>
        )}
      </div>
    </Section>
  )
}

// ──────────────────────────── Outbound Email ────────────────────────────

function OutboundEmailSection({
  provider,
  asksProvider,
  approvalEmailSubject: savedApprovalSubject,
  approvalEmailBody: savedApprovalBody,
  systemEmailFromName: savedFromName,
  systemEmailFromAddress: savedFromAddress,
  hasResendKey,
  hasPostmarkServerToken,
  hasMailgunApiKey,
  mailgunSendingDomain: existingMailgunDomain,
  googleConnected,
  hasGoogleCredentials,
  googleClientId,
  onSaved,
}: {
  provider: string | null
  asksProvider: string | null
  approvalEmailSubject: string | null
  approvalEmailBody: string | null
  systemEmailFromName: string | null
  systemEmailFromAddress: string | null
  hasResendKey: boolean
  hasPostmarkServerToken: boolean
  hasMailgunApiKey: boolean
  mailgunSendingDomain: string
  googleConnected: boolean
  hasGoogleCredentials: boolean
  googleClientId: string
  onSaved: () => void
}) {
  const defaultSubject = "You've been approved to join {{fundName}}"
  const defaultBody = `<h2>Congrats!</h2>\n<p>You've been approved to join <strong>{{fundName}}</strong>.</p>\n<p><a href="{{siteUrl}}/auth">Sign in to get started</a></p>`

  const [systemProvider, setSystemProvider] = useState(provider || '')
  const [selectedAsksProvider, setSelectedAsksProvider] = useState(asksProvider || '')
  const [approvalSubject, setApprovalSubject] = useState(savedApprovalSubject || '')
  const [approvalBody, setApprovalBody] = useState(savedApprovalBody || '')
  const [fromName, setFromName] = useState(savedFromName || '')
  const [fromAddress, setFromAddress] = useState(savedFromAddress || '')
  const [resendKey, setResendKey] = useState('')
  const [postmarkToken, setPostmarkToken] = useState('')
  const [mgApiKey, setMgApiKey] = useState('')
  const [mgDomain, setMgDomain] = useState(existingMailgunDomain)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [showApprovalEmail, setShowApprovalEmail] = useState(false)

  // Determine which providers are actively selected (deduplicated)
  const activeProviders = new Set<string>()
  if (systemProvider) activeProviders.add(systemProvider)
  if (selectedAsksProvider) activeProviders.add(selectedAsksProvider)

  const handleSave = async () => {
    setSaving(true)
    const payload: Record<string, unknown> = {
      outboundEmailProvider: systemProvider || null,
      asksEmailProvider: selectedAsksProvider || null,
      approvalEmailSubject: approvalSubject.trim() || null,
      approvalEmailBody: approvalBody.trim() || null,
      systemEmailFromName: fromName.trim() || null,
      systemEmailFromAddress: fromAddress.trim() || null,
    }
    if (activeProviders.has('resend') && resendKey.trim()) {
      payload.resendApiKey = resendKey.trim()
    }
    if (activeProviders.has('postmark') && postmarkToken.trim()) {
      payload.postmarkServerToken = postmarkToken.trim()
    }
    if (activeProviders.has('mailgun')) {
      if (mgApiKey.trim()) payload.mailgunApiKey = mgApiKey.trim()
      if (mgDomain.trim()) payload.mailgunSendingDomain = mgDomain.trim()
    }
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setResendKey('')
      setPostmarkToken('')
      setMgApiKey('')
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  const systemProviderChanged = systemProvider !== (provider || '')
  const asksProviderChanged = selectedAsksProvider !== (asksProvider || '')
  const approvalSubjectChanged = (approvalSubject.trim() || null) !== (savedApprovalSubject || null)
  const approvalBodyChanged = (approvalBody.trim() || null) !== (savedApprovalBody || null)
  const fromNameChanged = (fromName.trim() || null) !== (savedFromName || null)
  const fromAddressChanged = (fromAddress.trim() || null) !== (savedFromAddress || null)
  const hasNewSecret = resendKey.trim() || postmarkToken.trim() || mgApiKey.trim() || mgDomain !== existingMailgunDomain
  const canSave = systemProviderChanged || asksProviderChanged || approvalSubjectChanged || approvalBodyChanged || fromNameChanged || fromAddressChanged || hasNewSecret

  const selectClass = "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

  return (
    <Section title="Outbound email">
      <p className="text-xs text-muted-foreground mb-3">
        Configure email providers for system notifications and portfolio asks.
      </p>
      <div className="space-y-3">
        <div>
          <Label>System emails</Label>
          <p className="text-xs text-muted-foreground mb-1.5">
            Automated notifications like member approvals.
          </p>
          <select
            className={selectClass}
            value={systemProvider}
            onChange={(e) => setSystemProvider(e.target.value)}
          >
            <option value="">None (disabled)</option>
            <option value="resend">Resend</option>
            <option value="postmark">Postmark</option>
            <option value="mailgun">Mailgun</option>
            <option value="gmail">Gmail</option>
          </select>
        </div>

        {systemProvider && (
          <div className="border rounded-lg p-3 space-y-3">
            <div>
              <button
                type="button"
                onClick={() => setShowApprovalEmail(!showApprovalEmail)}
                className="flex items-center gap-1.5 text-sm font-medium hover:text-foreground transition-colors"
              >
                {showApprovalEmail ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                Member accepted email
              </button>
              <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                Sent when a new member is approved to join the fund.
              </p>
            </div>
            {showApprovalEmail && (
              <>
                <div>
                  <Label>From name</Label>
                  <Input
                    value={fromName}
                    onChange={(e) => setFromName(e.target.value)}
                    placeholder="e.g. Acme Ventures"
                  />
                </div>
                <div>
                  <Label>From address</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                    Must be a verified sender address for your email provider.{systemProvider === 'gmail' ? ' Ignored when using Gmail, emails are sent from your connected Google account.' : ''}
                  </p>
                  <Input
                    type="email"
                    value={fromAddress}
                    onChange={(e) => setFromAddress(e.target.value)}
                    placeholder="notifications@yourdomain.com"
                    disabled={systemProvider === 'gmail'}
                  />
                </div>
                <div>
                  <Label>Subject</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                    Use {'{{fundName}}'} as a placeholder.
                  </p>
                  <Input
                    value={approvalSubject}
                    onChange={(e) => setApprovalSubject(e.target.value)}
                    placeholder={defaultSubject}
                  />
                </div>
                <div>
                  <Label>Body</Label>
                  <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                    HTML body. Use {'{{fundName}}'} and {'{{siteUrl}}'} as placeholders.
                  </p>
                  <Textarea
                    value={approvalBody}
                    onChange={(e) => setApprovalBody(e.target.value)}
                    placeholder={defaultBody}
                    rows={5}
                    className="font-mono text-xs"
                  />
                </div>
              </>
            )}
          </div>
        )}

        <div>
          <Label>Asks emails</Label>
          <p className="text-xs text-muted-foreground mb-1.5">
            Quarterly reporting requests from the Asks page.
          </p>
          <select
            className={selectClass}
            value={selectedAsksProvider}
            onChange={(e) => setSelectedAsksProvider(e.target.value)}
          >
            <option value="">None (disabled)</option>
            <option value="resend">Resend</option>
            <option value="postmark">Postmark</option>
            <option value="mailgun">Mailgun</option>
            <option value="gmail">Gmail</option>
          </select>
        </div>

        {activeProviders.size > 0 && (
          <>
            <div className="border-t pt-3">
              <p className="text-sm font-medium">Settings for selected email providers</p>
            </div>
          </>
        )}

        {activeProviders.has('resend') && (
          <div>
            <Label>Resend API key</Label>
            {hasResendKey && (
              <p className="text-xs text-muted-foreground mt-1 mb-1.5">
                A key is already saved. Enter a new one to replace it.
              </p>
            )}
            <Input
              type="password"
              value={resendKey}
              onChange={(e) => setResendKey(e.target.value)}
              placeholder={hasResendKey ? '••••••••' : 're_...'}
            />
          </div>
        )}

        {activeProviders.has('postmark') && (
          <div>
            <Label>Postmark server token</Label>
            {hasPostmarkServerToken && (
              <p className="text-xs text-muted-foreground mt-1 mb-1.5">
                A token is already saved. Enter a new one to replace it.
              </p>
            )}
            <Input
              type="password"
              value={postmarkToken}
              onChange={(e) => setPostmarkToken(e.target.value)}
              placeholder={hasPostmarkServerToken ? '••••••••' : 'Server token'}
            />
          </div>
        )}

        {activeProviders.has('mailgun') && (
          <>
            <div>
              <Label>Mailgun API key</Label>
              {hasMailgunApiKey && (
                <p className="text-xs text-muted-foreground mt-1 mb-1.5">
                  A key is already saved. Enter a new one to replace it.
                </p>
              )}
              <Input
                type="password"
                value={mgApiKey}
                onChange={(e) => setMgApiKey(e.target.value)}
                placeholder={hasMailgunApiKey ? '••••••••' : 'key-...'}
              />
            </div>
            <div>
              <Label>Sending domain</Label>
              <Input
                value={mgDomain}
                onChange={(e) => setMgDomain(e.target.value)}
                placeholder="mg.yourdomain.com"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The verified domain in Mailgun used for sending emails.
              </p>
            </div>
          </>
        )}

        {activeProviders.has('gmail') && (
          <div className="space-y-2">
            <Label>Gmail connection</Label>
            <p className="text-xs text-muted-foreground">
              Emails will be sent from your connected Google account. The same Google connection is used for Gmail and Google Drive.
            </p>
            <GoogleConnectionUI
              connected={googleConnected}
              hasCredentials={hasGoogleCredentials}
              clientId={googleClientId}
              onChanged={onSaved}
            />
          </div>
        )}

        <Button onClick={handleSave} disabled={saving || !canSave} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── Senders ────────────────────────────

function SendersSection({
  senders,
  onChanged,
}: {
  senders: Sender[]
  onChanged: () => void
}) {
  const [email, setEmail] = useState('')
  const [label, setLabel] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [expanded, setExpanded] = useState(false)

  const handleAdd = async () => {
    if (!email.trim()) return
    setAdding(true)
    const res = await fetch('/api/settings/senders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, label }),
    })
    setAdding(false)
    if (res.ok) {
      setEmail('')
      setLabel('')
      onChanged()
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/settings/senders/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) onChanged()
  }

  return (
    <Section title="Authorized senders">
      <p className="text-xs text-muted-foreground mb-3">
        Only emails from these addresses will be processed.
      </p>

      {senders.length > 0 && (
        <div className="mb-3">
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-2"
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? '' : '-rotate-90'}`} />
            {senders.length} sender{senders.length !== 1 ? 's' : ''}
          </button>
          {expanded && (
            <div className="border rounded-lg divide-y">
              {senders.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2">
                  <div>
                    <span className="text-sm">{s.email}</span>
                    {s.label && (
                      <span className="text-xs text-muted-foreground ml-2">({s.label})</span>
                    )}
                  </div>
                  <button
                    onClick={() => handleDelete(s.id)}
                    disabled={deletingId === s.id}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>Email</Label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="founder@company.com"
          />
        </div>
        <div className="sm:w-32">
          <Label>Label</Label>
          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="optional"
          />
        </div>
        <Button onClick={handleAdd} disabled={adding || !email.trim()} size="sm">
          {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── LP Portal ────────────────────────────

/**
 * The LP portal's master switch, shown at the top of Feature visibility.
 *
 * It is NOT a visibility level, and deliberately doesn't look like one: everything else in that
 * section decides what your TEAM sees, while this decides whether your INVESTORS have a portal at
 * all. It used to sit in a section of its own much further down the page, which made it easy to
 * configure "LP documents & sharing" for the team and wonder why nothing reached anyone.
 *
 * When off, the layout forces the LP cards to hidden and their pages redirect — so those cards
 * mean nothing until this is on.
 */
function LpPortalCard({ enabled, onSaved }: { enabled: boolean; onSaved: () => void }) {
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)

  const handleToggle = async (checked: boolean) => {
    setOn(checked)
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lpPortalEnabled: checked }),
    })
    setSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <SettingsCard
      title="LP portal"
      subtitle="For your investors, not your team: whether LPs can sign in and see what you’ve shared. While it’s off, “LP documents & sharing” and “LP activity log” are unavailable — to your team and to you. Everything else LP-related (letters, LP capital, GP entities) works either way."
      aside={saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : undefined}
    >
      <div className="flex items-center gap-3">
        <Switch checked={on} onCheckedChange={handleToggle} disabled={saving} />
        <Label className="text-sm font-normal">{on ? 'On — LPs can sign in' : 'Off — nothing reaches LPs'}</Label>
      </div>
    </SettingsCard>
  )
}

// ──────────────────────────── Deals ────────────────────────────

const DEFAULT_DEAL_SCREENING_PROMPT = `You are a senior partner at a venture capital fund. The fund's thesis is provided above.

For the inbound email and any attached materials, return structured output containing:

- The standard extraction fields (company, founders, intro source, stage, industry, raise).
- A company_summary describing what they do, who they sell to, stage, traction signals,
  and team highlights drawn directly from the materials.
- A thesis_fit_analysis covering:
   - Alignment with each pillar of the thesis (cite specific evidence).
   - Disqualifiers, if any.
   - Open questions a partner would ask before a first meeting.
- A single thesis_fit_score: strong | moderate | weak | out_of_thesis | spam (spam = non-pitches like newsletters or vendor solicitations).

Be specific. Avoid hedging adjectives. If a key fact is not in the materials, say so
explicitly rather than inferring.`

function DealScreeningSection({ thesis, prompt, intakeEnabled, hasSubmissionToken, onSaved }: {
  thesis: string | null
  prompt: string | null
  intakeEnabled: boolean
  hasSubmissionToken: boolean
  onSaved: () => void
}) {
  const [thesisVal, setThesisVal] = useState(thesis ?? '')
  const [promptVal, setPromptVal] = useState(prompt ?? DEFAULT_DEAL_SCREENING_PROMPT)
  const [intake, setIntake] = useState(intakeEnabled)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<string | null>(null)
  const [tokenBusy, setTokenBusy] = useState(false)
  const [tokenCopied, setTokenCopied] = useState(false)
  // The plaintext token is returned only when minted — only the hash is stored, so it can't be
  // shown again on reload. `mintedToken` holds it for this one session so the URL is copyable now.
  const [mintedToken, setMintedToken] = useState<string | null>(null)

  const isCustomized = prompt !== null
  const submissionUrl = mintedToken ? `${typeof window !== 'undefined' ? window.location.origin : ''}/submit/${mintedToken}` : null

  async function generateToken() {
    setTokenBusy(true)
    const res = await fetch('/api/settings/deal-submission-token', { method: 'POST' })
    const data = await res.json().catch(() => ({}))
    setTokenBusy(false)
    if (res.ok) { setMintedToken(data.token ?? null); onSaved() }
  }

  async function clearToken() {
    if (!confirm('Disable the public submission form? Anyone with the current URL will see a not-found page.')) return
    setTokenBusy(true)
    const res = await fetch('/api/settings/deal-submission-token', { method: 'DELETE' })
    setTokenBusy(false)
    if (res.ok) { setMintedToken(null); onSaved() }
  }

  function copyUrl() {
    if (!submissionUrl) return
    navigator.clipboard.writeText(submissionUrl)
    setTokenCopied(true)
    setTimeout(() => setTokenCopied(false), 2000)
  }

  async function handleSave() {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dealThesis: thesisVal,
        dealScreeningPrompt: promptVal,
        dealIntakeEnabled: intake,
      }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  async function handleResetPrompt() {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dealScreeningPrompt: null }),
    })
    setSaving(false)
    if (res.ok) {
      setPromptVal(DEFAULT_DEAL_SCREENING_PROMPT)
      onSaved()
    }
  }

  async function handlePreview() {
    setPreviewing(true)
    setPreviewResult(null)
    const res = await fetch('/api/deals/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thesis: thesisVal, screeningPrompt: promptVal }),
    })
    setPreviewing(false)
    if (res.ok) {
      const body = await res.json()
      setPreviewResult(JSON.stringify(body.analysis ?? body, null, 2))
    } else {
      const err = await res.text()
      setPreviewResult(`Error: ${err}`)
    }
  }

  return (
    <Section title="Deal screening">
      <p className="text-xs text-muted-foreground mb-3">
        Configure how inbound pitches are screened against your fund's thesis. The thesis is included
        verbatim before the screening instructions in the AI prompt.
      </p>

      <label className="block text-xs font-medium text-muted-foreground mb-1">Investment thesis</label>
      <textarea
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm font-mono leading-relaxed mb-4"
        rows={6}
        value={thesisVal}
        onChange={e => setThesisVal(e.target.value)}
        placeholder="Describe your thesis: stages, sectors, geographies, check sizes, what you avoid..."
      />

      <label className="block text-xs font-medium text-muted-foreground mb-1">Screening instructions</label>
      <textarea
        className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm font-mono leading-relaxed"
        rows={10}
        value={promptVal}
        onChange={e => setPromptVal(e.target.value)}
      />

      <label className="flex items-center gap-2 mt-4 text-sm cursor-pointer">
        <input type="checkbox" checked={intake} onChange={e => setIntake(e.target.checked)} className="h-4 w-4" />
        <span>Enable inbound deal intake</span>
      </label>
      <p className="text-xs text-muted-foreground ml-6 mt-1">
        When off, the classifier still runs in shadow mode (results recorded on each email) but no email is routed to Deals.
      </p>

      <div className="flex items-center gap-2 mt-4">
        <Button onClick={handleSave} disabled={saving} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
        {isCustomized && (
          <Button onClick={handleResetPrompt} disabled={saving} variant="outline" size="sm">
            Reset prompt
          </Button>
        )}
        <Button onClick={handlePreview} disabled={previewing || saving} variant="outline" size="sm">
          {previewing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
          Preview
        </Button>
      </div>

      {previewResult && (
        <pre className="mt-3 whitespace-pre-wrap text-xs bg-muted rounded-md px-3 py-2 font-mono leading-relaxed max-h-80 overflow-y-auto">
          {previewResult}
        </pre>
      )}

      <div className="border-t mt-6 pt-4">
        <h3 className="text-sm font-medium mb-1">Public submission form</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Share a public URL where founders can submit pitches directly. Each submission runs through the same screening pipeline as inbound emails.
          Generating a new URL invalidates the previous one.
        </p>
        {submissionUrl ? (
          <div className="space-y-2">
            <p className="text-xs text-amber-600 dark:text-amber-400">Copy this URL now — it won&rsquo;t be shown again. Only a hash is stored.</p>
            <div className="flex items-center gap-2">
              <Input readOnly value={submissionUrl} className="font-mono text-xs" />
              <Button onClick={copyUrl} variant="outline" size="sm">
                {tokenCopied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </Button>
            </div>
            <Button onClick={clearToken} disabled={tokenBusy} variant="outline" size="sm">Disable form</Button>
            {!intake && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Note: the form is currently inactive because deal intake is disabled above.
              </p>
            )}
          </div>
        ) : hasSubmissionToken ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">A submission link is active. The URL isn&rsquo;t shown after minting — regenerate to get a new one (the old link stops working).</p>
            <div className="flex gap-2">
              <Button onClick={generateToken} disabled={tokenBusy} variant="outline" size="sm">Regenerate URL</Button>
              <Button onClick={clearToken} disabled={tokenBusy} variant="outline" size="sm">Disable form</Button>
            </div>
            {!intake && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Note: the form is currently inactive because deal intake is disabled above.
              </p>
            )}
          </div>
        ) : (
          <Button onClick={generateToken} disabled={tokenBusy} variant="outline" size="sm">
            Generate submission URL
          </Button>
        )}
      </div>
    </Section>
  )
}

interface KnownReferrer {
  id: string
  email: string
  name: string | null
  notes: string | null
  created_at: string | null
}

function KnownReferrersSection() {
  const [items, setItems] = useState<KnownReferrer[]>([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [adding, setAdding] = useState(false)

  async function load() {
    const res = await fetch('/api/known-referrers')
    if (res.ok) setItems(await res.json())
  }

  useEffect(() => { load() }, [])

  async function add() {
    if (!email.trim()) return
    setAdding(true)
    const res = await fetch('/api/known-referrers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, name, notes }),
    })
    setAdding(false)
    if (res.ok) {
      setEmail(''); setName(''); setNotes('')
      load()
    }
  }

  async function remove(id: string) {
    if (!confirm('Remove this referrer?')) return
    const res = await fetch(`/api/known-referrers/${id}`, { method: 'DELETE' })
    if (res.ok) setItems(items.filter(x => x.id !== id))
  }

  return (
    <Section title="Known referrers">
      <p className="text-xs text-muted-foreground mb-3">
        Email addresses of scouts and friends-of-fund whose intros and forwards should bias toward Deals.
        The classifier reads this as a soft signal, not a hard rule.
      </p>

      <div className="grid grid-cols-12 gap-2 mb-3">
        <Input className="col-span-4 h-9" placeholder="email@example.com" value={email} onChange={e => setEmail(e.target.value)} />
        <Input className="col-span-3 h-9" placeholder="Name (optional)" value={name} onChange={e => setName(e.target.value)} />
        <Input className="col-span-4 h-9" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
        <Button onClick={add} disabled={adding || !email.trim()} size="sm" className="col-span-1">Add</Button>
      </div>

      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">No known referrers yet.</div>
      ) : (
        <div className="rounded border divide-y">
          {items.map(r => (
            <div key={r.id} className="flex items-center justify-between gap-2 p-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{r.email}</div>
                <div className="text-xs text-muted-foreground">
                  {r.name ?? ''}{r.name && r.notes ? ' · ' : ''}{r.notes ?? ''}
                </div>
              </div>
              <Button onClick={() => remove(r.id)} variant="ghost" size="sm">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────── Diligence ────────────────────────────

function MemoAgentSubsection({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="py-3">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-start gap-2 text-left group"
      >
        {open ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0">
          <div className="text-sm font-medium group-hover:text-foreground">{title}</div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{desc}</p>
        </div>
      </button>
      {open && <div className="mt-3 pl-6">{children}</div>}
    </div>
  )
}

function MemoAgentSection() {
  return (
    <Section title="Diligence">
      <p className="text-xs text-muted-foreground mb-1">
        Configure how the diligence agent reads data rooms, sources external research, runs partner Q&amp;A, and drafts memos.
      </p>
      <div className="divide-y border-t">
        <MemoAgentSubsection
          title="Schemas"
          desc="The seven YAML/MD files that govern the agent: rubric, Q&A library, ingestion shape, research shape, memo output, style anchors, and instructions."
        >
          <SchemasInline />
        </MemoAgentSubsection>
        <MemoAgentSubsection
          title="Style anchors"
          desc="Upload past investment memos so the agent learns your firm's voice and structure. Reference only; never copied into new memos as facts."
        >
          <StyleAnchorsInline />
        </MemoAgentSubsection>
        <MemoAgentSubsection
          title="Defaults & caps"
          desc="Per-deal and monthly token caps, the research web-search toggle, and the Deepgram transcription check."
        >
          <DefaultsEditor embedded section="caps" />
        </MemoAgentSubsection>
        <MemoAgentSubsection
          title="Per-stage AI models"
          desc="The AI provider and model each memo-agent stage runs on (ingest, research, draft, score, …)."
        >
          <DefaultsEditor embedded section="stages" />
        </MemoAgentSubsection>
      </div>
    </Section>
  )
}

// ──────────────────────────── Shared ────────────────────────────
//
// GroupHeader / Section / AdminSectionContext now live in components/settings/section.tsx,
// so the settings cards that live in their own files can render with the same admin chrome
// instead of a bare <Card>. They are imported at the top of this file.
