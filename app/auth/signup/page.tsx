'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Building2 } from 'lucide-react'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [acceptedLicense, setAcceptedLicense] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isHemrock, setIsHemrock] = useState(false)

  useEffect(() => {
    const host = window.location.hostname
    setIsHemrock(host === 'hemrock.com' || host.endsWith('.hemrock.com') || host === 'localhost')
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

    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, acceptedLicense: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === 'not_whitelisted') {
          setError('not_whitelisted')
        } else {
          setError(data.error || 'Unable to create account.')
        }
      } else {
        setInfo('Check your email for a confirmation link.')
      }
    } catch {
      setError('Unable to create account. Please try again.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        {isHemrock && (
          <div className="-mt-20 mb-2 rounded-lg border bg-card p-4 text-sm text-center">
            <p>👋 Want to try it out first? <a href="/demo" className="text-primary underline underline-offset-4 hover:text-primary/80 font-medium">Launch the demo</a></p>
          </div>
        )}
        <div className="text-center">
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center mx-auto mb-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Portfolio Reporting</h1>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Create an account</CardTitle>
            <CardDescription>Enter your email and a password to get started.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && error !== 'not_whitelisted' && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            {error === 'not_whitelisted' && (
              <Alert>
                <AlertDescription className="text-sm space-y-2">
                  <p>This email is not authorized for the hosted platform.</p>
                  <p>
                    This software is available to download and install on your own servers, subject to the{' '}
                    <a href="/license" target="_blank" rel="noopener noreferrer" className="text-primary underline underline-offset-4 hover:text-primary/80">license</a>.
                    If you are interested in the hosted solution, contact{' '}
                    <a href="mailto:taylor@hemrock.com" className="text-primary underline underline-offset-4 hover:text-primary/80">Taylor</a>.
                  </p>
                </AlertDescription>
              </Alert>
            )}
            {info && (
              <Alert>
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

            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/auth" className="text-primary underline underline-offset-4 hover:text-primary/80">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
