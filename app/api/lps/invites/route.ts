import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

/**
 * Admin-only LP invites (Phase 1 of LP reporting).
 *
 *   GET  → list the LP account links for this fund (who's invited / active).
 *   POST { lp_investor_id, email, display_name? }
 *        → create (or reuse) an lp_account for the email, link it to the given
 *          lp_investor in this fund, and email an OTP invite. The auth.users row
 *          is bound when available; portal onboarding (Phase 2) activates it.
 *
 * Writes go through the service-role admin client with manual fund scoping; the
 * lp_investor is verified to belong to the admin's fund before any linking.
 */

export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { data, error } = await (admin as any)
    .from('lp_account_links')
    .select('id, lp_investor_id, created_at, lp_accounts(id, email, display_name, status, kind), lp_investors(name)')
    .eq('fund_id', writeCheck.fundId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invites: data ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const lpInvestorId = typeof body.lp_investor_id === 'string' ? body.lp_investor_id : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  if (!lpInvestorId) return NextResponse.json({ error: 'lp_investor_id is required' }, { status: 400 })

  // The investor must belong to the admin's fund — never trust the body's scope.
  const { data: investor } = await (admin as any)
    .from('lp_investors')
    .select('id')
    .eq('id', lpInvestorId)
    .eq('fund_id', writeCheck.fundId)
    .maybeSingle()
  if (!investor) return NextResponse.json({ error: 'Investor not found in your fund' }, { status: 404 })

  // lp_accounts is the LP-access whitelist the before-user-created auth hook
  // checks, so the account must exist BEFORE we invite. Find or create it first.
  const { data: existing } = await (admin as any)
    .from('lp_accounts')
    .select('id, auth_user_id')
    .eq('email', email)
    .maybeSingle()

  let lpAccountId: string
  if (existing) {
    lpAccountId = existing.id
  } else {
    const { data: created, error: createErr } = await (admin as any)
      .from('lp_accounts')
      .insert({ kind: 'lp', email, display_name: displayName || null, status: 'invited' })
      .select('id')
      .single()
    if (createErr) return NextResponse.json({ error: createErr.message }, { status: 500 })
    lpAccountId = created.id
  }

  // Email the OTP invite — the hook now recognizes this email as an invited LP.
  // Bind the auth user when available; otherwise onboarding binds it by email.
  try {
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email)
    if (inviteErr) console.warn('[lp invite] inviteUserByEmail:', inviteErr.message)
    else if (invited?.user?.id && !existing?.auth_user_id) {
      await (admin as any)
        .from('lp_accounts')
        .update({ auth_user_id: invited.user.id, updated_at: new Date().toISOString() })
        .eq('id', lpAccountId)
    }
  } catch (e) {
    console.warn('[lp invite] inviteUserByEmail threw:', e instanceof Error ? e.message : e)
  }

  // Link the account to the investor for this fund (idempotent).
  const { error: linkErr } = await (admin as any)
    .from('lp_account_links')
    .insert({
      lp_account_id: lpAccountId,
      fund_id: writeCheck.fundId,
      lp_investor_id: lpInvestorId,
      created_by: user.id,
    })
  if (linkErr && linkErr.code !== '23505') {
    return NextResponse.json({ error: linkErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, lp_account_id: lpAccountId })
}

// DELETE ?id=<lp_account_links.id> → revoke a direct LP-investor link for this fund.
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Scope the unlink to the admin's own fund.
  const { error } = await (admin as any)
    .from('lp_account_links')
    .delete()
    .eq('id', id)
    .eq('fund_id', writeCheck.fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
