'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

/**
 * The fund's side of "Text the Analyst": which provider, which number, whose account.
 * Admin-only. Each member then links their own phone in the account section at the top of the
 * page.
 */
export function TextMessagingSection({
  provider,
  fromNumber,
  accountSid,
  hasAuthToken,
  onSaved,
}: {
  provider: string | null
  fromNumber: string
  accountSid: string
  hasAuthToken: boolean
  onSaved: () => void
}) {
  const [selectedProvider, setSelectedProvider] = useState(provider || '')
  const [number, setNumber] = useState(fromNumber)
  const [sid, setSid] = useState(accountSid)
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const defaultBase = typeof window !== 'undefined' ? window.location.origin : ''
  const [baseUrl, setBaseUrl] = useState(defaultBase)

  const webhookPath = '/api/webhooks/sms/twilio'
  const webhookUrl = `${baseUrl}${webhookPath}`

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    const payload: Record<string, unknown> = { smsProvider: selectedProvider || null }
    if (selectedProvider === 'twilio') {
      payload.smsFromNumber = number.trim() || null
      payload.twilioAccountSid = sid.trim() || null
      if (token.trim()) payload.twilioAuthToken = token.trim()
    }
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    setSaving(false)
    if (res.ok) {
      setSaved(true)
      setToken('')
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } else {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save.')
    }
  }

  const copyUrl = () => {
    navigator.clipboard.writeText(webhookUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const providerChanged = selectedProvider !== (provider || '')
  const hasNewData = selectedProvider === 'twilio'
    && (number !== fromNumber || sid !== accountSid || token.trim() !== '')
  const canSave = providerChanged || hasNewData

  return (
    <Section title="Text messaging">
      <p className="text-xs text-muted-foreground mb-3">
        Let members text the Analyst from their phone. Buy a number in Twilio, point its messaging
        webhook here, and each member links their own mobile number under Text the Analyst at the
        top of this page. On an iPhone the conversation lives in Messages like any other text.
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
            <option value="twilio">Twilio</option>
          </select>
        </div>

        {selectedProvider === 'twilio' && (
          <>
            <div>
              <Label>Twilio phone number</Label>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+14155552671"
                inputMode="tel"
              />
              <p className="text-xs text-muted-foreground mt-1">
                The number members text, in international format. Replies are sent from it.
              </p>
            </div>
            <div>
              <Label>Account SID</Label>
              <Input
                value={sid}
                onChange={(e) => setSid(e.target.value)}
                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                autoComplete="off"
              />
            </div>
            <div>
              <Label>Auth token</Label>
              {hasAuthToken && (
                <p className="text-xs text-muted-foreground mt-1 mb-1.5">
                  An auth token is saved. Enter a new one to replace it.
                </p>
              )}
              <Input
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={hasAuthToken ? '••••••••' : 'Twilio auth token'}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground mt-1">
                From the Twilio console&#39;s account dashboard. Stored encrypted; it verifies incoming
                webhooks and sends replies.
              </p>
            </div>
            <div>
              <Label>Messaging webhook URL</Label>
              <div className="flex items-center gap-2">
                <div className="flex flex-1 items-center rounded-md border border-input shadow-sm overflow-hidden">
                  <input
                    className="h-9 w-40 shrink-0 bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://your-app.vercel.app"
                  />
                  <span className="text-xs text-muted-foreground bg-muted px-2 py-2 border-l whitespace-nowrap">{webhookPath}</span>
                </div>
                <Button onClick={copyUrl} variant="outline" size="icon" className="shrink-0 h-9 w-9">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                In Twilio, open the number under Phone Numbers → Manage → Active numbers and set
                &quot;A message comes in&quot; to this URL (HTTP POST). Edit the base URL for local
                development (e.g. ngrok).
              </p>
            </div>
          </>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={handleSave} disabled={saving || !canSave} size="sm">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : saved ? <Check className="h-3.5 w-3.5" /> : 'Save'}
        </Button>
      </div>
    </Section>
  )
}
