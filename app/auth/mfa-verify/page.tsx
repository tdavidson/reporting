'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/safe-redirect'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2 } from 'lucide-react'

export default function MfaVerifyPage() {
  return (
    <Suspense>
      <MfaVerifyForm />
    </Suspense>
  )
}

function MfaVerifyForm() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const router = useRouter()
  const searchParams = useSearchParams()
  const supabase = createClient()

  // Where to go after successful MFA verification
  const nextPath = searchParams.get('next') || '/'

  useEffect(() => {
    async function checkAal() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.replace('/auth')
        return
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (!aal || aal.currentLevel === 'aal2' || aal.nextLevel !== 'aal2') {
        router.replace('/')
        return
      }
      setChecking(false)
    }
    checkAal()
  }, [router, supabase])

  async function verify() {
    setError(null)
    if (code.length !== 6) {
      setError('Enter a 6-digit code.')
      return
    }
    setLoading(true)
    try {
      const { data: factors } = await supabase.auth.mfa.listFactors()
      const totp = factors?.totp?.find(f => f.status === 'verified')
      if (!totp) {
        setError('No verified TOTP factor found.')
        setLoading(false)
        return
      }
      const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({ factorId: totp.id })
      if (challengeError) {
        setError(challengeError.message)
        setLoading(false)
        return
      }
      const { error: verifyError } = await supabase.auth.mfa.verify({
        factorId: totp.id,
        challengeId: challenge.id,
        code,
      })
      if (verifyError) {
        setError(verifyError.message)
        setCode('')
        inputRef.current?.focus()
      } else {
        // Prevent open redirect. This is a RAW window.location assignment fired the
        // instant a valid TOTP code is accepted, so a bypass here hands a
        // freshly-authenticated user straight to an attacker. The old inline check
        // (`startsWith('/') && !startsWith('//')`) missed `/\evil.com`, which the
        // URL parser resolves off-origin because a backslash is a slash for
        // http(s). safeNextPath rejects it; see lib/safe-redirect.ts.
        const dest = safeNextPath(nextPath) ?? '/'
        // Hard navigation so the server picks up the updated AAL2 session cookie
        window.location.href = dest
        return
      }
    } catch {
      setError('Verification failed. Please try again.')
      setCode('')
      inputRef.current?.focus()
    }
    setLoading(false)
  }

  async function signOutAndRedirect() {
    await supabase.auth.signOut()
    router.push('/auth')
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <AuthShell>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Two-factor authentication</CardTitle>
            <CardDescription>Enter the 6-digit code from your authenticator app.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="mfa-code">Verification code</Label>
              <Input
                ref={inputRef}
                id="mfa-code"
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && verify()}
                autoFocus
                autoComplete="one-time-code"
                placeholder="000000"
                className="text-center font-mono text-lg tracking-widest"
              />
            </div>

            <Button className="w-full" onClick={verify} disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              <button
                type="button"
                onClick={signOutAndRedirect}
                className="text-primary underline underline-offset-4 hover:text-primary/80"
              >
                Sign in with a different account
              </button>
            </p>
          </CardContent>
        </Card>
    </AuthShell>
  )
}
