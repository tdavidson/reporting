'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { AlertCircle, Check, Loader2, Shield } from 'lucide-react'
import { Section } from '@/components/settings/section'

export function MfaSection() {
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
