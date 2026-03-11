import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  // Get notification preference
  const { data: pref } = await admin
    .from('note_notification_preferences' as any)
    .select('level')
    .eq('user_id', user.id)
    .eq('fund_id', membership.fund_id)
    .maybeSingle() as { data: { level: string } | null }

  // Get company subscriptions
  const { data: subs } = await admin
    .from('note_company_subscriptions' as any)
    .select('company_id')
    .eq('user_id', user.id) as { data: { company_id: string }[] | null }

  return NextResponse.json({
    level: pref?.level ?? 'mentions',
    subscribedCompanyIds: (subs ?? []).map(s => s.company_id),
  })
}

export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const body = await req.json()
  const { level, subscribedCompanyIds } = body

  // Update notification level
  if (level !== undefined) {
    if (!['all', 'mentions', 'none'].includes(level)) {
      return NextResponse.json({ error: 'Invalid level' }, { status: 400 })
    }

    await admin
      .from('note_notification_preferences' as any)
      .upsert({
        user_id: user.id,
        fund_id: membership.fund_id,
        level,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,fund_id' })
  }

  // Update company subscriptions
  if (Array.isArray(subscribedCompanyIds)) {
    // Delete existing subscriptions
    await admin
      .from('note_company_subscriptions' as any)
      .delete()
      .eq('user_id', user.id)

    // Insert new ones — validate all company IDs belong to this fund
    if (subscribedCompanyIds.length > 0) {
      const { data: validCompanies } = await admin
        .from('companies')
        .select('id')
        .in('id', subscribedCompanyIds)
        .eq('fund_id', membership.fund_id)
      const validIds = new Set((validCompanies ?? []).map((c: { id: string }) => c.id))
      const safeIds = subscribedCompanyIds.filter((id: string) => validIds.has(id))

      if (safeIds.length > 0) {
        const rows = safeIds.map((companyId: string) => ({
          user_id: user.id,
          company_id: companyId,
          fund_id: membership.fund_id,
        }))
        await admin
          .from('note_company_subscriptions' as any)
          .insert(rows)
      }
    }
  }

  return NextResponse.json({ ok: true })
}
