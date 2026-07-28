'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { startDemo } from './actions'

export default function DemoPage() {
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    async function run() {
      // If already signed in, go to dashboard — no reason to mint a second session.
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        router.replace('/dashboard')
        return
      }

      // The server signs the visitor in and hands back cookies. No credential is returned
      // here, and this page no longer touches Supabase auth to get in — that is the point.
      const result = await startDemo()
      if (!result.ok) {
        setError(result.error)
        return
      }

      router.replace('/dashboard')
    }
    run()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">{error}</p>
          <a href="/auth" className="text-sm text-info underline">Go to sign in</a>
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
