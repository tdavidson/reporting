'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { CheckCircle2, Circle, Loader2, X, Plus, Building2, HardDrive } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Sender {
  email: string
  label: string
}

interface OnboardingState {
  fundId: string | null
  webhookToken: string | null
}

interface MatchingFund {
  id: string
  name: string
}

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------

const STEPS = [
  { n: 1, label: 'Fund setup' },
  { n: 2, label: 'Email integration' },
  { n: 3, label: 'Senders' },
  { n: 4, label: 'Google Drive' },
]

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS.map((step, i) => (
        <div key={step.n} className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            {current > step.n ? (
              <CheckCircle2 className="h-5 w-5 text-primary" />
            ) : current === step.n ? (
              <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                <span className="text-[10px] font-bold text-primary-foreground">{step.n}</span>
              </div>
            ) : (
              <Circle className="h-5 w-5 text-muted-foreground" />
            )}
            <span
              className={`text-sm ${
                current === step.n ? 'font-medium' : 'text-muted-foreground'
              }`}
            >
              {step.label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className="w-8 h-px bg-border mx-1" />
          )}
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function OnboardingPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    }>
      <OnboardingContent />
    </Suspense>
  )
}

function OnboardingContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [loading, setLoading] = useState(true)
  const [matchingFund, setMatchingFund] = useState<MatchingFund | null>(null)
  const [mode, setMode] = useState<'detect' | 'join' | 'create'>('detect')
  const [step, setStep] = useState(1)
  const [state, setState] = useState<OnboardingState>({ fundId: null, webhookToken: null })

  const detectFund = useCallback(async () => {
    // Check if returning from Google Drive OAuth
    const googleConnected = searchParams.get('google_connected') === 'true'

    // Check if the user has an in-progress onboarding to resume
    const statusRes = await fetch('/api/onboarding/fund')
    if (statusRes.ok) {
      const status = await statusRes.json()
      if (status.step === 'complete' && !googleConnected) {
        router.push('/dashboard')
        return
      }
      if (status.fundId) {
        setState({ fundId: status.fundId, webhookToken: status.webhookToken })

        if (googleConnected) {
          // Returning from Google OAuth — go to step 4 with success
          setStep(4)
        } else if (status.step === 'complete') {
          // All required steps done, show optional Google Drive step
          setStep(4)
        } else if (typeof status.step === 'number' && status.step > 1) {
          setStep(status.step)
        }

        setMode('create')
        setLoading(false)
        return
      }
    }

    // No existing fund — check for domain-matching fund to join
    const res = await fetch('/api/onboarding/check-domain')
    if (res.ok) {
      const data = await res.json()
      if (data.fund) {
        setMatchingFund(data.fund)
        setMode('join')
        setLoading(false)
        return
      }
    }

    setMode('create')
    setLoading(false)
  }, [router, searchParams])

  useEffect(() => { detectFund() }, [detectFund])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (mode === 'join' && matchingFund) {
    return <JoinFundScreen fund={matchingFund} onCreateInstead={() => setMode('create')} />
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-lg">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold tracking-tight">Set up your fund</h1>
          <p className="text-sm text-muted-foreground mt-1">
            This takes about 3 minutes. You can update everything later in Settings.
          </p>
        </div>

        <StepIndicator current={step} />

        {step === 1 && (
          <Step1
            onComplete={(fundId, webhookToken) => {
              setState({ fundId, webhookToken })
              setStep(2)
            }}
          />
        )}
        {step === 2 && state.fundId && state.webhookToken && (
          <Step2
            fundId={state.fundId}
            webhookToken={state.webhookToken}
            onComplete={() => setStep(3)}
          />
        )}
        {step === 3 && state.fundId && (
          <Step3
            fundId={state.fundId}
            onComplete={() => setStep(4)}
          />
        )}
        {step === 4 && (
          <Step4
            googleConnected={searchParams.get('google_connected') === 'true'}
            onComplete={() => router.push('/dashboard')}
          />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Join existing fund screen
// ---------------------------------------------------------------------------

function JoinFundScreen({
  fund,
  onCreateInstead,
}: {
  fund: MatchingFund
  onCreateInstead: () => void
}) {
  const router = useRouter()
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function requestJoin() {
    setRequesting(true)
    setError(null)

    try {
      const res = await fetch('/api/onboarding/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundId: fund.id }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setRequested(true)
      setTimeout(() => router.push('/pending'), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
    setRequesting(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-4">
        <div className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">Welcome</h1>
          <p className="text-sm text-muted-foreground mt-1">
            We found a fund matching your email domain.
          </p>
        </div>

        <Card>
          <CardContent className="pt-6 space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {requested ? (
              <div className="text-center py-4">
                <CheckCircle2 className="h-8 w-8 text-emerald-500 mx-auto mb-2" />
                <p className="font-medium">Request sent</p>
                <p className="text-sm text-muted-foreground">Redirecting...</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/50">
                  <Building2 className="h-8 w-8 text-muted-foreground shrink-0" />
                  <div>
                    <p className="font-medium">{fund.name}</p>
                    <p className="text-xs text-muted-foreground">Existing fund at your organization</p>
                  </div>
                </div>

                <Button className="w-full" onClick={requestJoin} disabled={requesting}>
                  {requesting ? (
                    <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Requesting...</>
                  ) : (
                    'Request to join'
                  )}
                </Button>

                <p className="text-xs text-muted-foreground text-center">
                  Your request will be reviewed by a fund administrator.
                </p>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <Button variant="outline" className="w-full" onClick={onCreateInstead}>
                  Create a new fund instead
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Step 1: Fund name + Claude API key
// ---------------------------------------------------------------------------

function Step1({ onComplete }: { onComplete: (fundId: string, webhookToken: string) => void }) {
  const [fundName, setFundName] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<'success' | 'error' | null>(null)
  const [testError, setTestError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function testKey() {
    if (!apiKey.trim()) return
    setTesting(true)
    setTestResult(null)
    setTestError(null)
    try {
      const res = await fetch('/api/test-claude-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      })
      const data = await res.json()
      if (res.ok) {
        setTestResult('success')
      } else {
        setTestResult('error')
        setTestError(data.error ?? 'Connection failed')
      }
    } catch {
      setTestResult('error')
      setTestError('Network error')
    }
    setTesting(false)
  }

  async function submit() {
    if (!fundName.trim() || !apiKey.trim()) {
      setError('Both fields are required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/fund', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundName, claudeApiKey: apiKey }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onComplete(data.fundId, data.webhookToken)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Fund name &amp; Claude API key</CardTitle>
        <CardDescription>
          Your API key is encrypted before storage and never exposed.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label htmlFor="fund-name">Fund name</Label>
          <Input
            id="fund-name"
            placeholder="Acme Ventures"
            value={fundName}
            onChange={e => setFundName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="api-key">Claude API key</Label>
          <div className="flex gap-2">
            <Input
              id="api-key"
              type="password"
              placeholder="sk-ant-…"
              value={apiKey}
              onChange={e => {
                setApiKey(e.target.value)
                setTestResult(null)
              }}
              className="flex-1"
            />
            <Button variant="outline" onClick={testKey} disabled={testing || !apiKey.trim()}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Test'}
            </Button>
          </div>
          {testResult === 'success' && (
            <p className="text-sm text-green-600 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Connected successfully
            </p>
          )}
          {testResult === 'error' && (
            <p className="text-sm text-destructive">{testError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Get your key at{' '}
            <a
              href="https://console.anthropic.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              console.anthropic.com
            </a>
          </p>
        </div>

        <Button className="w-full" onClick={submit} disabled={saving}>
          {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</> : 'Next →'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 2: Inbound email setup (Postmark or Mailgun)
// ---------------------------------------------------------------------------

function Step2({
  fundId,
  webhookToken,
  onComplete,
}: {
  fundId: string
  webhookToken: string
  onComplete: () => void
}) {
  const [provider, setProvider] = useState<'postmark' | 'mailgun'>('postmark')
  const [inboundAddress, setInboundAddress] = useState('')
  const [mgDomain, setMgDomain] = useState('')
  const [mgSigningKey, setMgSigningKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const defaultBase = typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_APP_URL || window.location.origin)
    : ''
  const [baseUrl, setBaseUrl] = useState(defaultBase)
  const postmarkWebhookUrl = `${baseUrl}/api/inbound-email?token=${webhookToken}`
  const mailgunWebhookUrl = `${baseUrl}/api/inbound-email/mailgun`

  async function submit() {
    if (provider === 'postmark' && !inboundAddress.trim()) {
      setError('Postmark inbound address is required.')
      return
    }
    if (provider === 'mailgun' && !mgDomain.trim()) {
      setError('Mailgun inbound domain is required.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const body: Record<string, string> = { fundId, provider }
      if (provider === 'postmark') {
        body.postmarkInboundAddress = inboundAddress
      } else {
        body.mailgunInboundDomain = mgDomain
        if (mgSigningKey.trim()) body.mailgunSigningKey = mgSigningKey
      }
      const res = await fetch('/api/onboarding/inbound-email', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Inbound email integration</CardTitle>
        <CardDescription>
          Choose how portfolio companies will send reports to your fund.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          <Label>Email provider</Label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setProvider('postmark')}
              className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                provider === 'postmark'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'hover:bg-accent'
              }`}
            >
              <span className="font-medium">Postmark</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Managed inbound address with webhook forwarding
              </p>
            </button>
            <button
              type="button"
              onClick={() => setProvider('mailgun')}
              className={`flex-1 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                provider === 'mailgun'
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'hover:bg-accent'
              }`}
            >
              <span className="font-medium">Mailgun</span>
              <p className="text-xs text-muted-foreground mt-0.5">
                Route emails from your own domain
              </p>
            </button>
          </div>
        </div>

        <div className="space-y-2">
          <Label>Webhook base URL</Label>
          <Input
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            placeholder="https://your-app.vercel.app"
          />
          <p className="text-xs text-muted-foreground">
            For local development, use your ngrok or tunnel URL (e.g. https://abc123.ngrok.io).
          </p>
        </div>

        <div className="space-y-2">
          <Label>Your webhook URL</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted rounded-md px-3 py-2 text-xs break-all font-mono">
              {provider === 'postmark' ? postmarkWebhookUrl : mailgunWebhookUrl}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={() => navigator.clipboard.writeText(
                provider === 'postmark' ? postmarkWebhookUrl : mailgunWebhookUrl
              )}
            >
              Copy
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {provider === 'postmark' ? (
              <>
                In your{' '}
                <a
                  href="https://account.postmarkapp.com/servers"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Postmark server settings
                </a>
                , go to <strong>Inbound</strong> and paste this URL as the webhook endpoint.
              </>
            ) : (
              <>
                In Mailgun, go to <strong>Receiving</strong> &gt; <strong>Create Route</strong> and
                forward matching emails to this URL.
              </>
            )}
          </p>
        </div>

        {provider === 'postmark' && (
          <div className="space-y-2">
            <Label htmlFor="inbound-address">Postmark inbound email address</Label>
            <Input
              id="inbound-address"
              type="email"
              placeholder="abc123@inbound.postmarkapp.com"
              value={inboundAddress}
              onChange={e => setInboundAddress(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Found on the same Inbound settings page. Share this with your portfolio founders.
            </p>
          </div>
        )}

        {provider === 'mailgun' && (
          <>
            <div className="space-y-2">
              <Label htmlFor="mg-domain">Mailgun inbound domain</Label>
              <Input
                id="mg-domain"
                placeholder="mg.yourdomain.com"
                value={mgDomain}
                onChange={e => setMgDomain(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The domain configured for inbound routing in Mailgun.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="mg-signing-key">Webhook signing key (optional)</Label>
              <Input
                id="mg-signing-key"
                type="password"
                placeholder="Mailgun webhook signing key"
                value={mgSigningKey}
                onChange={e => setMgSigningKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Found in the Mailgun dashboard under Sending &gt; Webhooks. Used to verify inbound requests.
              </p>
            </div>
          </>
        )}

        <Button className="w-full" onClick={submit} disabled={saving}>
          {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</> : 'Next →'}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 3: Authorized senders
// ---------------------------------------------------------------------------

function Step3({ fundId, onComplete }: { fundId: string; onComplete: () => void }) {
  const [senders, setSenders] = useState<Sender[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function addSender() {
    if (!newEmail.trim()) return
    setSenders(prev => [...prev, { email: newEmail.trim(), label: newLabel.trim() }])
    setNewEmail('')
    setNewLabel('')
  }

  function removeSender(index: number) {
    setSenders(prev => prev.filter((_, i) => i !== index))
  }

  async function submit() {
    const valid = senders.filter(s => s.email.trim())
    if (valid.length === 0) {
      setError('Add at least one authorized sender.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const res = await fetch('/api/onboarding/senders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundId, senders: valid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    }
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Authorized senders</CardTitle>
        <CardDescription>
          Only emails from these addresses will trigger report parsing. Add founders,
          CFOs, and anyone who will send portfolio reports.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Sender list */}
        {senders.length > 0 && (
          <div className="space-y-2">
            {senders.map((sender, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="flex-1 bg-muted rounded-md px-3 py-2 text-sm flex items-center justify-between">
                  <span>{sender.email}</span>
                  {sender.label && (
                    <Badge variant="secondary" className="ml-2 text-xs">
                      {sender.label}
                    </Badge>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeSender(i)}
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {/* Add sender */}
        <div className="space-y-2">
          <Label>Add sender</Label>
          <div className="flex gap-2">
            <Input
              type="email"
              placeholder="cfo@portfolio.com"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSender()}
              className="flex-1"
            />
            <Input
              placeholder="Label (optional)"
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addSender()}
              className="w-36"
            />
            <Button variant="outline" size="icon" onClick={addSender} disabled={!newEmail.trim()}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Button className="w-full" onClick={submit} disabled={saving}>
          {saving ? (
            <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Saving…</>
          ) : (
            'Next →'
          )}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Step 4: Google Drive (optional)
// ---------------------------------------------------------------------------

function Step4({
  googleConnected,
  onComplete,
}: {
  googleConnected: boolean
  onComplete: () => void
}) {
  const [configured, setConfigured] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)

  // Credential entry
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)

  // Check if credentials exist (DB or env)
  useEffect(() => {
    fetch('/api/settings')
      .then(res => res.json())
      .then(data => setConfigured(!!data.hasGoogleCredentials))
      .catch(() => setConfigured(false))
  }, [])

  async function saveCredentials() {
    if (!clientId.trim() || !clientSecret.trim()) return
    setSavingCreds(true)
    setConnectError(null)
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
      setConfigured(true)
    } else {
      const data = await res.json().catch(() => ({}))
      setConnectError(data.error || 'Failed to save credentials')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Google Drive</CardTitle>
        <CardDescription>
          Optionally connect Google Drive to automatically save email attachments and reports to a folder.
          You can always set this up later in Settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {googleConnected ? (
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/50">
            <CheckCircle2 className="h-6 w-6 text-emerald-500 shrink-0" />
            <div>
              <p className="font-medium text-sm">Google Drive connected</p>
              <p className="text-xs text-muted-foreground">
                You can choose a specific folder in Settings after setup.
              </p>
            </div>
          </div>
        ) : !configured ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 p-4 rounded-lg border border-dashed">
              <HardDrive className="h-6 w-6 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="font-medium text-sm">Save reports to Google Drive</p>
                <p className="text-xs text-muted-foreground">
                  Enter your Google OAuth credentials to get started.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div>
                <Label>Client ID</Label>
                <Input
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder="123456789.apps.googleusercontent.com"
                />
              </div>
              <div>
                <Label>Client secret</Label>
                <Input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
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
              <Button
                className="w-full"
                variant="outline"
                onClick={saveCredentials}
                disabled={savingCreds || !clientId.trim() || !clientSecret.trim()}
              >
                {savingCreds ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Save credentials
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 p-4 rounded-lg border border-dashed">
            <HardDrive className="h-6 w-6 text-muted-foreground shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">Save reports to Google Drive</p>
              <p className="text-xs text-muted-foreground">
                Credentials configured. Connect your Google account to get started.
              </p>
            </div>
          </div>
        )}

        {connectError && (
          <Alert variant="destructive">
            <AlertDescription>{connectError}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-2">
          {!googleConnected && configured && (
            <Button
              className="w-full"
              variant="outline"
              onClick={() => {
                window.location.href = '/api/auth/google?return_to=/onboarding'
              }}
            >
              <HardDrive className="h-4 w-4 mr-2" />
              Connect Google Drive
            </Button>
          )}

          <Button className="w-full" onClick={onComplete}>
            {googleConnected ? 'Finish setup' : 'Skip for now'}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
