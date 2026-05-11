import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const VALID_PARSE_STATUSES = ['pending', 'parsed', 'partial', 'failed', 'skipped'] as const

export async function PATCH(req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const body = await req.json().catch(() => ({}))
  const updates: Record<string, unknown> = {}

  if (typeof body.detected_type === 'string' || body.detected_type === null) {
    updates.detected_type = body.detected_type
    // Manual reclassification = high confidence (the partner just said so).
    if (body.detected_type) updates.type_confidence = 'high'
  }
  if (typeof body.parse_status === 'string' && VALID_PARSE_STATUSES.includes(body.parse_status as any)) {
    updates.parse_status = body.parse_status
  }
  if (typeof body.parse_notes === 'string' || body.parse_notes === null) {
    updates.parse_notes = body.parse_notes
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  const { error } = await admin
    .from('diligence_documents')
    .update(updates)
    .eq('id', params.docId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; docId: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  // Fetch the storage path so we can clean up the object.
  const { data: doc } = await admin
    .from('diligence_documents')
    .select('storage_path')
    .eq('id', params.docId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { error } = await admin
    .from('diligence_documents')
    .delete()
    .eq('id', params.docId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Best-effort: remove the storage object. Non-blocking for the API response.
  if ((doc as any).storage_path) {
    admin.storage.from('diligence-documents').remove([(doc as any).storage_path]).catch(err => {
      console.warn('[diligence-documents] storage cleanup failed:', err)
    })
  }

  return NextResponse.json({ ok: true })
}

async function ensureMember() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  return {
    admin,
    fundId: (membership as any).fund_id as string,
    userId: user.id,
  }
}
