import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
import { parseSiteContent } from '@/lib/marketing/content'

async function ctx() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: m } = await admin.from('fund_members').select('role').eq('user_id', user.id).maybeSingle()
  if (!m) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return { admin, role: (m as any).role as string }
}

export async function GET() {
  const c = await ctx()
  if ('error' in c) return c.error
  const { data } = await (c.admin as any).from('site_content').select('content').eq('id', true).maybeSingle()
  return NextResponse.json({ content: (data?.content ?? null) })
}

export async function PATCH(req: NextRequest) {
  const c = await ctx()
  if ('error' in c) return c.error
  if (c.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const content = body?.content
  // Reject anything that wouldn't render (same validator the page uses).
  if (parseSiteContent(content) === null) {
    return NextResponse.json({ error: 'Invalid content: needs a hero (title+subtitle) and at least one product group with a feature.' }, { status: 400 })
  }

  const { error } = await (c.admin as any)
    .from('site_content')
    .upsert({ id: true, content, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  if (error) return dbError(error, 'settings-site-content')
  return NextResponse.json({ ok: true })
}
