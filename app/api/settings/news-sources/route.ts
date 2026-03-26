import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

function getFundId(admin: ReturnType<typeof createAdminClient>, userId: string) {
  return admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', userId)
    .maybeSingle()
}

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await getFundId(admin, user.id)
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 404 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: sources } = await (admin as any)
    .from('news_sources')
    .select('id, name, url, enabled, created_at')
    .eq('fund_id', membership.fund_id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ sources: sources ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await getFundId(admin, user.id)
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 404 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { name, url } = await req.json()
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!url?.trim()) return NextResponse.json({ error: 'URL is required' }, { status: 400 })

  let normalized = url.trim()
  if (!/^https?:\/\//i.test(normalized)) normalized = 'https://' + normalized

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('news_sources')
    .insert({ fund_id: membership.fund_id, name: name.trim(), url: normalized })
    .select('id, name, url, enabled, created_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
