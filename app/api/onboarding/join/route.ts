import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rateLimit, getClientIp } from '@/lib/rate-limit'
import { dbError } from '@/lib/api-error'

export async function POST(req: NextRequest) {
  // Rate limit: 10 requests per 5 minutes per IP
  const limited = await rateLimit({ key: `onboard-join:${getClientIp(req)}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fundId } = await req.json()
  if (!fundId) return NextResponse.json({ error: 'fundId is required' }, { status: 400 })

  const admin = createAdminClient()

  // Already in a fund? Then there is nothing to request. A user belongs to at most one fund —
  // `fund_members_user_id_unique`, migration 20260511000001 — so approving a second membership
  // would fail against the constraint regardless.
  //
  // This asks about ANY membership, not just one of the target fund. Scoping it to the target
  // was the gap: /demo hands a session for the shared demo account to any anonymous visitor, so
  // if that account's email domain matched a real fund, a visitor could file a join request
  // against it. That can never become access, but it lands an attacker-triggered row in an
  // admin's approval queue — which is worth an admin clicking "approve" on the wrong thing.
  // Stating the schema invariant here closes it, rather than relying on a convention about
  // which email domain the demo account happens to use.
  const { data: existing } = await admin
    .from('fund_members')
    .select('id, fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    const sameFund = (existing as { fund_id: string }).fund_id === fundId
    return NextResponse.json(
      { error: sameFund ? 'You are already a member of this fund' : 'You already belong to a fund' },
      { status: sameFund ? 400 : 403 }
    )
  }

  // Verify the fund exists and the user's email domain matches
  const { data: fund } = await admin
    .from('funds')
    .select('id, name, email_domain')
    .eq('id', fundId)
    .single()

  if (!fund) return NextResponse.json({ error: 'Fund not found' }, { status: 404 })

  const userDomain = user.email?.split('@')[1]?.toLowerCase()
  if (!userDomain || fund.email_domain?.toLowerCase() !== userDomain) {
    return NextResponse.json({ error: 'Email domain does not match this fund' }, { status: 403 })
  }

  // Check for existing pending request
  const { data: existingRequest } = await admin
    .from('fund_join_requests')
    .select('id, status')
    .eq('fund_id', fundId)
    .eq('user_id', user.id)
    .maybeSingle()

  if (existingRequest) {
    return NextResponse.json({
      error: existingRequest.status === 'pending'
        ? 'You already have a pending request'
        : 'A previous request was already processed',
    }, { status: 400 })
  }

  // Create join request
  const { error } = await admin
    .from('fund_join_requests')
    .insert({
      fund_id: fundId,
      user_id: user.id,
      email: user.email!,
      status: 'pending',
    })

  if (error) return dbError(error, 'onboarding-join')

  return NextResponse.json({ ok: true, fundName: fund.name })
}
