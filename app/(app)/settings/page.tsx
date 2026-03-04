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
import { AlertCircle, Check, ChevronDown, Loader2, Plus, Trash2, Copy, FolderOpen, Unlink, Shield, ImagePlus, X, Lock } from 'lucide-react'
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
  postmarkInboundAddress: string
  postmarkWebhookToken: string
  hasClaudeKey: boolean
  claudeModel: string
  hasOpenAIKey: boolean
  openaiModel: string
  defaultAIProvider: string
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
  currency: string
  displayName: string
  isAdmin: boolean
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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <AnalystToggleButton />
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
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <AnalystToggleButton />
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
          <FundNameSection name={settings.fundName} logo={settings.fundLogo} onSaved={load} />
          <CurrencySection currency={settings.currency} onSaved={load} />
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
            defaultAIProvider={settings.defaultAIProvider}
            onSaved={load}
          />
          <AiSummaryPromptSection currentPrompt={settings.aiSummaryPrompt} onSaved={load} />

          <GroupHeader label="Storage" />
          <StorageSection
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
            customHeadScript={settings.analyticsCustomHeadScript}
            onSaved={load}
          />
          <GroupHeader label="Access Control" />
          <InfoSection
            title="Authentication"
            description="Prebuilt for Supabase Auth. Email/password authentication is handled by Supabase. To enable email confirmations and password resets, configure an SMTP provider in your Supabase project dashboard under Authentication > Email Templates."
          />
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

function FundNameSection({ name, logo, onSaved }: { name: string; logo: string | null; onSaved: () => void }) {
  const [value, setValue] = useState(name)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [logoPreview, setLogoPreview] = useState<string | null>(logo)
  const [logoSaving, setLogoSaving] = useState(false)
  const [logoError, setLogoError] = useState<string | null>(null)

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
    </Section>
  )
}

// ──────────────────────────── Claude Key ────────────────────────────

// ──────────────────────────── AI Providers ────────────────────────────

function AIProvidersSection({
  hasClaudeKey, claudeModel, hasOpenAIKey, openaiModel, defaultAIProvider, onSaved,
}: {
  hasClaudeKey: boolean
  claudeModel: string
  hasOpenAIKey: boolean
  openaiModel: string
  defaultAIProvider: string
  onSaved: () => void
}) {
  const [defaultProvider, setDefaultProvider] = useState(defaultAIProvider)
  const [savingDefault, setSavingDefault] = useState(false)

  useEffect(() => { setDefaultProvider(defaultAIProvider) }, [defaultAIProvider])

  const saveDefaultProvider = async (value: string) => {
    setDefaultProvider(value)
    setSavingDefault(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultAIProvider: value }),
    })
    setSavingDefault(false)
    if (res.ok) onSaved()
  }

  return (
    <>
      <Section title="Default AI provider">
        <p className="text-xs text-muted-foreground mb-3">
          Choose which AI provider to use by default for report parsing, summaries, and imports.
          Configure at least one provider below.
        </p>
        <div className="flex items-center gap-2">
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
          </select>
          {savingDefault && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
        </div>
      </Section>

      <ClaudeKeySection hasKey={hasClaudeKey} currentModel={claudeModel} onSaved={onSaved} />
      <OpenAIKeySection hasKey={hasOpenAIKey} currentModel={openaiModel} onSaved={onSaved} />
    </>
  )
}

function ClaudeKeySection({ hasKey, currentModel, onSaved }: { hasKey: boolean; currentModel: string; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')

  // Model selector state
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

  useEffect(() => {
    setSelectedModel(currentModel)
  }, [currentModel])

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
      setModelsFetched(false) // re-fetch models with new key
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
    <Section title="Claude API key">
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
      {status === 'valid' && (
        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> Key is valid
        </p>
      )}
      {status === 'invalid' && (
        <p className="text-xs text-destructive mt-1 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> Key is invalid
        </p>
      )}
      {status === 'saved' && (
        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> Key updated
        </p>
      )}

      {hasKey && (
        <div className="mt-4 pt-4 border-t">
          <Label>Model</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Choose which Claude model to use for report parsing, summaries, and imports.
          </p>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models…
            </div>
          ) : modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : (
            <div className="flex items-center gap-2">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedModel}
                onChange={(e) => saveModel(e.target.value)}
                disabled={modelSaving}
              >
                {models.length === 0 && (
                  <option value={selectedModel}>{selectedModel}</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.id})
                  </option>
                ))}
              </select>
              {modelSaving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            </div>
          )}
        </div>
      )}
    </Section>
  )
}

// ──────────────────────────── OpenAI Key ────────────────────────────

function OpenAIKeySection({ hasKey, currentModel, onSaved }: { hasKey: boolean; currentModel: string; onSaved: () => void }) {
  const [newKey, setNewKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'valid' | 'invalid' | 'saved'>('idle')

  // Model selector state
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

  useEffect(() => {
    if (hasKey) fetchModels()
  }, [hasKey, fetchModels])

  useEffect(() => {
    setSelectedModel(currentModel)
  }, [currentModel])

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
    <Section title="OpenAI API key">
      <p className="text-xs text-muted-foreground mb-3">
        {hasKey
          ? 'An OpenAI API key is configured. Enter a new key below to replace it.'
          : 'No OpenAI API key configured. Add one to enable OpenAI as an AI provider.'}
      </p>
      <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-2">
        <div className="flex-1">
          <Label>API key</Label>
          <Input
            type="password"
            value={newKey}
            onChange={(e) => { setNewKey(e.target.value); setStatus('idle') }}
            placeholder="sk-..."
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
      {status === 'valid' && (
        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> Key is valid
        </p>
      )}
      {status === 'invalid' && (
        <p className="text-xs text-destructive mt-1 flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> Key is invalid
        </p>
      )}
      {status === 'saved' && (
        <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
          <Check className="h-3 w-3" /> Key updated
        </p>
      )}

      {hasKey && (
        <div className="mt-4 pt-4 border-t">
          <Label>Model</Label>
          <p className="text-xs text-muted-foreground mb-2">
            Choose which OpenAI model to use for report parsing, summaries, and imports.
          </p>
          {modelsLoading ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading models…
            </div>
          ) : modelsError ? (
            <p className="text-xs text-destructive">{modelsError}</p>
          ) : (
            <div className="flex items-center gap-2">
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                value={selectedModel}
                onChange={(e) => saveModel(e.target.value)}
                disabled={modelSaving}
              >
                {models.length === 0 && (
                  <option value={selectedModel}>{selectedModel}</option>
                )}
                {models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
              {modelSaving && <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />}
            </div>
          )}
        </div>
      )}
    </Section>
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
  const [newClientId, setNewClientId] = useState(existingClientId)
  const [newClientSecret, setNewClientSecret] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)
  const [credsSaved, setCredsSaved] = useState(false)

  // Keep in sync if parent refreshes
  useEffect(() => { setNewClientId(existingClientId) }, [existingClientId])
  useEffect(() => { if (hasCredentials && editingCreds && credsSaved) setEditingCreds(false) }, [hasCredentials, editingCreds, credsSaved])

  const saveCredentials = async () => {
    if (!newClientId.trim() || !newClientSecret.trim()) return
    setSavingCreds(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        googleClientId: newClientId.trim(),
        googleClientSecret: newClientSecret.trim(),
      }),
    })
    setSavingCreds(false)
    if (res.ok) {
      setNewClientSecret('')
      setEditingCreds(false)
      setCredsSaved(true)
      setTimeout(() => setCredsSaved(false), 2000)
      onChanged()
    }
  }

  const handleDisconnect = async () => {
    const res = await fetch('/api/settings/drive', { method: 'DELETE' })
    if (res.ok) onChanged()
  }

  if (connected) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm">
          <Check className="h-4 w-4 text-green-600 shrink-0" />
          <span>Google account connected.</span>
        </div>
        {(editingCreds && hasCredentials) ? (
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
            <div className="flex gap-2">
              <Button size="sm" onClick={saveCredentials} disabled={savingCreds || !newClientId.trim() || !newClientSecret.trim()}>
                {savingCreds ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Save credentials'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditingCreds(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-xs text-muted-foreground flex-1">
              Google credentials configured.
              {credsSaved && <span className="text-emerald-600 ml-1">Saved!</span>}
            </p>
            <Button size="sm" variant="outline" onClick={() => setEditingCreds(true)} className="text-xs h-7">
              Update credentials
            </Button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {(editingCreds || !hasCredentials) ? (
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
          <p className="text-xs text-muted-foreground">
            Create credentials at{' '}
            <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noopener noreferrer" className="underline">
              Google Cloud Console
            </a>
            . Add <code className="text-[11px] bg-muted px-1 rounded">{typeof window !== 'undefined' ? window.location.origin : ''}/api/auth/google/callback</code> as an authorized redirect URI.
          </p>
          <div className="flex gap-2">
            <Button size="sm" onClick={saveCredentials} disabled={savingCreds || !newClientId.trim() || !newClientSecret.trim()}>
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
            Google credentials configured.
            {credsSaved && <span className="text-emerald-600 ml-1">Saved!</span>}
          </p>
          <Button size="sm" variant="outline" onClick={() => setEditingCreds(true)} className="text-xs h-7">
            Update credentials
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
  connected,
  folderId,
  folderName,
  hasCredentials,
  clientId,
  onChanged,
}: {
  connected: boolean
  folderId: string | null
  folderName: string | null
  hasCredentials: boolean
  clientId: string
  onChanged: () => void
}) {
  const [disconnecting, setDisconnecting] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')
  const [creatingFolder, setCreatingFolder] = useState(false)
  const [folderError, setFolderError] = useState<string | null>(null)
  const [showFolderInput, setShowFolderInput] = useState(false)

  const createFolder = async () => {
    if (!newFolderName.trim()) return
    setCreatingFolder(true)
    setFolderError(null)
    const res = await fetch('/api/settings/drive/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folderName: newFolderName.trim() }),
    })
    setCreatingFolder(false)
    if (res.ok) {
      setNewFolderName('')
      setShowFolderInput(false)
      onChanged()
    } else {
      const data = await res.json().catch(() => ({}))
      setFolderError(data.error || 'Failed to create folder')
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    const res = await fetch('/api/settings/drive', { method: 'DELETE' })
    setDisconnecting(false)
    if (res.ok) onChanged()
  }

  if (!connected) {
    return (
      <div className="space-y-3">
        <p className="text-xs font-medium">Google Drive</p>
        <p className="text-xs text-muted-foreground">
          Connect Google Drive to automatically save email attachments and reports to a folder.
        </p>
        <GoogleConnectionUI
          connected={false}
          hasCredentials={hasCredentials}
          clientId={clientId}
          onChanged={onChanged}
        />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <p className="text-xs font-medium">Google Drive</p>
      <p className="text-xs text-muted-foreground">
        Google Drive is connected. Attachments from processed emails will be saved automatically.
      </p>

      <div className="mb-1">
        <GoogleConnectionUI
          connected={true}
          hasCredentials={hasCredentials}
          clientId={clientId}
          onChanged={onChanged}
        />
      </div>

      {folderName ? (
        <div className="flex items-center gap-2 text-sm">
          <FolderOpen className="h-4 w-4 text-muted-foreground" />
          <span>Saving to: <span className="font-medium">{folderName}</span></span>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No folder selected. Create or specify a folder to start saving reports.
        </p>
      )}

      {showFolderInput ? (
        <div className="border rounded-lg p-3 space-y-3">
          <div>
            <Label>Folder name</Label>
            <Input
              value={newFolderName}
              onChange={(e) => { setNewFolderName(e.target.value); setFolderError(null) }}
              placeholder="Portfolio Reports"
              onKeyDown={(e) => { if (e.key === 'Enter') createFolder() }}
            />
            <p className="text-xs text-muted-foreground mt-1">
              A folder with this name will be created in your Google Drive root. If it already exists, the existing folder will be used.
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
            <Button size="sm" onClick={createFolder} disabled={creatingFolder || !newFolderName.trim()}>
              {creatingFolder ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
              {folderId ? 'Update folder' : 'Create folder'}
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setShowFolderInput(true)}>
            {folderId ? 'Change folder' : 'Set folder'}
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
    </div>
  )
}

// ──────────────────────────── Storage ────────────────────────────

function StorageSection({
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
              connected={googleDriveConnected}
              folderId={googleDriveFolderId}
              folderName={googleDriveFolderName}
              hasCredentials={hasGoogleCredentials}
              clientId={googleClientId}
              onChanged={onChanged}
            />
          </div>
        )}

        {selectedProvider === 'dropbox' && (
          <div className="border-t pt-4">
            <DropboxSection
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
  connected,
  hasCredentials,
  appKey: existingAppKey,
  folderPath,
  onChanged,
}: {
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
              <Label>Approval email subject</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                Subject line for the member approval email. Use {'{{fundName}}'} as a placeholder.
              </p>
              <Input
                value={approvalSubject}
                onChange={(e) => setApprovalSubject(e.target.value)}
                placeholder={defaultSubject}
              />
            </div>
            <div>
              <Label>Approval email body</Label>
              <p className="text-xs text-muted-foreground mt-0.5 mb-1.5">
                HTML body for the member approval email. Use {'{{fundName}}'} and {'{{siteUrl}}'} as placeholders.
              </p>
              <Textarea
                value={approvalBody}
                onChange={(e) => setApprovalBody(e.target.value)}
                placeholder={defaultBody}
                rows={5}
                className="font-mono text-xs"
              />
            </div>
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
                {m.role === 'admin' ? (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium bg-primary/10 text-primary rounded-full px-2 py-0.5">
                    <Shield className="h-2.5 w-2.5" />
                    Admin
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">Member</span>
                )}
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
      <h2 className="text-sm font-medium text-destructive mb-1 flex items-center gap-1.5"><Lock className="h-3 w-3 text-amber-500" />Danger zone</h2>
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
  customHeadScript,
  onSaved,
}: {
  fathomSiteId: string | null
  gaMeasurementId: string | null
  customHeadScript: string | null
  onSaved: () => void
}) {
  const [fathom, setFathom] = useState(fathomSiteId ?? '')
  const [ga, setGa] = useState(gaMeasurementId ?? '')
  const [custom, setCustom] = useState(customHeadScript ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const hasChanges =
    fathom !== (fathomSiteId ?? '') ||
    ga !== (gaMeasurementId ?? '') ||
    custom !== (customHeadScript ?? '')

  const handleSave = async () => {
    setSaving(true)
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        analyticsFathomSiteId: fathom,
        analyticsGaMeasurementId: ga,
        analyticsCustomHeadScript: custom,
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
        <div>
          <Label>Custom head script</Label>
          <p className="text-xs text-muted-foreground mt-1 mb-1.5">
            Raw JavaScript injected via a {'<script>'} tag. Do not include {'<script>'} tags.
          </p>
          <Textarea
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            rows={6}
            className="font-mono"
            placeholder="// Your custom analytics script"
          />
        </div>
        <Button onClick={handleSave} disabled={saving || !hasChanges} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
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
