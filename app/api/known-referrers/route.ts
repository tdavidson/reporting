import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

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
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const { data, error } = await admin
    .from('known_referrers')
    .select('id, email, name, notes, created_at')
    .eq('fund_id', membership.fund_id)
    .order('created_at', { ascending: false })

  if (error) return dbError(error, 'known-referrers')
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
  const name = typeof body.name === 'string' ? body.name.trim() : null
  const notes = typeof body.notes === 'string' ? body.notes.trim() : null

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Valid email required' }, { status: 400 })
  }

  const { data, error } = await admin
    .from('known_referrers')
    .upsert({
      fund_id: membership.fund_id,
      email,
      name: name || null,
      notes: notes || null,
      added_by: user.id,
    }, { onConflict: 'fund_id,email' })
    .select('id, email, name, notes, created_at')
    .single()

  if (error) return dbError(error, 'known-referrers')
  return NextResponse.json(data)
}
