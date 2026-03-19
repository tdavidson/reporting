'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'

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
  const [isHemrock, setIsHemrock] = useState(false)

  useEffect(() => {
    const host = window.location.hostname
    setIsHemrock(host === 'hemrock.com' || host.endsWith('.hemrock.com') || host === 'localhost')
  }, [])

  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')
  const emailConfirmed = searchParams.get('confirmed') === 'true'

  const supabase = createClient()

  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) return

    async function exchangeCode() {
      const { error } = await supabase.auth.exchangeCodeForSession(code!)
      if (error) {
        setError('Invalid or expired link. Please try again.')
        return
      }
      const { data: { session } } = await supabase.auth.getSession()
      let destination = session?.user?.recovery_sent_at ? '/auth/reset-password' : '/'
      if (destination === '/') {
        const { data: fund } = await supabase.from('funds').select('id').limit(1).maybeSingle()
        if (!fund) destination = '/onboarding?confirmed=true'
      }
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        router.replace(`/auth/mfa-verify?next=${encodeURIComponent(destination)}`)
      } else {
        router.replace(destination)
      }
    }
    exchangeCode()
  }, [searchParams, supabase, router])

  async function signIn() {
    setError(null)
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
    } else {
      fetch('/api/auth/activity', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ method: 'password' }) }).catch(() => {})
      const { data: fund } = await supabase.from('funds').select('id').limit(1).maybeSingle()
      const destination = fund ? '/' : '/onboarding'
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        router.push(`/auth/mfa-verify?next=${encodeURIComponent(destination)}`)
      } else {
        router.push(destination)
      }
      router.refresh()
    }
    setLoading(false)
  }

  return (
  return (
    <div className="min-h-screen flex flex-col items-center justify-start pt-16 p-4" style={{ backgroundColor: '#102430' }}>
      <div className="w-full max-w-md space-y-6">
        <div className="text-center mb-8">
          <Image
            src="/PARALLAX_VENTURES_BRAND_MARK-1.svg"
            alt="Parallax Ventures"
            width={520}
            height={520}
            className="mx-auto mb-6"
          />
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sign in with your account</CardTitle>
            <CardDescription>Sign in with password or magic link.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {emailConfirmed && (
              <Alert className="border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950">
                <AlertDescription className="text-green-800 dark:text-green-200">
                  Your email has been confirmed. Please sign in to continue.
                </AlertDescription>
              </Alert>
            )}
            {(error || urlError) && (
              <Alert variant="destructive">
                <AlertDescription>{error || urlError}</AlertDescription>
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
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Password</Label>
                <Link href="/auth/forgot-password" className="text-xs text-muted-foreground underline underline-offset-4 hover:text-primary">
                  Forgot password?
                </Link>
              </div>
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

            <div className="flex items-center gap-3 pt-1 pb-3">
              <Separator className="flex-1" />
              <span className="text-xs text-muted-foreground">or</span>
              <Separator className="flex-1" />
            </div>

            <Link href="/auth/magic-link">
              <Button variant="outline" className="w-full">
                Sign in with magic link
              </Button>
            </Link>

            <p className="text-center text-sm text-muted-foreground">
              Don&apos;t have an account?{' '}
              <Link href="/auth/signup" className="text-primary underline underline-offset-4 hover:text-primary/80">
                Create an account
              </Link>
            </p>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          <a href="/license" target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-4">License</a>
          {isHemrock && (
            <>
              {' · '}
              <a href="https://www.hemrock.com/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-4">Terms</a>
              {' · '}
              <a href="https://www.hemrock.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-4">Privacy</a>
            </>
          )}
        </p>
      </div>
    </div>
  )
}
