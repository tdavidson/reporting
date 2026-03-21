'use server'

import { timingSafeEqual } from 'crypto'

/**
 * Server action to fetch demo credentials.
 * Runs server-side so the DEMO_KEY never reaches the client bundle.
 */
export async function getDemoCredentials(): Promise<
  { ok: true; email: string; password: string } | { ok: false; error: string }
> {
  const deployKey = process.env.MARKETING_DEPLOYMENT_KEY
  if (process.env.NEXT_PUBLIC_ENABLE_MARKETING_SITE !== 'true' || !deployKey) {
    return { ok: false, error: 'Demo is not available.' }
  }

  const email = process.env.DEMO_USER_EMAIL
  const password = process.env.DEMO_USER_PASSWORD

  if (!email || !password) {
    return { ok: false, error: 'Demo not configured.' }
  }

  return { ok: true, email, password }
}
