'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function DemoPage() {
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function startDemo() {
      // If already signed in, go to dashboard
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.replace('/dashboard')
        return
      }

      // Fetch demo credentials from server
      const res = await fetch('/api/demo/credentials', {
        headers: { 'x-deployment-key': process.env.NEXT_PUBLIC_DEMO_KEY ?? '' },
      })
      if (!res.ok) {
        setError('Demo is not available.')
        return
      }
      const { email, password } = await res.json()

      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        // Log the actual error for debugging (remove in production)
        console.error('[demo] signInWithPassword failed:', error.message, error.status)
        setError(`Unable to load demo. (${error.message})`)
        return
      }

      router.replace('/dashboard')
    }
    startDemo()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <a href="/auth" className="text-sm text-blue-600 underline">Go to sign in</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <p className="text-sm text-muted-foreground">Loading demo…</p>
    </div>
  )
}
