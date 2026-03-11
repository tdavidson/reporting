import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const body = await req.json()
  const { filename, contentType, contentLength, storagePath } = body as {
    filename: string
    contentType: string
    contentLength: number
    storagePath: string
  }

  if (!filename || !contentType || !storagePath) {
    return NextResponse.json({ error: 'Missing filename, contentType, or storagePath' }, { status: 400 })
  }

  // Validate storagePath to prevent path traversal
  if (storagePath.includes('..') || !storagePath.startsWith(`${params.id}/`)) {
    return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
  }

  // Fetch the email to get current raw_payload
  const { data: emailData, error } = await supabase
    .from('inbound_emails')
    .select('id, raw_payload')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return dbError(error, 'emails-id-attachments')
  if (!emailData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Verify the email's fund matches the user's fund
  const { data: emailMeta } = await admin
    .from('inbound_emails')
    .select('fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!emailMeta || emailMeta.fund_id !== writeCheck.fundId) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const rawPayload = ((emailData as Record<string, unknown>).raw_payload ?? {}) as Record<string, unknown>
  const existingAttachments = (rawPayload.Attachments ?? []) as Array<Record<string, unknown>>

  // Append metadata-only attachment entry (no Content — file is in Storage)
  const newAttachment = {
    Name: filename,
    ContentType: contentType,
    ContentLength: contentLength,
    StoragePath: storagePath,
  }

  const updatedPayload = {
    ...rawPayload,
    Attachments: [...existingAttachments, newAttachment],
  }

  const { error: updateError } = await admin
    .from('inbound_emails')
    .update({
      raw_payload: updatedPayload as unknown as import('@/lib/types/database').Json,
      attachments_count: existingAttachments.length + 1,
    })
    .eq('id', params.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ ok: true, filename })
}
