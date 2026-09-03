import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { aggregatePortfolioData } from '@/lib/lp-letters/aggregate'
import { rateLimit } from '@/lib/rate-limit'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `lp-preview:${user.id}`, limit: 30, windowSeconds: 60 })
  if (limited) return limited

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund' }, { status: 403 })

  const { searchParams } = req.nextUrl
  const year = parseInt(searchParams.get('year') ?? '')
  const quarter = parseInt(searchParams.get('quarter') ?? '')
  const group = searchParams.get('group') ?? ''
  const isYearEnd = searchParams.get('yearEnd') === 'true'

  if (!year || !quarter || !group) {
    return NextResponse.json({ error: 'year, quarter, and group are required' }, { status: 400 })
  }

  const preview = await aggregatePortfolioData(
    admin, membership.fund_id, year, quarter, group, isYearEnd
  )

  return NextResponse.json(preview)
}
