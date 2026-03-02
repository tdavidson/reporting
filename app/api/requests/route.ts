import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

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

  const { data, error } = await admin
    .from('email_requests')
    .select('id, subject, body_html, recipients, quarter_label, status, sent_at, send_results, created_at')
    .eq('fund_id', membership.fund_id)
    .order('created_at', { ascending: false })
    .limit(20)

  if (error) return dbError(error, 'requests')

  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { subject, body_html, recipients, quarter_label } = body

  if (!subject?.trim()) return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!body_html?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 })

  const { data, error } = await admin
    .from('email_requests')
    .insert({
      fund_id: membership.fund_id,
      subject: subject.trim(),
      body_html: body_html.trim(),
      recipients: recipients ?? [],
      quarter_label: quarter_label?.trim() || null,
      sent_by: user.id,
      status: 'draft',
    })
    .select()
    .single()

  if (error) return dbError(error, 'requests')

  return NextResponse.json(data, { status: 201 })
}
