import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { extractFromBuffer } from '@/lib/parsing/extractAttachmentText'
import { dbError } from '@/lib/api-error'

// ---------------------------------------------------------------------------
// GET — List all documents for a company
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: documents, error } = await admin
    .from('company_documents' as any)
    .select('id, filename, file_type, file_size, has_native_content, created_at')
    .eq('company_id', params.id)
    .order('created_at', { ascending: false }) as { data: any[] | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-documents')

  // Tag uploaded documents with source
  const uploadDocs = (documents ?? []).map(d => ({ ...d, source: 'upload' as const }))

  // Fetch email attachments from inbound_emails
  const { data: emails } = await admin
    .from('inbound_emails')
    .select('id, subject, raw_payload, received_at')
    .eq('company_id', params.id)
    .gt('attachments_count', 0)
    .in('processing_status', ['success', 'needs_review'])
    .order('received_at', { ascending: false }) as { data: any[] | null }

  const emailAttachments: any[] = []
  for (const email of emails ?? []) {
    const payload = email.raw_payload as Record<string, unknown> | null
    if (!payload) continue
    const attachments = (payload.Attachments ?? []) as Array<{
      Name: string
      ContentType: string
      ContentLength: number
    }>
    for (let i = 0; i < attachments.length; i++) {
      const att = attachments[i]
      emailAttachments.push({
        id: `email-${email.id}-${i}`,
        filename: att.Name,
        file_type: att.ContentType,
        file_size: att.ContentLength,
        created_at: email.received_at,
        source: 'email' as const,
        email_subject: email.subject,
      })
    }
  }

  // Combine and sort by date descending
  const combined = [...uploadDocs, ...emailAttachments].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  )

  return NextResponse.json({ documents: combined })
}

// ---------------------------------------------------------------------------
// POST — Register an uploaded document and extract text
// ---------------------------------------------------------------------------

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

  // Verify company exists and user is a fund member
  const { data: company } = await admin
    .from('companies')
    .select('id, fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Not a fund member' }, { status: 403 })

  const body = await req.json()
  const { storagePath, filename, fileType, fileSize } = body

  if (!storagePath || !filename || !fileType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  // Download file from Storage to extract text
  const { data: fileData, error: downloadError } = await admin
    .storage
    .from('company-documents')
    .download(storagePath)

  if (downloadError || !fileData) {
    return NextResponse.json({ error: 'Failed to download file from storage' }, { status: 500 })
  }

  const buffer = Buffer.from(await fileData.arrayBuffer())
  const result = await extractFromBuffer(buffer, filename, fileType)

  const { error: insertError } = await admin
    .from('company_documents' as any)
    .insert({
      company_id: params.id,
      fund_id: company.fund_id,
      filename,
      file_type: fileType,
      file_size: fileSize ?? buffer.length,
      storage_path: storagePath,
      extracted_text: result.extractedText || null,
      has_native_content: !!result.base64Content,
      uploaded_by: user.id,
    })

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
