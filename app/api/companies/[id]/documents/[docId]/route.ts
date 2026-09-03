import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string; docId: string }> }
) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: doc } = await admin
    .from('company_documents' as any)
    .select('id, filename, file_type, extracted_text, storage_path, fund_id')
    .eq('id', params.docId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; filename: string; file_type: string; extracted_text: string | null; storage_path: string | null; fund_id: string } | null }

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: membership } = await admin
    .from('fund_members')
    .select('id')
    .eq('fund_id', doc.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let fileUrl: string | null = null
  if (doc.storage_path) {
    const { data: signed } = await admin.storage
      .from('company-documents')
      .createSignedUrl(doc.storage_path, 300)
    fileUrl = signed?.signedUrl ?? null
  }

  const previewable = doc.file_type === 'application/pdf' || /^image\/(png|jpeg|gif|webp)$/.test(doc.file_type)
  return NextResponse.json({
    filename: doc.filename,
    file_type: doc.file_type,
    text_content: doc.extracted_text,
    file_url: fileUrl,
    previewable,
  })
}

// ---------------------------------------------------------------------------
// DELETE — Remove a document and its storage object
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  props: { params: Promise<{ id: string; docId: string }> }
) {
  const params = await props.params;
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Fetch the document to get storage_path and verify ownership
  const { data: doc } = await admin
    .from('company_documents' as any)
    .select('id, storage_path, fund_id')
    .eq('id', params.docId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; storage_path: string | null; fund_id: string } | null }

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // Verify fund membership
  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', doc.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  // Delete from Storage
  if (doc.storage_path) await admin.storage.from('company-documents').remove([doc.storage_path])

  // Delete the DB record
  const { error } = await admin
    .from('company_documents' as any)
    .delete()
    .eq('id', params.docId)

  if (error) return dbError(error, 'companies-id-documents-docId')

  return NextResponse.json({ success: true })
}
