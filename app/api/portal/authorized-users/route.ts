import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

/**
 * LP portal — an LP manages the authorized users (advisors) granted access to
 * THEIR account. Scoped strictly to delegations where the signed-in user is the
 * principal (`principal_lp_account_id` = their own lp_account); an authorized
 * user or any other LP can never list or revoke someone else's delegations.
 *
 *   GET    → authorized users delegated on the caller's account.
 *   DELETE ?id=... → revoke one of the caller's delegations.
 */

export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { lpAccountId } = access

  const { data, error } = await (admin as any)
    .from('lp_authorized_users')
    .select('id, lp_investor_id, created_at, lp_investors(name), lp_accounts!lp_authorized_users_authorized_user_account_id_fkey(email, display_name, status)')
    .eq('principal_lp_account_id', lpAccountId)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'portal-authorized-users')
  return NextResponse.json({ authorized_users: data ?? [] })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { lpAccountId } = access

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Scope the revoke to delegations the caller is the principal of.
  const { error } = await (admin as any)
    .from('lp_authorized_users')
    .delete()
    .eq('id', id)
    .eq('principal_lp_account_id', lpAccountId)
  if (error) return dbError(error, 'portal-authorized-users')
  return NextResponse.json({ ok: true })
}
