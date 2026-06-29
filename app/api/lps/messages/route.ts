import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

// GP-admin inbox for LP portal "Contact" messages (lib/api: lp_messages).
async function requireAdmin() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient() as any
  const { data: m } = await admin.from('fund_members').select('fund_id, role').eq('user_id', user.id).maybeSingle()
  if (!m) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  if (m.role !== 'admin') return { error: NextResponse.json({ error: 'Admin access required' }, { status: 403 }) }
  return { admin, fundId: m.fund_id as string }
}

export async function GET() {
  const c = await requireAdmin()
  if ('error' in c) return c.error
  const { data } = await c.admin
    .from('lp_messages')
    .select('id, from_email, subject, body, status, created_at, lp_investors(name)')
    .eq('fund_id', c.fundId)
    .order('created_at', { ascending: false })
    .limit(200)
  const messages = ((data ?? []) as any[]).map(r => ({
    id: r.id,
    from_email: r.from_email,
    subject: r.subject,
    body: r.body,
    status: r.status,
    created_at: r.created_at,
    investor_name: r.lp_investors?.name ?? null,
  }))
  return NextResponse.json({ messages })
}

export async function PATCH(req: NextRequest) {
  const c = await requireAdmin()
  if ('error' in c) return c.error
  const body = await req.json().catch(() => ({}))
  const id = typeof body.id === 'string' ? body.id : ''
  const status = body.status === 'resolved' ? 'resolved' : 'open'
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await c.admin.from('lp_messages').update({ status }).eq('id', id).eq('fund_id', c.fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
