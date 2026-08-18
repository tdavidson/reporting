import { cache } from 'react'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { Database } from '@/lib/types/database'

export function createClient() {
  const cookieStore = cookies()

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options?: Record<string, unknown> }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component — cookie writes are a no-op.
            // Middleware handles session refresh in that case.
          }
        },
      },
    }
  )
}

/**
 * The signed-in user, resolved ONCE per request.
 *
 * `auth.getUser()` is a network call — it asks the Auth server to validate the token
 * rather than trusting the cookie, which is why it is the right call to make and why
 * making it twice is expensive. Every page navigation used to make it at least twice
 * on the render path alone: once in app/(app)/layout.tsx and again in the page under
 * it, each with a fresh client that carries no session in memory. Two serial round
 * trips to Supabase before the page's own queries can start.
 *
 * React's `cache` dedupes within a single request, so the layout and the page now
 * share one. This is per-REQUEST memoisation, not a cache with a TTL: nothing is
 * remembered between requests, so a revoked session is still noticed on the next one.
 *
 * The middleware's own getUser is separate and stays — it runs in another runtime,
 * before this one exists, and it is what refreshes the session cookie.
 */
export const getUser = cache(async () => {
  const { data: { user } } = await createClient().auth.getUser()
  return user
})
