'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { createClient } from '@/lib/supabase/client'
import { OtpCodeForm } from '@/components/auth/otp-code-form'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedLicense, setAcceptedLicense] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isHemrock, setIsHemrock] = useState(false)

  async function handleVerify(code: string) {
    setError(null)
    setVerifying(true)
    const supabase = createClient()
    const { error } = await supabase.auth.verifyOtp({
      type: 'signup',
      email: email.trim().toLowerCase(),
      token: code,
    })
    if (error) {
      setError(error.message)
      setVerifying(false)
    } else {
      window.location.href = '/auth/post-login?method=signup&next=/'
    }
  }

  async function handleResend() {
    setError(null)
    const supabase = createClient()
    await supabase.auth.resend({ type: 'signup', email: email.trim().toLowerCase() })
  }

  useEffect(() => {
    const host = window.location.hostname
    setIsHemrock(host === 'hemrock.com' || host.endsWith('.hemrock.com') || host.endsWith('.netlify.app') || host.endsWith('.vercel.app') || host === 'localhost')
  }, [])

  async function signUp() {
    if (!email.trim()) {
      setError('Email is required.')
      return
    }
    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (!acceptedLicense) {
      setError('You must accept the license agreement to create an account.')
      return
    }
    setError(null)
    setInfo(null)
    setLoading(true)

    // Step 1: server-side whitelist check. Each failure mode is handled
    // distinctly so a recurrence is diagnosable from the message + console
    // rather than collapsing into one generic "please try again".

    // 1a. Network-level failure reaching our own API.
    let whitelistRes: Response
    try {
      whitelistRes = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, acceptedLicense: true }),
      })
    } catch (err) {
      console.error('[signup] whitelist request failed to send:', err)
      setError('Couldn’t reach the server. Check your connection and try again.')
      setLoading(false)
      return
    }

    // 1b. Response arrived but isn't JSON — typically an infra error page
    // (gateway timeout, platform 5xx). The HTTP status pinpoints it.
    let whitelistData: { ok?: boolean; error?: string }
    try {
      whitelistData = await whitelistRes.json()
    } catch (err) {
      console.error(`[signup] whitelist response was not JSON (HTTP ${whitelistRes.status}):`, err)
      setError(`Signup check failed, the server returned an unexpected response (HTTP ${whitelistRes.status}). Please try again in a moment.`)
      setLoading(false)
      return
    }

    // 1c. Whitelist rejected, or the API returned a handled error.
    if (!whitelistRes.ok) {
      if (whitelistData.error === 'not_whitelisted') {
        setError('not_whitelisted')
      } else {
        setError(whitelistData.error || 'Unable to create account.')
      }
      setLoading(false)
      return
    }

    // Step 2: create the user via the browser client (PKCE flow — the
    // confirmation link will work). signUp normally *returns* errors, but a
    // 5xx from the Auth server can surface as a *thrown* exception — handle
    // both so neither is mistaken for the other.
    let signUpError: { message?: string } | null = null
    try {
      const supabase = createClient()
      const result = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback`,
          data: {
            accepted_license_at: new Date().toISOString(),
          },
        },
      })
      signUpError = result.error
    } catch (err) {
      console.error('[signup] supabase.auth.signUp threw:', err)
      setError(
        err instanceof Error
          ? `Account creation failed: ${err.message}`
          : 'Account creation failed unexpectedly. Please try again.'
      )
      setLoading(false)
      return
    }

    if (signUpError) {
      console.error('[signup] signUp returned an error:', signUpError)
      const msg = signUpError.message ?? ''
      if (msg.includes('already') || msg.includes('registered')) {
        setError('Unable to create account. The email may already be registered.')
      } else {
        setError(msg || 'Unable to create account.')
      }
    } else {
      // Email confirmation sent as a 6-digit code — move to the verify step.
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <AuthShell
      above={isHemrock && (
        <div className="rounded-lg border bg-card p-4 text-sm text-center">
          <p>👋 Want to try it out first? <a href="/demo" className="text-primary underline underline-offset-4 hover:text-primary/80 font-medium">Launch the demo</a></p>
        </div>
      )}
    >

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Create an account</CardTitle>
            <CardDescription>Enter your email and a password to get started.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sent ? (
              <OtpCodeForm
                email={email.trim().toLowerCase()}
                onVerify={handleVerify}
                onResend={handleResend}
                verifying={verifying}
                error={error}
              />
            ) : (
              <>
            {error && error !== 'not_whitelisted' && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {error === 'not_whitelisted' && (
              <Alert className="!border-amber-500/50 !bg-amber-50 dark:!bg-amber-950/30 !text-amber-900 dark:!text-amber-200">
                <AlertDescription className="text-sm space-y-2">
                  <p>This email is not authorized for the hosted platform.</p>
                  <p>
                    This software is available to download and install on your own servers, subject to the{' '}
                    <a href="/license" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">license</a>.
                    If you are interested in the hosted solution, contact{' '}
                    <a href="https://www.hemrock.com/contact" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">Taylor</a>.
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {info && (
              <Alert className="!border-green-500/50 !bg-green-50 dark:!bg-green-950/30 !text-green-900 dark:!text-green-200">
                <AlertDescription>{info}</AlertDescription>
              </Alert>
            )}

            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && signUp()}
                autoComplete="email"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && signUp()}
                autoComplete="new-password"
                placeholder="At least 8 characters"
              />
            </div>

            <div className="flex items-start gap-2">
              <input
                id="accept-license"
                type="checkbox"
                checked={acceptedLicense}
                onChange={e => setAcceptedLicense(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-input accent-primary"
              />
              <label htmlFor="accept-license" className="text-xs text-muted-foreground leading-relaxed">
                I agree to the{' '}
                <a href="/license" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">
                  License Agreement
                </a>
                {isHemrock && (
                  <>
                    ,{' '}
                    <a href="https://www.hemrock.com/terms" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">
                      Terms of Service
                    </a>
                    , and{' '}
                    <a href="https://www.hemrock.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">
                      Privacy Policy
                    </a>
                  </>
                )}
                .
              </label>
            </div>

            <Button className="w-full" onClick={signUp} disabled={loading || !acceptedLicense}>
              {loading ? 'Creating account…' : 'Create account'}
            </Button>
              </>
            )}

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/auth" className="text-primary underline underline-offset-4 hover:text-primary/80">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
    </AuthShell>
  )
}
