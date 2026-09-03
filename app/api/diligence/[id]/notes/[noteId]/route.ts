import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; noteId: string }> }
) {
  const params = await props.params;
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
  const fundId = (membership as any).fund_id as string

  // Only the author or an admin can delete.
  const { data: note } = await admin
    .from('diligence_notes')
    .select('author_id')
    .eq('id', params.noteId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const isAuthor = (note as any).author_id === user.id
  const isAdmin = (membership as any).role === 'admin'
  if (!isAuthor && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await admin
    .from('diligence_notes')
    .delete()
    .eq('id', params.noteId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
  if (error) return dbError(error, 'diligence-note-delete')
  return NextResponse.json({ ok: true })
}
