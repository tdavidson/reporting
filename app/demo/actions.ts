'use server'

import { createHash } from 'crypto'
import { headers } from 'next/headers'
import { checkBotId } from 'botid/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, getClientIpFromHeaders } from '@/lib/rate-limit'

export type StartDemoResult = { ok: true } | { ok: false; error: string }

/**
 * Reduce a Referer header to its bare origin, or nothing.
 *
 * `Referrer-Policy: strict-origin-when-cross-origin` (next.config.mjs) is what a compliant
 * BROWSER does. It is not a guarantee about this header: anyone can call a server action with
 * curl and set Referer to a full URL, a query string carrying someone's token, or a chunk of
 * markup. If the "origin only, nothing personal" property is to hold for the column, it has to
 * be enforced here — the policy is a convention among honest clients.
 */
function refererOrigin(value: string | null): string | null {
  if (!value) return null
  try {
    const { origin, protocol } = new URL(value)
    if (protocol !== 'http:' && protocol !== 'https:') return null
    return origin.slice(0, 255)
  } catch {
    return null
  }
}

/** Vercel's geo header is trusted, but shaped-checked so the column only ever holds a code. */
function countryCode(value: string | null): string | null {
  return value && /^[A-Z]{2}$/.test(value) ? value : null
}

/**
 * Sign an anonymous visitor into the shared demo account.
 *
 * The session is minted HERE and handed back as cookies. This action returns no credential —
 * that is the whole point of it. It used to return `{ email, password }` and let the browser
 * call `signInWithPassword` itself, which published the demo password to every visitor who
 * loaded the page. `tests/demo-start.test.ts` pins the absence.
 *
 * SECURITY INVARIANT — the email comes from `process.env` and from NOTHING ELSE, ever. This
 * action takes no arguments and must keep taking none. The moment the account being signed
 * into can be influenced by the caller, this stops being a demo button and becomes an
 * arbitrary-session mint. That constraint is the reason this signs in with a password instead
 * of minting through the admin API: `signInWithPassword` can only ever produce a session for
 * the one account whose password the server holds, so there is no parameter to poison.
 */
export async function startDemo(): Promise<StartDemoResult> {
  // 1. Is there a demo at all? Cheapest check, and it runs before anything with a side effect
  //    so a deployment with the demo switched off does no work and touches no database.
  const email = process.env.DEMO_USER_EMAIL
  const password = process.env.DEMO_USER_PASSWORD
  const marketingEnabled =
    process.env.NEXT_PUBLIC_ENABLE_MARKETING_SITE === 'true' &&
    !!process.env.MARKETING_DEPLOYMENT_KEY

  if (!marketingEnabled) return { ok: false, error: 'Demo is not available.' }
  if (!email || !password) return { ok: false, error: 'Demo is not configured.' }

  const requestHeaders = headers()

  // 2. BotId — defence in depth, never the guarantee. It is a Vercel product, so on any other
  //    host it is unavailable; a self-hoster must get a working demo, not a broken one. Any
  //    failure here is treated as "allow" and the rate limit below does the real work.
  try {
    const { isBot } = await checkBotId()
    if (isBot) return { ok: false, error: 'Demo is not available.' }
  } catch {
    // Not on Vercel, or BotId unreachable. Continue.
  }

  // 3. The guarantee, and it runs everywhere. The IP is hashed into the key because rateLimit
  //    persists that key through the rate_limit_check RPC — a raw key would write the visitor's
  //    address into the database for the window, and this feature stores no addresses.
  //    Obfuscation, not anonymisation: a 32-bit space is brute-forceable. It is hygiene.
  const ip = getClientIpFromHeaders(requestHeaders)
  const limited = await rateLimit({
    key: `demo-start:${createHash('sha256').update(ip).digest('hex').slice(0, 32)}`,
    limit: 10,
    windowSeconds: 300,
  })
  if (limited) return { ok: false, error: 'Too many requests. Please try again shortly.' }

  // 4. Mint. createClient() writes cookies through next/headers — that succeeds in a server
  //    action and only no-ops in a Server Component, which is what makes this approach work.
  const supabase = createClient()
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error || !data.user) {
    // Supabase's own message can describe account state; log it, don't show it.
    console.error('[demo] sign-in failed:', error?.message)
    return { ok: false, error: 'Unable to start the demo. Please try again later.' }
  }

  // 5. The demo is read-only because the account is a `viewer` — a row in a database that
  //    nothing in this repo creates or guards. So check it rather than assume it. If someone
  //    promotes the account, the demo breaks loudly here instead of quietly becoming writable.
  //    The id comes from the sign-in result, never from the caller.
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('role')
    .eq('user_id', data.user.id)
    .maybeSingle()

  if ((membership as { role?: string } | null)?.role !== 'viewer') {
    // The session already exists at this point, so refusing means REVOKING it, not just
    // returning an error. If that revocation fails the visitor keeps a non-viewer session —
    // which is the exact outcome this check exists to prevent — so the failure is escalated
    // rather than swallowed, and signOut is attempted globally to kill the refresh token too.
    const { error: signOutError } = await supabase.auth.signOut({ scope: 'global' })
    if (signOutError) {
      console.error(
        '[demo] SECURITY: demo account is not a viewer and its session could not be revoked:',
        signOutError.message
      )
    } else {
      console.error('[demo] refusing to start: demo account is not a viewer')
    }
    return { ok: false, error: 'Demo is not available.' }
  }

  // 6. Record the start. Nothing here identifies a person: no address, no hash of one, no user
  //    agent. Both values are narrowed before they are stored — see refererOrigin, which does
  //    NOT trust Referrer-Policy to have done it. A logging failure must never cost a visitor
  //    their demo.
  try {
    // `as any` until `supabase db push` runs and lib/types/database.ts is regenerated —
    // demo_sessions ships in 20260728000000 and isn't in the generated types yet.
    const { error: logError } = await (admin as any).from('demo_sessions').insert({
      referrer: refererOrigin(requestHeaders.get('referer')),
      country: countryCode(requestHeaders.get('x-vercel-ip-country')),
    })
    if (logError) console.error('[demo] failed to log start:', logError.message)
  } catch (err) {
    console.error('[demo] failed to log start:', err)
  }

  return { ok: true }
}
