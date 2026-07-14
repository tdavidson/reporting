'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/components/auth-shell'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { OtpCodeForm } from '@/components/auth/otp-code-form'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const router = useRouter()
  const supabase = createClient()

  async function handleSend() {
    if (!email.trim()) {
      setError('Enter your email address.')
      return
    }
    setError(null)
    setLoading(true)
    // No redirectTo — the email carries a 6-digit recovery code, not a link.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase())
    if (error) setError(error.message)
    else setSent(true)
    setLoading(false)
  }

  async function handleVerify(code: string) {
    setError(null)
    setVerifying(true)
    const { error } = await supabase.auth.verifyOtp({
      type: 'recovery',
      email: email.trim().toLowerCase(),
      token: code,
    })
    if (error) {
      setError(error.message)
      setVerifying(false)
    } else {
      // Recovery session is now active — let the user set a new password.
      router.push('/auth/reset-password')
    }
  }

  return (
    <AuthShell>

        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Reset your password</CardTitle>
            <CardDescription>
              {sent
                ? 'Enter the 6-digit code we emailed you, then set a new password.'
                : "Enter your email and we'll send you a 6-digit code to reset your password."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {sent ? (
              <OtpCodeForm
                email={email.trim().toLowerCase()}
                onVerify={handleVerify}
                onResend={handleSend}
                verifying={verifying}
                error={error}
              />
            ) : (
              <>
                {error && (
                  <Alert variant="destructive">
                    <AlertDescription>{error}</AlertDescription>
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
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    autoComplete="email"
                    autoFocus
                  />
                </div>
                <Button className="w-full" onClick={handleSend} disabled={loading}>
                  {loading ? 'Sending…' : 'Email me a code'}
                </Button>
              </>
            )}

            <p className="text-center text-sm text-muted-foreground">
              <Link href="/auth" className="text-primary underline underline-offset-4 hover:text-primary/80">
                Back to sign in
              </Link>
            </p>
          </CardContent>
        </Card>
    </AuthShell>
  )
}
