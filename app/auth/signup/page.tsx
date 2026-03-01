'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Building2 } from 'lucide-react'

export default function SignUpPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [branding, setBranding] = useState<{ fundName: string | null; fundLogo: string | null; authSubtitle: string | null; authContact: string | null }>({ fundName: null, fundLogo: null, authSubtitle: null, authContact: null })

  const supabase = createClient()

  useEffect(() => {
    fetch('/api/auth/branding')
      .then(r => r.json())
      .then(data => setBranding(data))
      .catch(() => {})
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
    setError(null)
    setInfo(null)
    setLoading(true)

    // Check whitelist before signup
    try {
      const checkRes = await fetch('/api/auth/check-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const checkData = await checkRes.json()
      if (!checkData.allowed) {
        setError('This email is not authorized to create an account. Contact your fund administrator.')
        setLoading(false)
        return
      }
    } catch {
      setError('Unable to verify email. Please try again.')
      setLoading(false)
      return
    }

    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError(error.message)
    } else {
      setInfo('Check your email for a confirmation link.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          {branding.fundLogo ? (
            <img src={branding.fundLogo} alt="" className="h-10 w-10 rounded object-contain mx-auto mb-2" />
          ) : (
            <div className="h-10 w-10 rounded bg-muted flex items-center justify-center mx-auto mb-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
            </div>
          )}
          <h1 className="text-lg font-semibold tracking-tight">{branding.fundName || 'Portfolio Reporting'}</h1>
          {(branding.authSubtitle || !branding.fundName) && (
            <p className="text-sm text-muted-foreground mt-1">{branding.authSubtitle || 'VC fund portfolio reporting tool'}</p>
          )}
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Create an account</CardTitle>
            <CardDescription>Enter your email and a password to get started.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
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

            <Button className="w-full" onClick={signUp} disabled={loading}>
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
        {branding.authContact && (
          <p className="text-center text-sm text-muted-foreground">{branding.authContact}</p>
        )}
      </div>
    </div>
  )
}
