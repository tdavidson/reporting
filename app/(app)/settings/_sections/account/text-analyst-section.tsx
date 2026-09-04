'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Loader2, MessageSquare } from 'lucide-react'
import { Section } from '@/components/settings/section'

interface PhoneStatus {
  configured: boolean
  fundNumber: string | null
  phoneNumber: string | null
  verified: boolean
  pendingVerification: boolean
  optedOut: boolean
}

/**
 * A member's own phone for texting the Analyst: enter the number, get a code, type it back.
 * Every member links their own; the fund's provider settings are the admin's job further down.
 */
export function TextAnalystSection({ isAdmin }: { isAdmin: boolean }) {
  const [status, setStatus] = useState<PhoneStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [number, setNumber] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const res = await fetch('/api/settings/phone')
    if (res.ok) {
      const data = await res.json() as PhoneStatus
      setStatus(data)
      setNumber(current => current || data.phoneNumber || '')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const call = async (method: 'POST' | 'PUT' | 'DELETE', body?: Record<string, unknown>) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    const res = await fetch('/api/settings/phone', {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await res.json().catch(() => ({})) as { error?: string; ok?: boolean }
    setBusy(false)
    if (!res.ok) {
      setError(data.error ?? 'Something went wrong.')
      return false
    }
    return true
  }

  const sendCode = async () => {
    if (await call('POST', { phoneNumber: number })) {
      setCode('')
      setNotice('We texted you a code. It expires in 10 minutes.')
      await load()
    }
  }

  const verify = async () => {
    if (await call('PUT', { code })) {
      setNotice('Linked. Text the number below to talk to the Analyst.')
      await load()
    }
  }

  const unlink = async () => {
    if (await call('DELETE')) {
      setNumber('')
      setCode('')
      setNotice(null)
      await load()
    }
  }

  return (
    <Section title="Text the Analyst">
      {loading || !status ? (
        <div className="h-16 bg-muted rounded animate-pulse" />
      ) : !status.configured ? (
        <p className="text-xs text-muted-foreground">
          Text messaging isn&#39;t set up for this fund yet.
          {isAdmin
            ? ' Configure a Twilio number under Text messaging below, then link your phone here.'
            : ' Ask an admin to set it up in Settings, then link your phone here.'}
        </p>
      ) : status.verified ? (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Text the Analyst from your phone. Ask about a company, a fund, or an LP the way you
            would in the panel; replies come back as texts. Reply NEW to start a fresh
            conversation, STOP to opt out.
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-card border p-3">
            <MessageSquare className="h-4 w-4 text-muted-foreground shrink-0" />
            <div className="flex-1 min-w-0 text-sm">
              <div>
                Text <span className="font-medium tabular-nums">{status.fundNumber}</span> from{' '}
                <span className="font-medium tabular-nums">{status.phoneNumber}</span>
              </div>
              {status.optedOut && (
                <p className="text-sm text-warning mt-0.5">
                  You replied STOP from this number. Text START to resume.
                </p>
              )}
            </div>
            {status.fundNumber && (
              <a
                className="text-xs text-brand-700 dark:text-brand-400 hover:underline whitespace-nowrap"
                href={`sms:${status.fundNumber}`}
              >
                Open in Messages
              </a>
            )}
          </div>
          {notice && <p className="text-xs text-success">{notice}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={unlink} disabled={busy} size="sm" variant="outline">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Unlink this phone'}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Link your mobile number and text the Analyst from your phone. We&#39;ll send a
            six-digit code to confirm it&#39;s yours.
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
            <div className="flex-1">
              <Label>Mobile number</Label>
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
                placeholder="+1 415 555 2671"
                inputMode="tel"
                autoComplete="tel"
              />
            </div>
            <Button onClick={sendCode} disabled={busy || !number.trim()} size="sm">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : status.pendingVerification ? 'Resend code' : 'Send code'}
            </Button>
          </div>
          {status.pendingVerification && (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3">
              <div className="flex-1">
                <Label>Verification code</Label>
                <Input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="123456"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="font-mono tracking-widest"
                />
              </div>
              <Button onClick={verify} disabled={busy || code.replace(/\s+/g, '').length !== 6} size="sm">
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Check className="h-3.5 w-3.5 mr-1" />Verify</>}
              </Button>
            </div>
          )}
          {notice && <p className="text-xs text-success">{notice}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      )}
    </Section>
  )
}
