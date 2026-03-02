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
  const router = useRouter()
  const searchParams = useSearchParams()
  const urlError = searchParams.get('error')

  const supabase = createClient()

  // Handle code param (e.g. password reset link landing on /auth instead of /auth/callback)
  useEffect(() => {
    const code = searchParams.get('code')
    if (!code) return

    async function exchangeCode() {
      const { error } = await supabase.auth.exchangeCodeForSession(code!)
      if (error) {
        setError('Invalid or expired link. Please try again.')
        return
      }
      // Check if this is a recovery session — redirect to set new password
      const { data: { session } } = await supabase.auth.getSession()
      const destination = session?.user?.recovery_sent_at ? '/auth/reset-password' : '/'
      // If MFA is enrolled, verify first then continue to destination
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
      // Check if user has MFA enrolled and needs to verify
      const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') {
        router.push('/auth/mfa-verify')
      } else {
        router.push('/')
      }
      router.refresh()
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/40 p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <div className="h-10 w-10 rounded bg-muted flex items-center justify-center mx-auto mb-2">
            <Building2 className="h-5 w-5 text-muted-foreground" />
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Portfolio Reporting</h1>
        </div>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Sign in with your account</CardTitle>
            <CardDescription>Sign in with password or magic link.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          {' · '}
          <a href="https://www.hemrock.com/terms" target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-4">Terms</a>
          {' · '}
          <a href="https://www.hemrock.com/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-foreground underline underline-offset-4">Privacy</a>
        </p>
      </div>
    </div>
  )
}
