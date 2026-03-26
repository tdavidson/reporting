import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// DELETE /api/emails/[id]/attachments
// Body: { deleteNames: string[] }  — list of attachment Names to remove
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { deleteNames } = (await req.json()) as { deleteNames: string[] }
  if (!Array.isArray(deleteNames) || deleteNames.length === 0)
    return NextResponse.json({ success: true })

  const { data: email } = await admin
    .from('inbound_emails')
    .select('id, fund_id, raw_payload, attachments_count')
    .eq('id', params.id)
    .maybeSingle() as { data: { id: string; fund_id: string; raw_payload: any; attachments_count: number } | null }

  if (!email) return NextResponse.json({ error: 'Email not found' }, { status: 404 })

  // Verify fund membership
  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', email.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const attachments = (email.raw_payload?.Attachments ?? []) as Array<{
    Name: string
    ContentType: string
    ContentLength: number
    StoragePath?: string
  }>

  const toDelete = attachments.filter(a => deleteNames.includes(a.Name))
  const toKeep = attachments.filter(a => !deleteNames.includes(a.Name))

  // Remove files from storage
  const storagePaths = toDelete.map(a => a.StoragePath).filter(Boolean) as string[]
  if (storagePaths.length > 0) {
    await admin.storage.from('email-attachments').remove(storagePaths)
  }

  // Update raw_payload with remaining attachments
  const updatedPayload = { ...email.raw_payload, Attachments: toKeep }

  const { error } = await admin
    .from('inbound_emails')
    .update({
      raw_payload: updatedPayload,
      attachments_count: toKeep.length,
    })
    .eq('id', params.id)

  if (error) return dbError(error, 'emails-id-attachments-delete')

  return NextResponse.json({ success: true, remaining: toKeep.length })
}
