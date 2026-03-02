'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function DemoPage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function startDemo() {
      try {
        const res = await fetch('/api/demo/session', { method: 'POST' })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          setError(data.error ?? 'Demo is not available')
          return
        }

        const { tokenHash, email } = await res.json()
        const supabase = createClient()

        const { error: otpError } = await supabase.auth.verifyOtp({
          token_hash: tokenHash,
          type: 'magiclink',
        })

        if (otpError) {
          setError(otpError.message)
          return
        }

        if (!cancelled) {
          router.replace('/dashboard')
        }
      } catch {
        if (!cancelled) setError('Something went wrong')
      }
    }

    startDemo()
    return () => { cancelled = true }
  }, [router])

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <a href="/auth" className="text-sm text-blue-600 underline">
            Go to sign in
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-2">
        <div className="animate-spin h-6 w-6 border-2 border-muted-foreground border-t-transparent rounded-full mx-auto" />
        <p className="text-sm text-muted-foreground">Loading demo&hellip;</p>
      </div>
    </div>
  )
}
