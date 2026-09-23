import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { sendLpInvite, bindAuthUser } from '@/lib/lp-invites'

/**
 * Admin-only: re-send an LP's invite.
 *
 *   POST { lp_account_id } → email the welcome link again to an invited (not yet active) account
 *   linked to this fund, through the same helper as the first invite. With an outbound provider
 *   configured that is the fund's own email; without one, Supabase's invite, which cannot re-send
 *   to an address it already knows and says so. Logged to lp_deliveries either way.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const fundId = writeCheck.fundId
  const a = admin as any

  const body = await req.json().catch(() => ({}))
  const lpAccountId = typeof body.lp_account_id === 'string' ? body.lp_account_id : ''
  if (!lpAccountId) return NextResponse.json({ error: 'lp_account_id is required' }, { status: 400 })

  const { data: link } = await a
    .from('lp_account_links')
    .select('lp_investor_id, lp_accounts(id, email, status, auth_user_id)')
    .eq('fund_id', fundId).eq('lp_account_id', lpAccountId).limit(1).maybeSingle()
  const account = link?.lp_accounts
  if (!account) return NextResponse.json({ error: 'Account not found in your fund' }, { status: 404 })
  if (account.status === 'active') return NextResponse.json({ error: 'This LP has already activated their access.' }, { status: 409 })
  if (account.status === 'disabled') return NextResponse.json({ error: 'This account is disabled. Re-enable it first.' }, { status: 409 })

  const { data: fund } = await admin.from('funds').select('name').eq('id', fundId).maybeSingle()
  const result = await sendLpInvite(admin, {
    fundId, fundName: fund?.name ?? null, email: account.email, lpAccountId: account.id,
    lpInvestorId: link.lp_investor_id, sentBy: user.id,
  })
  await bindAuthUser(admin, account.id, result.authUserId, account.auth_user_id)

  if (result.method === null) return NextResponse.json({ ok: false, emailed: false, error: result.error }, { status: 502 })
  return NextResponse.json({ ok: true, emailed: true, method: result.method })
}
