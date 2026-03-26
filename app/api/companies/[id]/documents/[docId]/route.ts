import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Email doc ids are virtual: "email-{emailId}-{attachmentIndex}"
function parseEmailDocId(docId: string): { emailId: string; attachmentIndex: number } | null {
  const match = docId.match(/^email-(.+)-(\d+)$/)
  if (!match) return null
  return { emailId: match[1], attachmentIndex: parseInt(match[2], 10) }
}

async function resolveEmailAttachment(admin: ReturnType<typeof createAdminClient>, emailId: string, attachmentIndex: number, companyId: string) {
  const { data: email } = await admin
    .from('inbound_emails')
    .select('id, fund_id, raw_payload')
    .eq('id', emailId)
    .eq('company_id', companyId)
    .maybeSingle() as { data: { id: string; fund_id: string; raw_payload: any } | null }

  if (!email) return null

  const attachments = (email.raw_payload?.Attachments ?? []) as Array<{ Name: string; ContentType: string; Content: string }>
  const att = attachments[attachmentIndex]
  if (!att) return null

  return { email, att }
}

// ---------------------------------------------------------------------------
// GET — Generate a signed URL (upload) or base64 data URL (email attachment)
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // --- Email attachment (virtual id) ---
  const emailParsed = parseEmailDocId(params.docId)
  if (emailParsed) {
    const resolved = await resolveEmailAttachment(admin, emailParsed.emailId, emailParsed.attachmentIndex, params.id)
    if (!resolved) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    const { email, att } = resolved

    const { data: membership } = await supabase
      .from('fund_members')
      .select('role')
      .eq('fund_id', email.fund_id)
      .eq('user_id', user.id)
      .maybeSingle() as { data: { role: string } | null }

    if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

    // Return a data URL from the base64 content stored in the email payload
    const dataUrl = `data:${att.ContentType};base64,${att.Content}`
    return NextResponse.json({ url: dataUrl, filename: att.Name, fileType: att.ContentType })
  }

  // --- Uploaded document ---
  const { data: doc } = await admin
    .from('company_documents' as any)
    .select('id, storage_path, fund_id, filename, file_type')
    .eq('id', params.docId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; storage_path: string | null; fund_id: string; filename: string; file_type: string } | null }

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', doc.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  if (!doc.storage_path) {
    return NextResponse.json({ error: 'File not available (text-only extraction)' }, { status: 410 })
  }

  const { data: signed, error } = await admin.storage
    .from('company-documents')
    .createSignedUrl(doc.storage_path, 60 * 60)

  if (error || !signed?.signedUrl)
    return NextResponse.json({ error: 'Could not generate download URL' }, { status: 500 })

  return NextResponse.json({ url: signed.signedUrl, filename: doc.filename, fileType: doc.file_type })
}

// ---------------------------------------------------------------------------
// DELETE — Remove a document (upload from DB+storage, email from inbound_emails)
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // --- Email attachment: delete the whole inbound_email record ---
  const emailParsed = parseEmailDocId(params.docId)
  if (emailParsed) {
    const resolved = await resolveEmailAttachment(admin, emailParsed.emailId, emailParsed.attachmentIndex, params.id)
    if (!resolved) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    const { email } = resolved

    const { data: membership } = await supabase
      .from('fund_members')
      .select('role')
      .eq('fund_id', email.fund_id)
      .eq('user_id', user.id)
      .maybeSingle() as { data: { role: string } | null }

    if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

    const { error } = await admin
      .from('inbound_emails')
      .delete()
      .eq('id', emailParsed.emailId)

    if (error) return dbError(error, 'companies-id-documents-docId-email')

    return NextResponse.json({ success: true })
  }

  // --- Uploaded document ---
  const { data: doc } = await admin
    .from('company_documents' as any)
    .select('id, storage_path, fund_id')
    .eq('id', params.docId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; storage_path: string | null; fund_id: string } | null }

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', doc.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  if (doc.storage_path) {
    await admin.storage.from('company-documents').remove([doc.storage_path])
  }

  const { error } = await admin
    .from('company_documents' as any)
    .delete()
    .eq('id', params.docId)

  if (error) return dbError(error, 'companies-id-documents-docId')

  return NextResponse.json({ success: true })
}
