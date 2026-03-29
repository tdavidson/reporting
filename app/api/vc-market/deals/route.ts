import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function getPeriodRange(period: string): { from?: string; to?: string } {
  const now = new Date()
  const y = now.getFullYear()
  if (period === 'ytd') return { from: `${y}-01-01` }
  if (period === 'last_year') return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }
  if (period === 'all') return {}
  if (/^\d{4}$/.test(period)) return { from: `${period}-01-01`, to: `${period}-12-31` }
  const qMap: Record<string, [string, string]> = {
    q1: [`${y}-01-01`, `${y}-03-31`],
    q2: [`${y}-04-01`, `${y}-06-30`],
    q3: [`${y}-07-01`, `${y}-09-30`],
    q4: [`${y}-10-01`, `${y}-12-31`],
  }
  if (qMap[period]) return { from: qMap[period][0], to: qMap[period][1] }
  return { from: `${y}-01-01` }
}

export async function GET(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()
    const { data: membership } = await admin
      .from('fund_members')
      .select('fund_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!membership) return NextResponse.json({ deals: [] })
    const fundId = membership.fund_id as string

    const sp = req.nextUrl.searchParams
    const period   = sp.get('period') ?? 'ytd'
    const country  = sp.get('country') ?? ''
    const segment  = sp.get('segment') ?? ''
    const stage    = sp.get('stage') ?? ''
    const investor = sp.get('investor') ?? ''

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (admin as any)
      .from('vc_deals')
      .select('*')
      .eq('fund_id', fundId)
      .order('deal_date', { ascending: false })

    const { from, to } = getPeriodRange(period)
    if (from) q = q.gte('deal_date', from)
    if (to)   q = q.lte('deal_date', to)
    if (country)  q = q.eq('country', country)
    if (segment)  q = q.eq('segment', segment)
    if (stage)    q = q.eq('stage', stage)
    if (investor) q = q.contains('investors', [investor])

    const { data, error } = await q
    if (error) throw error

    return NextResponse.json({ deals: data ?? [] })
  } catch (err) {
    console.error('[vc-market/deals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
