'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Section } from '@/components/settings/section'

export function InboundEmailSection({
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
