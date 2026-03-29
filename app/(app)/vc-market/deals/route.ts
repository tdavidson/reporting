import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
 
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 
  const { searchParams } = req.nextUrl
  const period  = searchParams.get('period')   ?? 'ytd'
  const country  = searchParams.get('country')  ?? ''
  const segment  = searchParams.get('segment')  ?? ''
  const stage    = searchParams.get('stage')    ?? ''
  const investor = searchParams.get('investor') ?? ''
 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query = (supabase as any)
    .from('vc_deals')
    .select('*')
    .order('deal_date', { ascending: false })
 
  // Period filter
  const now = new Date()
  const y   = now.getFullYear()
  if (period === 'ytd') {
    query = query.gte('deal_date', `${y}-01-01`)
  } else if (period === 'last_year') {
    query = query
      .gte('deal_date', `${y - 1}-01-01`)
      .lte('deal_date', `${y - 1}-12-31`)
  } else if (/^\d{4}$/.test(period)) {
    query = query
      .gte('deal_date', `${period}-01-01`)
      .lte('deal_date', `${period}-12-31`)
  } else if (['q1', 'q2', 'q3', 'q4'].includes(period)) {
    const ranges: Record<string, [string, string]> = {
      q1: ['01-01', '03-31'],
      q2: ['04-01', '06-30'],
      q3: ['07-01', '09-30'],
      q4: ['10-01', '12-31'],
    }
    const [from, to] = ranges[period]
    query = query
      .gte('deal_date', `${y}-${from}`)
      .lte('deal_date', `${y}-${to}`)
  }
  // 'all' → no date filter
 
  if (country)  query = query.eq('country', country)
  if (segment)  query = query.eq('segment', segment)
  if (stage)    query = query.eq('stage', stage)
  if (investor) query = query.contains('investors', [investor])
 
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
 
  return NextResponse.json({ deals: data ?? [] })
}
 
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 
  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
 
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).from('vc_deals').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
 
  return NextResponse.json({ ok: true })
}
