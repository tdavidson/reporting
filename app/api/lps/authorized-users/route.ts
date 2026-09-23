import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { sendLpInvite, ensureLpAccount, bindAuthUser } from '@/lib/lp-invites'

/**
 * Admin-only authorized-user management (Phase 4 of LP reporting).
 *
 * An authorized user (e.g. an LP's advisor) gets delegated, read-only portal
 * access to a specific investor's data, acting for that investor's primary LP.
 * resolveLpAccess() and get_my_lp_investor_ids() already union the delegated
 * path, so creating the lp_authorized_users row is all that's needed for access.
 *
 *   GET    → authorized users across this fund's investors.
 *   POST   { lp_investor_id, email, display_name? } → grant + invite.
 *   DELETE ?id=... → revoke a delegation row.
 */

async function adminCtx() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return { error: writeCheck }
  if (writeCheck.role !== 'admin') return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }

  // The fund's investor ids scope every authorized-user query (the delegation
  // table has no fund_id; investors are the tenant boundary).
  const { data: investors } = await (admin as any)
    .from('lp_investors')
    .select('id')
    .eq('fund_id', writeCheck.fundId)
  const fundInvestorIds = (investors ?? []).map((r: any) => r.id as string)
  return { admin, user, fundId: writeCheck.fundId as string, fundInvestorIds }
}

export async function GET() {
  const ctx = await adminCtx()
  if ('error' in ctx) return ctx.error
  const { admin, fundInvestorIds } = ctx
  if (fundInvestorIds.length === 0) return NextResponse.json({ authorized_users: [] })

  const { data, error } = await (admin as any)
    .from('lp_authorized_users')
    .select('id, lp_investor_id, created_at, lp_investors(name), lp_accounts!lp_authorized_users_authorized_user_account_id_fkey(email, display_name, status)')
    .in('lp_investor_id', fundInvestorIds)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'lps-authorized-users')
  return NextResponse.json({ authorized_users: data ?? [] })
}

export async function POST(req: NextRequest) {
  const ctx = await adminCtx()
  if ('error' in ctx) return ctx.error
  const { admin, user, fundId, fundInvestorIds } = ctx

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const lpInvestorId = typeof body.lp_investor_id === 'string' ? body.lp_investor_id : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  if (!fundInvestorIds.includes(lpInvestorId)) return NextResponse.json({ error: 'Investor not found in your fund' }, { status: 404 })

  // The investor must have a primary LP account for an authorized user to act for.
  const { data: links } = await (admin as any)
    .from('lp_account_links')
    .select('lp_account_id, lp_accounts(id, kind)')
    .eq('fund_id', fundId)
    .eq('lp_investor_id', lpInvestorId)
  const principal = (links ?? []).find((l: any) => l.lp_accounts?.kind === 'lp')
  if (!principal) {
    return NextResponse.json({ error: "Invite this investor's LP before adding an authorized user." }, { status: 409 })
  }

  // lp_accounts is the LP-access whitelist the auth hook checks, so the account
  // must exist BEFORE we invite. Find or create it first (reuses an existing
  // account for this email — the same login may be an LP for some investors and
  // an authorized user for others; the delegation row is what grants access).
  const account = await ensureLpAccount(admin, email, 'authorized_user', displayName || null)
  if (!account) return NextResponse.json({ error: 'Could not create the account' }, { status: 500 })
  const accountId = account.id

  const { error: linkErr } = await (admin as any)
    .from('lp_authorized_users')
    .insert({
      authorized_user_account_id: accountId,
      principal_lp_account_id: principal.lp_account_id,
      lp_investor_id: lpInvestorId,
      created_by: user.id,
    })
  if (linkErr && linkErr.code !== '23505') {
    return dbError(linkErr, 'lps-authorized-users')
  }

  // Someone who already has portal access (an LP elsewhere, an advisor to a second investor)
  // needs no invite; the delegation row alone grants the access.
  if (account.status === 'active') return NextResponse.json({ ok: true, emailed: false, already_active: true })

  const { data: fund } = await admin.from('funds').select('name').eq('id', fundId).maybeSingle()
  const result = await sendLpInvite(admin, {
    fundId, fundName: fund?.name ?? null, email, lpAccountId: accountId, lpInvestorId, sentBy: user.id,
  })
  await bindAuthUser(admin, accountId, result.authUserId, account.auth_user_id)

  return NextResponse.json({ ok: true, emailed: result.method !== null, method: result.method, warning: result.error })
}

export async function DELETE(req: NextRequest) {
  const ctx = await adminCtx()
  if ('error' in ctx) return ctx.error
  const { admin, fundInvestorIds } = ctx

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Scope the revoke to this fund's investors.
  const { error } = await (admin as any)
    .from('lp_authorized_users')
    .delete()
    .eq('id', id)
    .in('lp_investor_id', fundInvestorIds.length ? fundInvestorIds : ['00000000-0000-0000-0000-000000000000'])
  if (error) return dbError(error, 'lps-authorized-users')
  return NextResponse.json({ ok: true })
}
