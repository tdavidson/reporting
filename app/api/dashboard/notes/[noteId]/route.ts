import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { noteId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const body = await req.json()
  const { content } = body

  if (!content?.trim()) {
    return NextResponse.json({ error: 'Content is required' }, { status: 400 })
  }

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const { data: note } = await admin
    .from('company_notes')
    .select('id, user_id, fund_id')
    .eq('id', params.noteId)
    .eq('fund_id', membership.fund_id)
    .maybeSingle() as { data: { id: string; user_id: string; fund_id: string } | null }

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (note.user_id !== user.id) {
    return NextResponse.json({ error: 'You can only edit your own notes' }, { status: 403 })
  }

  const { data: updated, error } = await admin
    .from('company_notes')
    .update({ content: content.trim(), updated_at: new Date().toISOString() })
    .eq('id', params.noteId)
    .select('id, content, user_id, created_at, updated_at')
    .single() as { data: { id: string; content: string; user_id: string; created_at: string; updated_at: string } | null; error: { message: string } | null }

  if (error || !updated) return dbError(error ?? { message: 'Failed to update' }, 'dashboard-notes')

  const { data: memberInfo } = await admin
    .from('fund_members')
    .select('display_name')
    .eq('fund_id', note.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { display_name: string | null } | null }

  return NextResponse.json({
    id: updated.id,
    content: updated.content,
    userId: updated.user_id,
    userName: memberInfo?.display_name || null,
    userEmail: user.email ?? 'Unknown',
    createdAt: updated.created_at,
    edited: updated.updated_at !== updated.created_at,
  })
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { noteId: string } }
) {
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
    .maybeSingle() as { data: { fund_id: string; role: string } | null }

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const { data: note } = await admin
    .from('company_notes')
    .select('id, user_id')
    .eq('id', params.noteId)
    .eq('fund_id', membership.fund_id)
    .maybeSingle() as { data: { id: string; user_id: string } | null }

  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (note.user_id !== user.id && membership.role !== 'admin') {
    return NextResponse.json({ error: 'Only the author or an admin can delete this note' }, { status: 403 })
  }

  const { error } = await admin
    .from('company_notes')
    .delete()
    .eq('id', params.noteId)

  if (error) return dbError(error, 'dashboard-notes-noteId')

  return NextResponse.json({ success: true })
}
