'use client'

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import Link from 'next/link'
import { AlertCircle, Check, ChevronDown, ChevronRight, Loader2, Plus, Trash2, Copy, FolderOpen, Unlink, Shield, ImagePlus, X, Lock, ArrowDownCircle, Eye } from 'lucide-react'
import { DEFAULT_FEATURE_VISIBILITY, FEATURES_WITH_OFF } from '@/lib/types/features'
import type { FeatureKey, FeatureVisibility } from '@/lib/types/features'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

const AdminSectionContext = createContext(false)

interface Sender {
  id: string
  email: string
  label: string | null
  created_at: string
}

interface Settings {
  fundId: string
  fundName: string
  fundLogo: string | null
  fundAddress: string | null
  postmarkInboundAddress: string
  postmarkWebhookToken: string
  hasClaudeKey: boolean
  claudeModel: string
  hasOpenAIKey: boolean
  openaiModel: string
  defaultAIProvider: string
  hasGeminiKey: boolean
  geminiModel: string
  ollamaBaseUrl: string
  ollamaModel: string
  retainResolvedReviews: boolean
  resolvedReviewsTtlDays: number | null
  senders: Sender[]
  googleDriveConnected: boolean
  googleDriveFolderId: string | null
  googleDriveFolderName: string | null
  hasGoogleCredentials: boolean
  googleClientId: string
  fileStorageProvider: string | null
  dropboxConnected: boolean
  hasDropboxCredentials: boolean
  dropboxAppKey: string
  dropboxFolderPath: string | null
  aiSummaryPrompt: string | null
  outboundEmailProvider: string | null
  asksEmailProvider: string | null
  approvalEmailSubject: string | null
  approvalEmailBody: string | null
  systemEmailFromName: string | null
  systemEmailFromAddress: string | null
  hasResendKey: boolean
  hasPostmarkServerToken: boolean
  inboundEmailProvider: string | null
  mailgunInboundDomain: string
  hasMailgunSigningKey: boolean
  hasMailgunApiKey: boolean
  mailgunSendingDomain: string
  analyticsFathomSiteId: string | null
  analyticsGaMeasurementId: string | null
  analyticsCustomHeadScript: string | null
  disableUserTracking: boolean
  currency: string
  featureVisibility: Record<string, string>
  displayName: string
  isAdmin: boolean
  appVersion: string
  updateAvailable: boolean
}

export default function SettingsPage() {
  const router = useRouter()
  const [settings, setSettings] = useState<Settings | null>(null)
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
          <CurrencySection currency={settings.currency} onSaved={load} />
          <FeatureVisibilitySection featureVisibility={settings.featureVisibility} onSaved={load} />
        </AdminSectionContext.Provider>
      )}
      <GroupHeader label="Notes" />
      <NotificationPreferencesSection />
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
            hasGeminiKey={settings.hasGeminiKey}
            geminiModel={settings.geminiModel}
            ollamaBaseUrl={settings.ollamaBaseUrl}
            ollamaModel={settings.ollamaModel}
            defaultAIProvider={settings.defaultAIProvider}
            onSaved={load}
          />
          <AiSummaryPromptSection currentPrompt={settings.aiSummaryPrompt} onSaved={load} />

          <GroupHeader label="Storage" />
          <StorageSection
            fundId={settings.fundId}
            fileStorageProvider={settings.fileStorageProvider}
            googleDriveConnected={settings.googleDriveConnected}
            googleDriveFolderId={settings.googleDriveFolderId}
            googleDriveFolderName={settings.googleDriveFolderName}
            hasGoogleCredentials={settings.hasGoogleCredentials}
            googleClientId={settings.googleClientId}
            dropboxConnected={settings.dropboxConnected}
            hasDropboxCredentials={settings.hasDropboxCredentials}
            dropboxAppKey={settings.dropboxAppKey}
            dropboxFolderPath={settings.dropboxFolderPath}
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
          <TeamSection isAdmin={settings.isAdmin} />
          <DangerZone onDeleted={() => router.push('/auth')} />
        </AdminSectionContext.Provider>
      )}

    </div>
    <AnalystPanel />
    </div>
    </div>
  )
}

// ──────────────────────────── Version ────────────────────────────

function VersionSection({ appVersion, updateAvailable }: { appVersion: string; updateAvailable: boolean }) {
  return (
    <div className="rounded-lg border border-amber-500/30 bg-card p-5">
      <h2 className="text-sm font-medium mb-1 flex items-center gap-1.5">
        <Lock className="h-3 w-3 text-amber-500" />
        Version
      </h2>
      {updateAvailable ? (
        <p className="text-xs text-muted-foreground">
          You are running <span className="font-mono font-medium text-foreground">v{appVersion}</span>. A newer version is available.{' '}
          <Link href="/updates" className="text-amber-600 dark:text-amber-400 underline underline-offset-4 hover:text-amber-500">
            View update details
          </Link>
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          You are running <span className="font-mono font-medium text-foreground">v{appVersion}</span> and are up to date.{' '}
          <a
            href="https://github.com/tdavidson/reporting/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            View releases on GitHub
          </a>
        </p>
      )}
    </div>
  )
}

// ──────────────────────────── Profile ────────────────────────────

function ProfileSection({ displayName, onSaved }: { displayName: string; onSaved: () => void }) {
  const [value, setValue] = useState(displayName)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Your profile">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
        <div className="flex-1">
          <Label>Display name</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-1.5">
            Shown on notes and activity. If empty, your email will be used.
          </p>
          <Input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Your name"
          />
        </div>
        <Button onClick={handleSave} disabled={saving || value === displayName} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── MFA ────────────────────────────

function MfaSection() {
  const supabase = createClient()
  const [state, setState] = useState<'loading' | 'disabled' | 'enrolling' | 'enabled'>('loading')
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const [enrolledFactorId, setEnrolledFactorId] = useState<string | null>(null)
  const [verifiedFactorIds, setVerifiedFactorIds] = useState<string[]>([])
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [disabling, setDisabling] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    async function check() {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const verified = factors?.totp?.filter(f => f.status === 'verified') ?? []
      if (verified.length > 0) {
        setVerifiedFactorIds(verified.map(f => f.id))
        setState('enabled')
      } else {
        setState('disabled')
      }
    }
    check()
  }, [supabase])

  async function startEnroll() {
    setError(null)
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp' })
    if (error) {
      setError(error.message)
      return
    }
    setEnrolledFactorId(data.id)
    setQrCode(data.totp.qr_code)
    setSecret(data.totp.secret)
    setState('enrolling')
    setTimeout(() => inputRef.current?.focus(), 100)
  }

  async function verifyEnroll() {
    if (code.length !== 6 || !enrolledFactorId) return
    setError(null)
    setVerifying(true)
    const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: enrolledFactorId })
    if (challengeError) {
      setError(challengeError.message)
      setVerifying(false)
      return
    }
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId: enrolledFactorId,
      challengeId: challenge.id,
      code,
    })
    if (verifyError) {
      setError(verifyError.message)
      setCode('')
      inputRef.current?.focus()
    } else {
      setVerifiedFactorIds([enrolledFactorId])
      setQrCode(null)
      setSecret(null)
      setEnrolledFactorId(null)
      setCode('')
      setState('enabled')
    }
    setVerifying(false)
  }

  async function cancelEnroll() {
    if (enrolledFactorId) {
      await supabase.auth.mfa.unenroll({ factorId: enrolledFactorId })
    }
    setEnrolledFactorId(null)
    setQrCode(null)
    setSecret(null)
    setCode('')
    setError(null)
    setState('disabled')
  }

  async function disableMfa() {
    setDisabling(true)
    setError(null)
    for (const id of verifiedFactorIds) {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: id })
      if (error) {
        setError(error.message)
        setDisabling(false)
        return
      }
    }
    setVerifiedFactorIds([])
    setConfirmDisable(false)
    setDisabling(false)
    setState('disabled')
  }

  if (state === 'loading') {
    return (
      <Section title="Two-factor authentication">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      </Section>
    )
  }

  return (
    <Section title="Two-factor authentication">
      {error && (
        <p className="text-xs text-destructive flex items-center gap-1 mb-3">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </p>
      )}

      {state === 'disabled' && (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Add an extra layer of security to your account by requiring a code from an authenticator app when you sign in.
          </p>
          <Button size="sm" onClick={startEnroll}>
            <Shield className="h-3.5 w-3.5 mr-1.5" />
            Enable two-factor authentication
          </Button>
        </div>
      )}

      {state === 'enrolling' && (
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Scan the QR code with your authenticator app (e.g. Google Authenticator, 1Password, Authy), then enter the 6-digit code to verify.
          </p>
          {qrCode && (
            <div className="flex justify-center">
              <img src={qrCode} alt="TOTP QR code" className="h-48 w-48 rounded border" />
            </div>
          )}
          {secret && (
            <div className="text-center">
              <p className="text-xs text-muted-foreground mb-1">Or enter this code manually:</p>
              <code className="text-xs bg-muted px-2 py-1 rounded select-all">{secret}</code>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="mfa-enroll-code">Verification code</Label>
            <Input
              ref={inputRef}
              id="mfa-enroll-code"
              type="text"
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
              onKeyDown={e => e.key === 'Enter' && verifyEnroll()}
              autoComplete="one-time-code"
              placeholder="000000"
              className="text-center font-mono text-lg tracking-widest max-w-48 mx-auto"
            />
          </div>
          <div className="flex gap-2 justify-center">
            <Button size="sm" onClick={verifyEnroll} disabled={verifying || code.length !== 6}>
              {verifying ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
              Verify &amp; enable
            </Button>
            <Button size="sm" variant="outline" onClick={cancelEnroll} disabled={verifying}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {state === 'enabled' && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-green-600 shrink-0" />
            <span>Two-factor authentication is enabled.</span>
          </div>
          {!confirmDisable ? (
            <Button size="sm" variant="outline" onClick={() => setConfirmDisable(true)}>
              Disable
            </Button>
          ) : (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="destructive" onClick={disableMfa} disabled={disabling}>
                {disabling ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                Confirm disable
              </Button>
              <Button size="sm" variant="outline" onClick={() => setConfirmDisable(false)} disabled={disabling}>
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────── Currency ────────────────────────────

const SUPPORTED_CURRENCIES = [
  { code: 'USD', label: 'USD – US Dollar' },
  { code: 'EUR', label: 'EUR – Euro' },
  { code: 'GBP', label: 'GBP – British Pound' },
  { code: 'CHF', label: 'CHF – Swiss Franc' },
  { code: 'CAD', label: 'CAD – Canadian Dollar' },
  { code: 'AUD', label: 'AUD – Australian Dollar' },
  { code: 'JPY', label: 'JPY – Japanese Yen' },
  { code: 'CNY', label: 'CNY – Chinese Yuan' },
  { code: 'INR', label: 'INR – Indian Rupee' },
  { code: 'SGD', label: 'SGD – Singapore Dollar' },
  { code: 'HKD', label: 'HKD – Hong Kong Dollar' },
  { code: 'SEK', label: 'SEK – Swedish Krona' },
  { code: 'NOK', label: 'NOK – Norwegian Krone' },
  { code: 'DKK', label: 'DKK – Danish Krone' },
  { code: 'NZD', label: 'NZD – New Zealand Dollar' },
  { code: 'BRL', label: 'BRL – Brazilian Real' },
  { code: 'ZAR', label: 'ZAR – South African Rand' },
  { code: 'ILS', label: 'ILS – Israeli Shekel' },
  { code: 'KRW', label: 'KRW – South Korean Won' },
]

function CurrencySection({ currency, onSaved }: { currency: string; onSaved: () => void }) {
  const [value, setValue] = useState(currency)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Fund currency">
      <p className="text-xs text-muted-foreground mb-3">
        The default currency used for investment values and currency-type metrics across the app.
      </p>
      <div className="flex items-end gap-3">
        <div className="flex-1 max-w-xs">
          <Label>Currency</Label>
          <select
            value={value}
            onChange={e => setValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {SUPPORTED_CURRENCIES.map(c => (
              <option key={c.code} value={c.code}>{c.label}</option>
            ))}
          </select>
        </div>
        <Button onClick={handleSave} disabled={saving || value === currency} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── Feature Visibility ────────────────────────────

const FEATURE_META: Record<FeatureKey, { label: string; description: string; href: string }> = {
  interactions: { label: 'Interactions', description: 'Track emails, intros, and meetings with portfolio companies', href: '/support#interactions' },
  investments: { label: 'Investments', description: 'Fund investments, ownership, and round details per company', href: '/support#investments' },
  funds: { label: 'Funds', description: 'Fund-level cash flows, LP metrics (TVPI/DPI/RVPI/Net IRR) computed from capital calls and distributions', href: '/support#funds' },
  notes: { label: 'Notes', description: 'Internal team notes and comments on companies', href: '/support#notes' },
  lp_letters: { label: 'LP Letters', description: 'Generate and manage quarterly LP update letters', href: '/support#lp-letters' },
  imports: { label: 'Imports', description: 'Bulk import companies and metrics from CSV files', href: '/support#import' },
  asks: { label: 'Asks', description: 'Track and send portfolio company requests to your network', href: '/support#asks' },
  lps: { label: 'LPs', description: 'Investor-level report cards with consolidated performance across fund vehicles', href: '/support#lps' },
  lp_associates: { label: 'GP Entities', description: 'Entity ownership mappings and pro-rata associates calculations for LP reporting', href: '/support#lps' },
  compliance: { label: 'Compliance', description: 'Track regulatory deadlines, filings, and compliance workflows', href: '/support#compliance' },
  vc_market: { label: 'VC Market', description: 'Deal flow and market intelligence scraped from VC news sources', href: '/support#vc-market' },
}

const VISIBILITY_OPTIONS: { value: FeatureVisibility; label: string; description: string }[] = [
  { value: 'everyone', label: 'Everyone', description: 'Visible to all team members' },
  { value: 'admin', label: 'Admin only', description: 'Only visible to admins' },
  { value: 'hidden', label: 'Hidden', description: 'Removed from sidebar, still accessible via URL' },
  { value: 'off', label: 'Off', description: 'Functionally disabled' },
]

function FeatureVisibilitySection({ featureVisibility, onSaved }: { featureVisibility: Record<string, string>; onSaved: () => void }) {
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
        Control which features are visible to your team. Hidden features can still be accessed directly by URL. Only Interactions supports being fully turned off.
      </p>
      <div className="space-y-4">
        {features.map(key => {
          const current = (values[key] ?? DEFAULT_FEATURE_VISIBILITY[key]) as FeatureVisibility
          const options = FEATURES_WITH_OFF.includes(key)
            ? VISIBILITY_OPTIONS
            : VISIBILITY_OPTIONS.filter(o => o.value !== 'off')

          const meta = FEATURE_META[key]
          return (
            <div key={key}>
              <div className="mb-1.5">
                <p className="text-sm font-medium">{meta.label}</p>
                <p className="text-xs text-muted-foreground">
                  {meta.description}{' '}
                  <Link href={meta.href} className="underline underline-offset-2 hover:text-foreground">Learn more</Link>
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {options.map(opt => (
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
            </div>
          )
        })}
      </div>
      {saving && <p className="text-xs text-muted-foreground mt-3">Saving...</p>}
      {saved && <p className="text-xs text-green-600 mt-3">Saved</p>}
    </Section>
  )
}

// ──────────────────────────── Notification Preferences ────────────────────────────

function NotificationPreferencesSection() {
  const [level, setLevel] = useState<string>('mentions')
  const [subscribedIds, setSubscribedIds] = useState<string[]>([])
  const [companies, setCompanies] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    Promise.all([
      fetch('/api/settings/notifications').then(r => r.json()),
      fetch('/api/companies').then(r => r.json()),
    ]).then(([prefs, companiesData]) => {
      if (prefs.level) setLevel(prefs.level)
      if (prefs.subscribedCompanyIds) setSubscribedIds(prefs.subscribedCompanyIds)
      if (Array.isArray(companiesData)) {
        setCompanies(companiesData.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name })).sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name)))
      }
    }).finally(() => setLoading(false))
  }, [])

  const save = async (newLevel: string, newSubscribedIds?: string[]) => {
    setSaving(true)
    const body: Record<string, unknown> = { level: newLevel }
    if (newSubscribedIds !== undefined) body.subscribedCompanyIds = newSubscribedIds
    const res = await fetch('/api/settings/notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    }
  }

  const handleLevelChange = (newLevel: string) => {
    setLevel(newLevel)
    save(newLevel)
  }

  const toggleCompany = (companyId: string) => {
    const next = subscribedIds.includes(companyId)
      ? subscribedIds.filter(id => id !== companyId)
      : [...subscribedIds, companyId]
    setSubscribedIds(next)
    save(level, next)
  }

  const options = [
    { value: 'all', label: 'All notes', description: 'Get notified for every new note' },
    { value: 'mentions', label: '@Mentions & followed companies', description: 'When someone @mentions you, plus notes on companies you follow' },
    { value: 'none', label: 'None', description: 'No email notifications for notes' },
  ]

  return (
    <Section title="Note notifications">
      {loading ? (
        <div className="h-16 bg-muted rounded animate-pulse" />
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground mb-3">
            Choose when you receive email notifications about new notes.
          </p>
          {options.map(opt => (
            <label
              key={opt.value}
              className={`flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors ${
                level === opt.value ? 'border-foreground/30 bg-accent/50' : 'hover:bg-accent/30'
              }`}
            >
              <input
                type="radio"
                name="note-notification-level"
                value={opt.value}
                checked={level === opt.value}
                onChange={() => handleLevelChange(opt.value)}
                className="mt-0.5"
              />
              <div>
                <span className="text-sm font-medium">{opt.label}</span>
                <p className="text-xs text-muted-foreground">{opt.description}</p>
              </div>
            </label>
          ))}

          {level === 'mentions' && companies.length > 0 && (
            <div className="mt-3 pt-3 border-t">
              <p className="text-xs font-medium mb-2">Follow companies</p>
              <p className="text-xs text-muted-foreground mb-2">
                Get notified for all notes on these companies, even without an @mention.
              </p>
              <div className="max-h-48 overflow-y-auto space-y-1">
                {companies.map(c => (
                  <label key={c.id} className="flex items-center gap-2 px-2 py-1 rounded hover:bg-accent/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={subscribedIds.includes(c.id)}
                      onChange={() => toggleCompany(c.id)}
                      className="rounded"
                    />
                    <span className="text-sm">{c.name}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {saving && <p className="text-xs text-muted-foreground mt-2">Saving...</p>}
          {saved && <p className="text-xs text-green-600 mt-2">Saved</p>}
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────── Fund Name ────────────────────────────

function FundNameSection({ name, logo, address, onSaved }: { name: string; logo: string | null; address: string | null; onSaved: () => void }) {
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(logo)
  const [logoSaving, setLogoSaving] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)
  const [addressValue, setAddressValue] = useState(address ?? '')
  const [addressSaving, setAddressSaving] = useState(false)
  const [addressSaved, setAddressSaved] = useState(false)

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundName: value }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  const handleLogoFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setLogoError(null)

    if (file.size > 200 * 1024) {
      setLogoError('File must be under 200KB')
      e.target.value = ''
      return
    }

    const reader = new FileReader()
    reader.onload = async () => {
      const dataUrl = reader.result as string
      setLogoPreview(dataUrl)
      setLogoSaving(true)
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundLogo: dataUrl }),
      })
      setLogoSaving(false)
      if (res.ok) {
        onSaved()
      } else {
        setLogoPreview(logo)
        setLogoError('Failed to upload logo')
      }
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleRemoveLogo = async () => {
    setLogoSaving(true)
    setLogoError(null)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fundLogo: null }),
    })
    setLogoSaving(false)
    if (res.ok) {
      setLogoPreview(null)
      onSaved()
    }
  }

  return (
    <Section title="Fund name & logo">
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
        <div className="flex-1">
          <Label>Name</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <Button onClick={handleSave} disabled={saving || value === name} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>

      <div className="mt-4 pt-4 border-t">
        <Label>Logo</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Upload a logo to display in the header. Max 200KB.
        </p>
        <div className="flex items-center gap-3">
          {logoPreview ? (
            <div className="relative">
              <img
                src={logoPreview}
                alt="Fund logo"
                className="h-12 w-12 rounded border object-contain bg-background"
              />
              <button
                onClick={handleRemoveLogo}
                disabled={logoSaving}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full p-0.5 hover:bg-destructive/90 disabled:opacity-50"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <label className="flex items-center gap-2 cursor-pointer border rounded-lg px-3 py-2 text-sm text-muted-foreground hover:bg-accent transition-colors">
              <ImagePlus className="h-4 w-4" />
              Choose file
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoFile}
                className="hidden"
              />
            </label>
          )}
          {logoPreview && (
            <label className="flex items-center gap-2 cursor-pointer text-xs text-muted-foreground hover:text-foreground transition-colors">
              Replace
              <input
                type="file"
                accept="image/*"
                onChange={handleLogoFile}
                className="hidden"
              />
            </label>
          )}
          {logoSaving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </div>
        {logoError && (
          <p className="text-xs text-destructive mt-1 flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {logoError}
          </p>
        )}
      </div>

      <div className="mt-4 pt-4 border-t">
        <Label>Address / Contact Info</Label>
        <p className="text-xs text-muted-foreground mb-2">
          Displayed on investor report PDFs below the fund name.
        </p>
        <textarea
          value={addressValue}
          onChange={e => setAddressValue(e.target.value)}
          rows={3}
          className="w-full border rounded p-2 text-sm bg-background mb-2"
          placeholder="123 Main St&#10;New York, NY 10001&#10;info@fund.com"
        />
        <Button
          size="sm"
          disabled={addressSaving || addressValue === (address ?? '')}
          onClick={async () => {
            setAddressSaving(true)
            const res = await fetch('/api/settings', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fundAddress: addressValue || null }),
            })
            setAddressSaving(false)
            if (res.ok) {
              setAddressSaved(true)
              setTimeout(() => setAddressSaved(false), 2000)
              onSaved()
            }
          }}
        >
          {addressSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : addressSaved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── Claude Key ────────────────────────────

// ──────────────────────────── AI Providers ────────────────────────────

function AIProvidersSection({
  hasClaudeKey, claudeModel, hasOpenAIKey, openaiModel, hasGeminiKey, geminiModel, ollamaBaseUrl, ollamaModel, defaultAIProvider, onSaved,
}: {
  hasClaudeKey: boolean
  claudeModel: string
  hasOpenAIKey: boolean
  openaiModel: string
  hasGeminiKey: boolean
  geminiModel: string
  ollamaBaseUrl: string
  ollamaModel: string
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
            Anthropic (Claude){!hasClaudeKey ? ' — no key configured' : ''}
          </option>
          <option value="openai" disabled={!hasOpenAIKey}>
            OpenAI{!hasOpenAIKey ? ' — no key configured' : ''}
          </option>
          <option value="gemini" disabled={!hasGeminiKey}>
            Google Gemini{!hasGeminiKey ? ' — no key configured' : ''}
          </option>
          <option value="ollama" disabled={!ollamaBaseUrl}>
            Ollama (Local){!ollamaBaseUrl ? ' — not configured' : ''}
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
          label="Google Gemini"
          providerKey="gemini"
          isDefault={defaultProvider === 'gemini'}
          isOpen={openSections.has('gemini')}
          onToggle={() => toggleSection('gemini')}
          hasKey={hasGeminiKey}
        >
          <GeminiKeyContent hasKey={hasGeminiKey} currentModel={geminiModel} onSaved={onSaved} />
        </AIProviderDisclosure>
        <AIProviderDisclosure
          label="Ollama (Local)"
          providerKey="ollama"
          isDefault={defaultProvider === 'ollama'}
          isOpen={openSections.has('ollama')}
          onToggle={() => toggleSection('ollama')}
          hasKey={!!ollamaBaseUrl}
        >
          <OllamaContent baseUrl={ollamaBaseUrl} currentModel={ollamaModel} onSaved={onSaved} />
        </AIProviderDisclosure>
      </div>
    </Section>
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

function GeminiKeyContent({ hasKey, currentModel, onSaved }: { hasKey: boolean; currentModel: string; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')
  const [errorMsg, setErrorMsg] = useState('')

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
      const res = await fetch('/api/gemini-models')
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
    setErrorMsg('')
    const res = await fetch('/api/test-gemini-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: newKey }),
    })
    if (res.ok) {
      setStatus('valid')
    } else {
      const data = await res.json().catch(() => ({}))
      setErrorMsg(data.error || 'Key is invalid')
      setStatus('invalid')
    }
    setTesting(false)
  }

  const saveKey = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ geminiApiKey: newKey }),
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
      body: JSON.stringify({ geminiModel: modelId }),
    })
    setModelSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <>
      <p className="text-xs text-muted-foreground mb-3">
        {hasKey
          ? 'A Gemini API key is configured. Enter a new key below to replace it.'
          : 'No Gemini API key configured. Add one to enable Google Gemini as an AI provider.'}
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>API key</Label>
          <Input type="password" value={newKey} onChange={(e) => { setNewKey(e.target.value); setStatus('idle') }} placeholder="AIza..." />
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
      {status === 'invalid' && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {errorMsg}</p>}
      {status === 'saved' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Key updated</p>}

      {hasKey && (
        <div className="mt-4 pt-4 border-t">
          <Label>Model</Label>
          <p className="text-xs text-muted-foreground mb-2">Choose which Gemini model to use.</p>
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

function OllamaContent({ baseUrl, currentModel, onSaved }: { baseUrl: string; currentModel: string; onSaved: () => void }) {
  const [url, setUrl] = useState(baseUrl || 'http://localhost:11434/v1')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testStatus, setTestStatus] = useState<'idle' | 'ok' | 'error'>('idle')
  const [testError, setTestError] = useState('')

  const [models, setModels] = useState<{ id: string; name: string }[]>([])
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState(currentModel)
  const [modelSaving, setModelSaving] = useState(false)

  useEffect(() => { setUrl(baseUrl || 'http://localhost:11434/v1') }, [baseUrl])
  useEffect(() => { setSelectedModel(currentModel) }, [currentModel])

  const testConnection = async () => {
    setTesting(true)
    setTestStatus('idle')
    setTestError('')
    try {
      const res = await fetch('/api/test-ollama', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: url }),
      })
      if (res.ok) {
        setTestStatus('ok')
        fetchModels()
      } else {
        const data = await res.json()
        setTestStatus('error')
        setTestError(data.error || 'Connection failed')
      }
    } catch {
      setTestStatus('error')
      setTestError('Connection failed')
    }
    setTesting(false)
  }

  const saveUrl = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ollamaBaseUrl: url }),
    })
    setSaving(false)
    if (res.ok) onSaved()
  }

  const fetchModels = async () => {
    setModelsLoading(true)
    setModelsError(null)
    try {
      const res = await fetch('/api/ollama-models')
      const data = await res.json()
      if (data.error) setModelsError(data.error)
      setModels(data.models ?? [])
    } catch {
      setModelsError('Failed to fetch models')
    } finally {
      setModelsLoading(false)
    }
  }

  const saveModel = async (modelId: string) => {
    setSelectedModel(modelId)
    setModelSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ollamaModel: modelId }),
    })
    setModelSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <>
      <p className="text-xs text-muted-foreground mb-3">
        Connect to a local Ollama instance. No API key needed — models run on your machine.
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>Base URL</Label>
          <Input value={url} onChange={(e) => { setUrl(e.target.value); setTestStatus('idle') }} placeholder="http://localhost:11434/v1" />
        </div>
        <div className="flex gap-2">
          <Button onClick={testConnection} disabled={!url.trim() || testing} variant="outline" size="sm">
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Test'}
          </Button>
          <Button onClick={saveUrl} disabled={!url.trim() || saving} size="sm">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save'}
          </Button>
        </div>
      </div>
      {testStatus === 'ok' && <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1"><Check className="h-3 w-3" /> Connected</p>}
      {testStatus === 'error' && <p className="text-xs text-destructive mt-1 flex items-center gap-1"><AlertCircle className="h-3 w-3" /> {testError}</p>}

      <div className="mt-4 pt-4 border-t">
        <Label>Model</Label>
        <p className="text-xs text-muted-foreground mb-2">Choose which Ollama model to use. Test the connection first to load available models.</p>
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
    </>
  )
}

// ──────────────────────────── AI Summary Prompt ────────────────────────────

const DEFAULT_AI_SUMMARY_PROMPT = `Write a concise analyst summary covering:

1. **Current Status** — How is the company performing right now? Reference specific numbers.
2. **Trends** — What direction are the key metrics heading? Growth rates, acceleration or deceleration.
3. **Progress & Positives** — What's going well? Milestones, improvements, or strong execution.
4. **Challenges & Risks** — What concerns you? Declining metrics, missing data, red flags.
5. **Key Follow-ups** — What should the investment team ask about or monitor next?

Keep it to 2-4 short paragraphs. Be direct and analytical, not promotional. Use specific numbers. Do not use markdown formatting — write in plain prose paragraphs.`

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
            <li>App name & support email — fill in anything</li>
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
            <Button size="sm" variant="outline" onClick={() => { setShowPicker(false); setFolderError(null) }}>
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
    setBreadcrumbs([{ id: null, name: 'My Drive' }])
    setFolderError(null)
    loadFolders()
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
                        <Button size="sm" variant="outline" onClick={() => { setPickerCompanyId(null); setFolderError(null) }}>
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
  dropboxConnected,
  hasDropboxCredentials,
  dropboxAppKey,
  dropboxFolderPath,
  onChanged,
}: {
  fundId: string
  fileStorageProvider: string | null
  googleDriveConnected: boolean
  googleDriveFolderId: string | null
  googleDriveFolderName: string | null
  hasGoogleCredentials: boolean
  googleClientId: string
  dropboxConnected: boolean
  hasDropboxCredentials: boolean
  dropboxAppKey: string
  dropboxFolderPath: string | null
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
        All portfolio data, company details, metrics, and email content are stored in the database (Supabase/PostgreSQL). By default, email attachments are also stored in the database. Optionally, connect Google Drive or Dropbox to store portfolio reports and attachments externally.
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
              <option value="dropbox">Dropbox</option>
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

        {selectedProvider === 'dropbox' && (
          <div className="border-t pt-4">
            <DropboxSection
              fundId={fundId}
              connected={dropboxConnected}
              hasCredentials={hasDropboxCredentials}
              appKey={dropboxAppKey}
              folderPath={dropboxFolderPath}
              onChanged={onChanged}
            />
          </div>
        )}
      </div>
    </Section>
  )
}

// ──────────────────────────── Dropbox ────────────────────────────

function DropboxSection({
  fundId,
  connected,
  hasCredentials,
  appKey: existingAppKey,
  folderPath,
  onChanged,
}: {
  fundId: string
  connected: boolean
  hasCredentials: boolean
  appKey: string
  folderPath: string | null
  onChanged: () => void
}) {
  const [editingCreds, setEditingCreds] = useState(!hasCredentials)
  const [newAppKey, setNewAppKey] = useState(existingAppKey)
  const [newAppSecret, setNewAppSecret] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [credsSaved, setCredsSaved] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [newFolderPath, setNewFolderPath] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [showFolderInput, setShowFolderInput] = useState(false)

  useEffect(() => { setNewAppKey(existingAppKey) }, [existingAppKey])
  useEffect(() => { if (hasCredentials && editingCreds && credsSaved) setEditingCreds(false) }, [hasCredentials, editingCreds, credsSaved])

  const saveCredentials = async () => {
    if (!newAppKey.trim() || !newAppSecret.trim()) return
    setSavingCreds(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dropboxAppKey: newAppKey.trim(),
        dropboxAppSecret: newAppSecret.trim(),
      }),
    })
    setSavingCreds(false)
    if (res.ok) {
      setNewAppSecret('')
      setEditingCreds(false)
      setCredsSaved(true)
      setTimeout(() => setCredsSaved(false), 2000)
      onChanged()
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    const res = await fetch('/api/settings/dropbox', { method: 'DELETE' })
    setDisconnecting(false)
    if (res.ok) onChanged()
  }

  const createFolder = async () => {
    if (!newFolderPath.trim()) return
    setCreatingFolder(true)
    setFolderError(null)
    const res = await fetch('/api/settings/dropbox/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderPath: newFolderPath.trim() }),
    })
    setCreatingFolder(false)
    if (res.ok) {
      setNewFolderPath('')
      setShowFolderInput(false)
      onChanged()
    } else {
      const data = await res.json().catch(() => ({}))
      setFolderError(data.error || 'Failed to create folder')
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">Dropbox</p>

      {/* Credentials section */}
      {(editingCreds || !hasCredentials) ? (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Create a Dropbox app at{' '}
            <a href="https://www.dropbox.com/developers/apps" target="_blank" rel="noopener noreferrer" className="underline">
              Dropbox App Console
            </a>
            . Add <code className="text-[11px] bg-muted px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/dropbox/callback</code> as a redirect URI.
          </p>
          <div>
            <Label>App key</Label>
            <Input
              value={newAppKey}
              onChange={(e) => setNewAppKey(e.target.value)}
              placeholder="Dropbox app key"
            />
          </div>
          <div>
            <Label>App secret</Label>
            <Input
              type="password"
              value={newAppSecret}
              onChange={(e) => setNewAppSecret(e.target.value)}
              placeholder="Dropbox app secret"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveCredentials} disabled={savingCreds || !newAppKey.trim() || !newAppSecret.trim()}>
              {savingCreds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save credentials'}
            </Button>
            {hasCredentials && (
              <Button size="sm" variant="outline" onClick={() => setEditingCreds(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground flex-1">
            Dropbox credentials configured.
            {credsSaved && <span className="text-emerald-600 ml-1">Saved!</span>}
          </p>
          <Button size="sm" variant="outline" onClick={() => setEditingCreds(true)} className="text-xs h-7">
            Update credentials
          </Button>
        </div>
      )}

      {/* Connection section */}
      {hasCredentials && !connected && (
        <Button size="sm" onClick={() => { window.location.href = '/api/auth/dropbox' }}>
          Connect Dropbox account
        </Button>
      )}

      {connected && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Check className="h-4 w-4 text-green-600 shrink-0" />
            <span>Dropbox account connected.</span>
          </div>

          {/* Folder management */}
          {folderPath ? (
            <div className="flex items-center gap-2 text-sm">
              <FolderOpen className="h-4 w-4 text-muted-foreground" />
              <span>Saving to: <span className="font-medium">{folderPath}</span></span>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No folder selected. Set a folder path to start saving reports.
            </p>
          )}

          {showFolderInput ? (
            <div className="border rounded-lg p-3 space-y-3">
              <div>
                <Label>Folder path</Label>
                <Input
                  value={newFolderPath}
                  onChange={(e) => { setNewFolderPath(e.target.value); setFolderError(null) }}
                  placeholder="/Portfolio Reports"
                  onKeyDown={(e) => { if (e.key === 'Enter') createFolder() }}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  A folder at this path will be created in your Dropbox. If it already exists, the existing folder will be used.
                </p>
              </div>
              {folderError && (
                <p className="text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="h-3 w-3" /> {folderError}
                </p>
              )}
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => { setShowFolderInput(false); setFolderError(null) }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={createFolder} disabled={creatingFolder || !newFolderPath.trim()}>
                  {creatingFolder ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                  {folderPath ? 'Update folder' : 'Set folder'}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setShowFolderInput(true)}>
                {folderPath ? 'Change folder' : 'Set folder'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="text-destructive hover:text-destructive"
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unlink className="h-3.5 w-3.5 mr-1" />}
                Disconnect
              </Button>
            </div>
          )}

          {folderPath && (
            <DropboxCompanyFolders fundId={fundId} />
          )}
        </div>
      )}
    </div>
  )
}

function DropboxCompanyFolders({ fundId }: { fundId: string }) {
  const [expanded, setExpanded] = useState(false)
  const [companies, setCompanies] = useState<{ id: string; name: string; dropbox_folder_path: string | null }[]>([])
  const [loading, setLoading] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editPath, setEditPath] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const loadCompanies = async () => {
    setLoading(true)
    const res = await fetch('/api/companies')
    if (res.ok) {
      const data = await res.json()
      const detailed = await Promise.all(
        data.map(async (c: { id: string; name: string }) => {
          const r = await fetch(`/api/companies/${c.id}`)
          if (r.ok) {
            const d = await r.json()
            return { id: d.id, name: d.name, dropbox_folder_path: d.dropbox_folder_path ?? null }
          }
          return { id: c.id, name: c.name, dropbox_folder_path: null }
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

  const startEdit = (companyId: string, currentPath: string | null) => {
    setEditingId(companyId)
    setEditPath(currentPath || '')
  }

  const savePath = async (companyId: string) => {
    setSaving(companyId)
    const res = await fetch(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropbox_folder_path: editPath.trim() || null }),
    })
    setSaving(null)
    if (res.ok) {
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, dropbox_folder_path: editPath.trim() || null } : c))
      setEditingId(null)
    }
  }

  const clearPath = async (companyId: string) => {
    setSaving(companyId)
    const res = await fetch(`/api/companies/${companyId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropbox_folder_path: null }),
    })
    setSaving(null)
    if (res.ok) {
      setCompanies(prev => prev.map(c => c.id === companyId ? { ...c, dropbox_folder_path: null } : c))
    }
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
                      {editingId === c.id ? (
                        <div className="flex items-center gap-1">
                          <Input
                            value={editPath}
                            onChange={(e) => setEditPath(e.target.value)}
                            placeholder="/Custom/Path"
                            className="h-7 text-xs w-48"
                            onKeyDown={(e) => { if (e.key === 'Enter') savePath(c.id) }}
                          />
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => savePath(c.id)} disabled={saving === c.id}>
                            {saving === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : c.dropbox_folder_path ? (
                        <>
                          <span className="text-xs text-muted-foreground truncate max-w-[200px]">{c.dropbox_folder_path}</span>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startEdit(c.id, c.dropbox_folder_path)}>
                            Change
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => clearPath(c.id)} disabled={saving === c.id}>
                            {saving === c.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                          </Button>
                        </>
                      ) : (
                        <>
                          <span className="text-xs text-muted-foreground">Default (auto-created)</span>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => startEdit(c.id, null)}>
                            Set path
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
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
                    Must be a verified sender address for your email provider.{systemProvider === 'gmail' ? ' Ignored when using Gmail — emails are sent from your connected Google account.' : ''}
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

// ──────────────────────────── Signup Whitelist ────────────────────────────

interface WhitelistEntry {
  id: string
  email_pattern: string
  created_at: string
}

const AUTH_EMAIL_TEMPLATES = [
  { name: 'Confirm signup', file: 'confirmation.html', desc: 'Sent when a user signs up' },
  { name: 'Invite user', file: 'invite.html', desc: 'Sent when an admin invites someone' },
  { name: 'Magic link', file: 'magic_link.html', desc: 'Passwordless sign-in link' },
  { name: 'Reset password', file: 'recovery.html', desc: 'Password reset request' },
  { name: 'Change email', file: 'email_change.html', desc: 'Confirm new email address' },
  { name: 'Reauthentication', file: 'reauthentication.html', desc: 'OTP code for re-verification' },
  { name: 'Password changed', file: 'password_changed.html', desc: 'Security notification' },
  { name: 'Email changed', file: 'email_changed.html', desc: 'Security notification' },
  { name: 'MFA added', file: 'mfa_factor_enrolled.html', desc: 'Security notification' },
  { name: 'MFA removed', file: 'mfa_factor_unenrolled.html', desc: 'Security notification' },
]

function AuthEmailTemplatesSection() {
  const [showGuide, setShowGuide] = useState(false)

  return (
    <Section title="Authentication">
      <p className="text-xs text-muted-foreground mb-3">
        Email/password authentication is handled by Supabase Auth. This install includes preconfigured email templates for all authentication emails — signup confirmation, invitations, password reset, magic links, email change, and security notifications.
      </p>

      {showGuide ? (
        <div className="space-y-3">
          <button onClick={() => setShowGuide(false)} className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
            <ChevronDown className="h-3 w-3" /> Setup instructions
          </button>

          <div className="text-xs text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">If self-hosting with Supabase CLI:</p>
            <p>Templates are applied automatically from <code className="text-[11px] bg-muted px-1 rounded font-mono">templates/</code> via <code className="text-[11px] bg-muted px-1 rounded font-mono">config.toml</code> — no action needed.</p>

            <p className="font-medium text-foreground pt-2">If using hosted Supabase (dashboard):</p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Go to your Supabase project dashboard → <strong>Authentication</strong> → <strong>Email Templates</strong></li>
              <li>For each template type, copy the HTML from the corresponding file in <code className="text-[11px] bg-muted px-1 rounded font-mono">templates/</code></li>
              <li>Update the subject line to match</li>
            </ol>

            <p className="font-medium text-foreground pt-2">SMTP provider:</p>
            <p>
              To send real emails, configure an SMTP provider in your Supabase dashboard under <strong>Project Settings → Auth → SMTP Settings</strong>, or in <code className="text-[11px] bg-muted px-1 rounded font-mono">config.toml</code> under <code className="text-[11px] bg-muted px-1 rounded font-mono">[auth.email.smtp]</code>.
            </p>

            <p className="font-medium text-foreground pt-2">Auth hook (signup whitelist):</p>
            <p>
              A <code className="text-[11px] bg-muted px-1 rounded font-mono">before-user-created</code> auth hook enforces the signup whitelist at the database level, preventing direct signups that bypass the API.
            </p>
            <ol className="list-decimal list-inside space-y-1">
              <li>Run the migration in <code className="text-[11px] bg-muted px-1 rounded font-mono">migrations/20260306120000_before_user_created_hook.sql</code></li>
              <li>Go to <strong>Authentication → Hooks</strong> in your Supabase dashboard</li>
              <li>Enable <strong>Before User Created</strong>, select <strong>Postgres Function</strong>, and choose <code className="text-[11px] bg-muted px-1 rounded font-mono">hook_before_user_created</code></li>
            </ol>
          </div>

          <div className="border rounded-md overflow-hidden mt-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-3 py-1.5 font-medium">Template</th>
                  <th className="text-left px-3 py-1.5 font-medium">File</th>
                  <th className="text-left px-3 py-1.5 font-medium hidden sm:table-cell">Description</th>
                </tr>
              </thead>
              <tbody>
                {AUTH_EMAIL_TEMPLATES.map((t) => (
                  <tr key={t.file} className="border-b last:border-0">
                    <td className="px-3 py-1.5">{t.name}</td>
                    <td className="px-3 py-1.5 font-mono text-[11px] text-muted-foreground">{t.file}</td>
                    <td className="px-3 py-1.5 text-muted-foreground hidden sm:table-cell">{t.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-muted-foreground">
            <a
              href="https://supabase.com/docs/guides/local-development/customizing-email-templates"
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-4 hover:text-foreground"
            >
              Supabase email template docs
            </a>
          </p>
        </div>
      ) : (
        <button onClick={() => setShowGuide(true)} className="text-xs text-muted-foreground hover:text-foreground underline">
          Setup instructions
        </button>
      )}
    </Section>
  )
}

function WhitelistSection() {
  const [entries, setEntries] = useState<WhitelistEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [pattern, setPattern] = useState('')
  const [adding, setAdding] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/whitelist')
    if (res.ok) {
      const data = await res.json()
      setEntries(data.entries)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!pattern.trim()) return
    setAdding(true)
    setError(null)
    const res = await fetch('/api/settings/whitelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailPattern: pattern }),
    })
    setAdding(false)
    if (res.ok) {
      setPattern('')
      load()
    } else {
      const data = await res.json()
      setError(data.error)
    }
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    const res = await fetch(`/api/settings/whitelist/${id}`, { method: 'DELETE' })
    setDeletingId(null)
    if (res.ok) load()
  }

  return (
    <Section title="Signup whitelist">
      <p className="text-xs text-muted-foreground mb-3">
        Only these emails or domains can create accounts. Use <code className="text-[11px] bg-muted px-1 rounded">*@domain.com</code> to allow an entire domain.
      </p>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
        </div>
      ) : (
        <>
          {entries.length > 0 && (
            <div className="border rounded-lg divide-y mb-3">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm font-mono">{e.email_pattern}</span>
                  <button
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
            <div className="flex-1">
              <Label>Email or domain pattern</Label>
              <Input
                value={pattern}
                onChange={(e) => { setPattern(e.target.value); setError(null) }}
                placeholder="user@example.com or *@example.com"
                onKeyDown={(e) => { if (e.key === 'Enter') handleAdd() }}
              />
            </div>
            <Button onClick={handleAdd} disabled={adding || !pattern.trim()} size="sm">
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            </Button>
          </div>
          {error && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1">
              <AlertCircle className="h-3 w-3" /> {error}
            </p>
          )}
        </>
      )}
    </Section>
  )
}

// ──────────────────────────── Team ────────────────────────────

interface Member {
  id: string
  userId: string
  email: string
  role: string
  createdAt: string
}

interface JoinRequest {
  id: string
  email: string
  createdAt: string
}

function TeamSection({ isAdmin }: { isAdmin: boolean }) {
  const [members, setMembers] = useState<Member[]>([])
  const [pendingRequests, setPendingRequests] = useState<JoinRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [processingId, setProcessingId] = useState<string | null>(null)
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/members')
    if (res.ok) {
      const data = await res.json()
      setMembers(data.members)
      setPendingRequests(data.pendingRequests)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const handleRequest = async (requestId: string, action: 'approve' | 'reject') => {
    setProcessingId(requestId)
    const res = await fetch(`/api/settings/members/${requestId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setProcessingId(null)
    if (res.ok) load()
  }

  const handleRemove = async (memberId: string) => {
    setProcessingId(memberId)
    const res = await fetch(`/api/settings/members/${memberId}`, { method: 'DELETE' })
    setProcessingId(null)
    setConfirmRemoveId(null)
    if (res.ok) load()
  }

  return (
    <Section title="Team">
      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading...
        </div>
      ) : (
        <div className="space-y-4">
          {/* Members list */}
          <div className="border rounded-lg divide-y">
            {members.map(m => (
              <div key={m.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-sm">{m.email}</span>
                <div className="flex items-center gap-2">
                  {m.role === 'admin' ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-primary/10 text-primary rounded-full px-2 py-0.5">
                      <Shield className="h-2.5 w-2.5" />
                      Admin
                    </span>
                  ) : (
                    <>
                      <span className="text-xs text-muted-foreground">Member</span>
                      {isAdmin && confirmRemoveId === m.id ? (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => handleRemove(m.id)}
                            disabled={processingId === m.id}
                            className="h-6 text-[11px] px-2"
                          >
                            {processingId === m.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Confirm'}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setConfirmRemoveId(null)}
                            className="h-6 text-[11px] px-2"
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : isAdmin ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setConfirmRemoveId(m.id)}
                          className="h-6 text-[11px] px-2 text-muted-foreground hover:text-destructive"
                        >
                          Remove
                        </Button>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Pending requests (admin only) */}
          {isAdmin && pendingRequests.length > 0 && (
            <div>
              <p className="text-xs font-medium mb-2">Pending requests</p>
              <div className="border rounded-lg divide-y">
                {pendingRequests.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-3 py-2">
                    <div>
                      <span className="text-sm">{r.email}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {new Date(r.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleRequest(r.id, 'reject')}
                        disabled={processingId === r.id}
                        className="h-7 text-xs"
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => handleRequest(r.id, 'approve')}
                        disabled={processingId === r.id}
                        className="h-7 text-xs"
                      >
                        {processingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Approve'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────── Danger Zone ────────────────────────────

function DangerZone({ onDeleted }: { onDeleted: () => void }) {
  const [open, setOpen] = useState(false)
  const [confirm, setConfirm] = useState('')
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    setDeleting(true)
    const res = await fetch('/api/settings', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm }),
    })
    setDeleting(false)
    if (res.ok) {
      setOpen(false)
      onDeleted()
    }
  }

  return (
    <div className="rounded-lg border border-destructive/30 p-5">
      <h2 className="text-sm font-medium text-destructive mb-1 flex items-center gap-1.5"><Lock className="h-3 w-3 text-destructive" />Danger zone</h2>
      <p className="text-xs text-muted-foreground mb-3">
        Permanently delete your fund and all associated data. This cannot be undone.
      </p>
      <Button variant="destructive" size="sm" onClick={() => setOpen(true)}>
        Delete all data
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all data</DialogTitle>
            <DialogDescription>
              This will permanently delete your fund, all companies, metrics, emails, and reviews. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          <div>
            <Label>
              Type <code className="text-xs bg-muted px-1 rounded">DELETE ALL DATA</code> to confirm
            </Label>
            <Input
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="DELETE ALL DATA"
              className="mt-1"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={confirm !== 'DELETE ALL DATA' || deleting}
              onClick={handleDelete}
            >
              {deleting ? 'Deleting...' : 'Delete everything'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ──────────────────────────── Analytics ────────────────────────────

function AnalyticsSection({
  fathomSiteId,
  gaMeasurementId,
  onSaved,
}: {
  fathomSiteId: string | null
  gaMeasurementId: string | null
  onSaved: () => void
}) {
  const [fathom, setFathom] = useState(fathomSiteId ?? '')
  const [ga, setGa] = useState(gaMeasurementId ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const hasChanges =
    fathom !== (fathomSiteId ?? '') ||
    ga !== (gaMeasurementId ?? '')

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analyticsFathomSiteId: fathom,
        analyticsGaMeasurementId: ga,
      }),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    }
  }

  return (
    <Section title="Analytics tracking">
      <p className="text-xs text-muted-foreground mb-4">
        Add analytics scripts to your app. These are rendered on authenticated pages only.
      </p>
      <div className="space-y-4">
        <div>
          <Label>Fathom Site ID</Label>
          <Input
            value={fathom}
            onChange={(e) => setFathom(e.target.value)}
            placeholder="ABCDEFGH"
            className="max-w-xs font-mono mt-1"
          />
        </div>
        <div>
          <Label>Google Analytics Measurement ID</Label>
          <Input
            value={ga}
            onChange={(e) => setGa(e.target.value)}
            placeholder="G-XXXXXXXXXX"
            className="max-w-xs font-mono mt-1"
          />
        </div>
        <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}

// ──────────────────────────── Usage Tracking ────────────────────────────

function UsageTrackingSection({
  disableUserTracking,
  onSaved,
}: {
  disableUserTracking: boolean
  onSaved: () => void
}) {
  const [disabled, setDisabled] = useState(disableUserTracking)
  const [saving, setSaving] = useState(false)

  const handleToggle = async (checked: boolean) => {
    setDisabled(checked)
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ disableUserTracking: checked }),
    })
    setSaving(false)
    if (res.ok) onSaved()
  }

  return (
    <Section title="Usage tracking">
      <p className="text-xs text-muted-foreground mb-4">
        AI token usage is always tracked to help you monitor costs. User activity tracking (logins, actions, and the activity feed on the Usage page) can be turned off if you prefer not to log individual user actions.
      </p>
      <div className="flex items-center gap-3">
        <Switch
          checked={disabled}
          onCheckedChange={handleToggle}
          disabled={saving}
        />
        <Label className="text-sm font-normal">
          Disable user activity tracking
        </Label>
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      </div>
    </Section>
  )
}

// ──────────────────────────── Shared ────────────────────────────

function GroupHeader({ label }: { label: string }) {
  const isAdminSection = useContext(AdminSectionContext)
  const lineColor = isAdminSection ? 'bg-amber-500/30' : 'bg-border'
  return (
    <div className="flex items-center gap-3 pt-2">
      <div className={`h-px flex-1 ${lineColor}`} />
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
        {isAdminSection && <Lock className="h-2.5 w-2.5 text-amber-500" />}
        {label}
      </span>
      <div className={`h-px flex-1 ${lineColor}`} />
    </div>
  )
}

function InfoSection({ title, description }: { title: string; description: string }) {
  const isAdminSection = useContext(AdminSectionContext)
  return (
    <div className={`rounded-lg border bg-card p-5 ${isAdminSection ? 'border-amber-500/30' : ''}`}>
      <h2 className="text-sm font-medium mb-1 flex items-center gap-1.5">
        {isAdminSection && <Lock className="h-3 w-3 text-amber-500" />}
        {title}
      </h2>
      <p className="text-xs text-muted-foreground">{description}</p>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const isAdminSection = useContext(AdminSectionContext)
  return (
    <div className={`rounded-lg border bg-card p-5 ${isAdminSection ? 'border-amber-500/30' : ''}`}>
      <h2 className="text-sm font-medium mb-3 flex items-center gap-1.5">
        {isAdminSection && <Lock className="h-3 w-3 text-amber-500" />}
        {title}
      </h2>
      {children}
    </div>
  )
}
