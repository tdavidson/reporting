import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

/**
 * Bind + activate the signed-in user's LP account (called at the end of portal
 * onboarding, after they've verified their code and set a password).
 *
 * Finds the lp_account by auth_user_id, falling back to a case-insensitive
 * email match (the invite may not have pre-bound the auth user), then sets
 * auth_user_id + status = 'active'. Idempotent.
 */
export async function POST() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let { data: account } = await (admin as any)
    .from('lp_accounts')
    .select('id, status, auth_user_id')
    .eq('auth_user_id', user.id)
    .maybeSingle()

  // Email is only proof of ownership once the address is confirmed. Without this,
  // a project with email confirmations disabled would let an attacker sign up
  // under an invited LP's email and bind that account by email match alone.
  const emailVerified = !!((user as any).email_confirmed_at || (user as any).confirmed_at)
  if (!account && user.email && emailVerified) {
    const { data: byEmail } = await (admin as any)
      .from('lp_accounts')
      .select('id, status, auth_user_id')
      .eq('email', user.email.toLowerCase())
      .maybeSingle()
    account = byEmail
  }

  if (!account) {
    return NextResponse.json({ error: 'No LP invitation is associated with this account.' }, { status: 403 })
  }

  // Guard: don't hijack an account already bound to a different auth user.
  if (account.auth_user_id && account.auth_user_id !== user.id) {
    return NextResponse.json({ error: 'This invitation is linked to a different account.' }, { status: 409 })
  }

  // Already activated for this same user — idempotent no-op.
  if (account.status === 'active' && account.auth_user_id === user.id) {
    return NextResponse.json({ ok: true })
  }

  // An active account with no bound auth user is a corrupted state; refuse to
  // (re)bind it via the email path rather than risk an unintended takeover.
  if (account.status === 'active' && !account.auth_user_id) {
    return NextResponse.json({ error: 'This account needs to be re-invited.' }, { status: 409 })
  }

  const { error } = await (admin as any)
    .from('lp_accounts')
    .update({ auth_user_id: user.id, status: 'active', updated_at: new Date().toISOString() })
    .eq('id', account.id)
  if (error) return dbError(error, 'portal-activate')

  return NextResponse.json({ ok: true })
}
