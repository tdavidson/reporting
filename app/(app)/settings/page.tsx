'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
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
import { AIProvidersSection } from './_sections/platform/ai-providers-section'
import { InboundEmailSection } from './_sections/platform/inbound-email-section'
import { StorageSection } from './_sections/platform/storage-section'
import { OutboundEmailSection } from './_sections/platform/outbound-email-section'
import { SendersSection } from './_sections/platform/senders-section'
import { Check, ChevronDown, ChevronRight, Loader2, Trash2, Copy, Unlink, ArrowDownCircle, Eye } from 'lucide-react'
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

// ──────────────────────────── Google Connection (shared) ────────────────────────────

// ──────────────────────────── Storage ────────────────────────────

// ──────────────────────────── Outbound Email ────────────────────────────

// ──────────────────────────── Senders ────────────────────────────

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
