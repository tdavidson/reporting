import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

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
  const supabase = createClient()
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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
  const { data: existing } = await (admin as any)
    .from('lp_accounts')
    .select('id, auth_user_id')
    .eq('email', email)
    .maybeSingle()

  let accountId: string
  if (existing) {
    accountId = existing.id
  } else {
    const { data: created, error: createErr } = await (admin as any)
      .from('lp_accounts')
      .insert({ kind: 'authorized_user', email, display_name: displayName || null, status: 'invited' })
      .select('id')
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    accountId = created.id
  }

  // Email the OTP invite — the hook now recognizes this email as an invited LP user.
  try {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email)
    if (inviteErr) console.warn('[authorized-user invite] inviteUserByEmail:', inviteErr.message)
    else if (invited?.user?.id && !existing?.auth_user_id) {
      await (admin as any).from('lp_accounts').update({ auth_user_id: invited.user.id, updated_at: new Date().toISOString() }).eq('id', accountId)
    }
  } catch (e) {
    console.warn('[authorized-user invite] threw:', e instanceof Error ? e.message : e)
  }

  const { error: linkErr } = await (admin as any)
    .from('lp_authorized_users')
    .insert({
      authorized_user_account_id: accountId,
      principal_lp_account_id: principal.lp_account_id,
      lp_investor_id: lpInvestorId,
      created_by: user.id,
    })
  if (linkErr && linkErr.code !== '23505') {
    return NextResponse.json({ error: linkErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
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
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
