import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { sendLpInvite, ensureLpAccount, bindAuthUser, ensureEntityForInvestor } from '@/lib/lp-invites'

/**
 * Admin-only LP invites and portal accounts.
 *
 *   GET  → every LP account linked to an investor in this fund: who is invited, active or
 *          disabled, when they last signed in, and when they were last emailed an invite.
 *   POST { lp_investor_id, email, display_name? }
 *        → create (or reuse) an lp_account for the email, link it to the investor, and email the
 *          invite. The response says whether an email actually went out (`emailed`) and why not
 *          when it didn't — an invite that silently failed used to read as "Invited".
 *   PATCH { lp_account_id, status: 'active' | 'disabled' }
 *        → disable an LP (they and their authorized users lose the portal at the next request;
 *          they stop receiving LP emails) or re-enable one.
 *   DELETE ?id=<lp_account_links.id> → unlink an account from an investor.
 *
 * Writes go through the service-role admin client with manual fund scoping; the lp_investor is
 * verified to belong to the admin's fund before any linking.
 */

type AdminCtx =
  | { error: NextResponse; admin?: undefined; user?: undefined; fundId?: undefined }
  | { error?: undefined; admin: ReturnType<typeof createAdminClient>; user: { id: string }; fundId: string }

async function adminCtx(): Promise<AdminCtx> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return { error: writeCheck }
  if (writeCheck.role !== 'admin') return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  return { admin, user, fundId: writeCheck.fundId as string }
}

export async function GET(): Promise<NextResponse> {
  const ctx = await adminCtx()
  if (ctx.error) return ctx.error
  const { admin, fundId } = ctx
  const a = admin as any

  const { data, error } = await a
    .from('lp_account_links')
    .select('id, lp_investor_id, created_at, lp_accounts(id, email, display_name, status, kind, auth_user_id), lp_investors(name)')
    .eq('fund_id', fundId)
    .order('created_at', { ascending: false })
  if (error) return dbError(error, 'lps-invites')

  const links = (data ?? []) as any[]
  const accountIds = Array.from(new Set(links.map(l => l.lp_accounts?.id).filter(Boolean))) as string[]

  // Last sign-in and last invite per account, from the two logs that record them.
  const lastLogin = new Map<string, string>()
  const lastInvite = new Map<string, { at: string; status: string; error: string | null }>()
  if (accountIds.length > 0) {
    const [{ data: logins }, { data: invites }] = await Promise.all([
      a.from('lp_access_events').select('lp_account_id, created_at').eq('fund_id', fundId).eq('event_type', 'login').in('lp_account_id', accountIds).order('created_at', { ascending: false }),
      a.from('lp_deliveries').select('item_id, sent_at, status, error').eq('fund_id', fundId).eq('kind', 'invite').in('item_id', accountIds).order('sent_at', { ascending: false }),
    ])
    for (const r of (logins ?? []) as any[]) if (!lastLogin.has(r.lp_account_id)) lastLogin.set(r.lp_account_id, r.created_at)
    for (const r of (invites ?? []) as any[]) if (!lastInvite.has(r.item_id)) lastInvite.set(r.item_id, { at: r.sent_at, status: r.status, error: r.error ?? null })
  }

  const invites = links.map(l => {
    const acct = l.lp_accounts ?? null
    const inv = acct ? lastInvite.get(acct.id) : undefined
    return {
      id: l.id,
      lp_investor_id: l.lp_investor_id,
      created_at: l.created_at,
      lp_accounts: acct ? { id: acct.id, email: acct.email, display_name: acct.display_name, status: acct.status, kind: acct.kind } : null,
      lp_investors: l.lp_investors ?? null,
      last_login_at: acct ? (lastLogin.get(acct.id) ?? null) : null,
      last_invite_at: inv?.at ?? null,
      last_invite_status: inv?.status ?? null,
      last_invite_error: inv?.error ?? null,
    }
  })
  return NextResponse.json({ invites })
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const ctx = await adminCtx()
  if (ctx.error) return ctx.error
  const { admin, user, fundId } = ctx
  const a = admin as any

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const lpInvestorId = typeof body.lp_investor_id === 'string' ? body.lp_investor_id : ''
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : ''
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'A valid email is required' }, { status: 400 })
  if (!lpInvestorId) return NextResponse.json({ error: 'lp_investor_id is required' }, { status: 400 })

  // The investor must belong to the admin's fund — never trust the body's scope.
  const { data: investor } = await a.from('lp_investors').select('id, name').eq('id', lpInvestorId).eq('fund_id', fundId).maybeSingle()
  if (!investor) return NextResponse.json({ error: 'Investor not found in your fund' }, { status: 404 })
  await ensureEntityForInvestor(admin, fundId, investor.id, investor.name)

  // lp_accounts is the LP-access whitelist the before-user-created auth hook checks, so the
  // account must exist BEFORE we invite.
  const account = await ensureLpAccount(admin, email, 'lp', displayName || null)
  if (!account) return NextResponse.json({ error: 'Could not create the LP account' }, { status: 500 })

  // Link the account to the investor for this fund (idempotent) before emailing, so a send
  // failure leaves a row the admin can resend from.
  const { error: linkErr } = await a
    .from('lp_account_links')
    .insert({ lp_account_id: account.id, fund_id: fundId, lp_investor_id: lpInvestorId, created_by: user.id })
  if (linkErr && linkErr.code !== '23505') return dbError(linkErr, 'lps-invites')

  // An account that is already active needs no invite; say so rather than emailing a welcome
  // link to someone who has a password.
  if (account.status === 'active') {
    return NextResponse.json({ ok: true, lp_account_id: account.id, emailed: false, already_active: true })
  }

  const { data: fund } = await admin.from('funds').select('name').eq('id', fundId).maybeSingle()
  const result = await sendLpInvite(admin, {
    fundId, fundName: fund?.name ?? null, email, lpAccountId: account.id, lpInvestorId, sentBy: user.id,
  })
  await bindAuthUser(admin, account.id, result.authUserId, account.auth_user_id)

  return NextResponse.json({
    ok: true,
    lp_account_id: account.id,
    emailed: result.method !== null,
    method: result.method,
    warning: result.error,
  })
}

export async function PATCH(req: NextRequest): Promise<NextResponse> {
  const ctx = await adminCtx()
  if (ctx.error) return ctx.error
  const { admin, fundId } = ctx
  const a = admin as any

  const body = await req.json().catch(() => ({}))
  const lpAccountId = typeof body.lp_account_id === 'string' ? body.lp_account_id : ''
  const status = body.status === 'disabled' ? 'disabled' : body.status === 'active' ? 'active' : null
  if (!lpAccountId) return NextResponse.json({ error: 'lp_account_id is required' }, { status: 400 })
  if (!status) return NextResponse.json({ error: "status must be 'active' or 'disabled'" }, { status: 400 })

  // Only accounts linked to this fund's investors are this admin's to switch.
  const { data: link } = await a
    .from('lp_account_links').select('id, lp_accounts(id, status, auth_user_id)')
    .eq('fund_id', fundId).eq('lp_account_id', lpAccountId).limit(1).maybeSingle()
  if (!link?.lp_accounts) return NextResponse.json({ error: 'Account not found in your fund' }, { status: 404 })

  // Re-enabling an account that never activated puts it back to 'invited', not 'active': the LP
  // still has to finish the welcome flow, and 'active' without a bound auth user is the
  // corrupted state the activate route refuses to bind by email.
  const next = status === 'active' && !link.lp_accounts.auth_user_id ? 'invited' : status
  const { error } = await a
    .from('lp_accounts')
    .update({ status: next, updated_at: new Date().toISOString() })
    .eq('id', lpAccountId)
  if (error) return dbError(error, 'lps-invites')
  return NextResponse.json({ ok: true, status: next })
}

// DELETE ?id=<lp_account_links.id> → revoke a direct LP-investor link for this fund.
export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const ctx = await adminCtx()
  if (ctx.error) return ctx.error
  const { admin, fundId } = ctx

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  // Scope the unlink to the admin's own fund.
  const { error } = await (admin as any)
    .from('lp_account_links')
    .delete()
    .eq('id', id)
    .eq('fund_id', fundId)
  if (error) return dbError(error, 'lps-invites')
  return NextResponse.json({ ok: true })
}
