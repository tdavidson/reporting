import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// ---------------------------------------------------------------------------
// GET — Generate a signed URL to view/download a document
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; docId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: doc } = await admin
    .from('company_documents' as any)
    .select('id, storage_path, fund_id, filename, file_type')
    .eq('id', params.docId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; storage_path: string; fund_id: string; filename: string; file_type: string } | null }

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  // Verify fund membership
  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', doc.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const { data: signed, error } = await admin.storage
    .from('company-documents')
    .createSignedUrl(doc.storage_path, 60 * 60) // 1 hour

  if (error || !signed?.signedUrl)
    return NextResponse.json({ error: 'Could not generate download URL' }, { status: 500 })

  return NextResponse.json({ url: signed.signedUrl, filename: doc.filename, fileType: doc.file_type })
}

// ---------------------------------------------------------------------------
// DELETE — Remove a document and its storage object
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

  const { data: doc } = await admin
    .from('company_documents' as any)
    .select('id, storage_path, fund_id')
    .eq('id', params.docId)
    .eq('company_id', params.id)
    .maybeSingle() as { data: { id: string; storage_path: string; fund_id: string } | null }

  if (!doc) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', doc.fund_id)
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  await admin.storage.from('company-documents').remove([doc.storage_path])

  const { error } = await admin
    .from('company_documents' as any)
    .delete()
    .eq('id', params.docId)

  if (error) return dbError(error, 'companies-id-documents-docId')

  return NextResponse.json({ success: true })
}
