'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { Building2 } from 'lucide-react'

export default function AuthPage() {
  return (
    <Suspense>
      <AuthForm />
    </Suspense>
  )
}

function AuthForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [branding, setBranding] = useState<{ fundName: string | null; fundLogo: string | null; authSubtitle: string | null; authContact: string | null }>({ fundName: null, fundLogo: null, authSubtitle: null, authContact: null })

  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')

  const supabase = createClient()

  useEffect(() => {
    fetch('/api/auth/branding')
      .then(r => r.json())
      .then(data => setBranding(data))
      .catch(() => {})
  }, [])

  function reset() {
    setError(null)
    setInfo(null)
  }

  async function signIn() {
    reset()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
    } else {
      router.push('/')
      router.refresh()
    }
    setLoading(false)
  }

  async function sendMagicLink() {
    if (!email.trim()) {
      setError('Enter your email address first.')
      return
    }
    reset()
    setLoading(true)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    })
    if (error) {
      setError(error.message)
    } else {
      setInfo('Magic link sent — check your email.')
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
            <CardTitle className="text-lg">Sign in</CardTitle>
            <CardDescription>Sign in to your account to continue.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(error || urlError) && (
              <Alert variant="destructive">
                <AlertDescription>{error || urlError}</AlertDescription>
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
                onKeyDown={e => e.key === 'Enter' && signIn()}
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
                onKeyDown={e => e.key === 'Enter' && signIn()}
                autoComplete="current-password"
              />
            </div>

            <Button className="w-full" onClick={signIn} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>

            <div className="relative">
              <Separator />
              <span className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-2 text-xs text-muted-foreground">
                or
              </span>
            </div>

            <Button
              variant="outline"
              className="w-full"
              onClick={sendMagicLink}
              disabled={loading}
            >
              Send magic link
            </Button>

            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href="/auth/signup" className="text-primary underline underline-offset-4 hover:text-primary/80">
                Create an account
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
