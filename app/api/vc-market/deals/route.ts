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
    const sp = req.nextUrl.searchParams
    const period    = sp.get('period') ?? 'ytd'
    const countries = sp.getAll('country').filter(Boolean)
    const segments  = sp.getAll('segment').filter(Boolean)
    const stages    = sp.getAll('stage').filter(Boolean)
    const investors = sp.getAll('investor').filter(Boolean)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = (admin as any)
      .from('vc_deals')
      .select('*')
      .eq('user_id', user.id)
      .order('deal_date', { ascending: false })

    const { from, to } = getPeriodRange(period)
    if (from) q = q.gte('deal_date', from)
    if (to)   q = q.lte('deal_date', to)
    if (countries.length === 1) q = q.eq('country', countries[0])
    else if (countries.length > 1) q = q.in('country', countries)
    if (segments.length === 1) q = q.eq('segment', segments[0])
    else if (segments.length > 1) q = q.in('segment', segments)
    if (stages.length === 1) q = q.eq('stage', stages[0])
    else if (stages.length > 1) q = q.in('stage', stages)
    if (investors.length > 0) q = q.overlaps('investors', investors)

    const { data, error } = await q
    if (error) throw error

    return NextResponse.json({ deals: data ?? [] })
  } catch (err) {
    console.error('[vc-market/deals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
