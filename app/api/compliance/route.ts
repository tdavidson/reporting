import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const [itemsRes, profileRes, settingsRes, deadlinesRes, groupsRes, commitmentsRes] = await Promise.all([
    admin.from('compliance_items').select('*').order('sort_order'),
    admin.from('fund_compliance_profile').select('*').eq('fund_id', membership.fund_id).maybeSingle(),
    admin.from('compliance_fund_settings').select('*').eq('fund_id', membership.fund_id),
    admin.from('compliance_deadlines').select('*').eq('fund_id', membership.fund_id).order('due_date'),
    // Vintage comes from the VEHICLE now, not fund_group_config — that table was keyed by the
    // free-text group name and also carried carry_rate / gp_commit_pct, both obsolete. Reading
    // vintage from two places is how the two start disagreeing.
    admin.from('fund_vehicles' as any).select('name, vintage_year').eq('fund_id', membership.fund_id) as unknown as { data: { name: string; vintage_year: number | null }[] | null; error: any },
    // Commitment entries = closes — get dates for current year to place event-driven items
    admin.from('fund_cash_flows')
      .select('portfolio_group, flow_date')
      .eq('fund_id', membership.fund_id)
      .eq('flow_type', 'commitment')
      .gte('flow_date', `${new Date().getFullYear()}-01-01`)
      .lte('flow_date', `${new Date().getFullYear()}-12-31`)
      .order('flow_date'),
  ])

  const groups = ((groupsRes.data ?? []) as unknown as { name: string; vintage_year: number | null }[])
    .map(v => ({ portfolio_group: v.name, vintage: v.vintage_year }))

  // Build a map of portfolio_group -> months with closes
  const closeMonths: Record<string, number[]> = {}
  for (const row of (commitmentsRes.data ?? []) as { portfolio_group: string; flow_date: string }[]) {
    const month = new Date(row.flow_date).getMonth() + 1
    if (!closeMonths[row.portfolio_group]) closeMonths[row.portfolio_group] = []
    if (!closeMonths[row.portfolio_group].includes(month)) {
      closeMonths[row.portfolio_group].push(month)
    }
  }

  return NextResponse.json({
    items: itemsRes.data ?? [],
    profile: profileRes.data ?? null,
    settings: settingsRes.data ?? [],
    deadlines: deadlinesRes.data ?? [],
    portfolioGroups: groups.map(g => g.portfolio_group).sort(),
    closeMonths,
  })
}
