import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { classifyDocumentHeuristic } from '@/lib/memo-agent/heuristic-classify'

const MAX_BYTES = 100 * 1024 * 1024  // 100 MB to match bucket cap

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  // Verify deal belongs to fund first.
  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data, error } = await admin
    .from('diligence_documents')
    .select('id, deal_id, fund_id, storage_path, file_name, file_format, file_size_bytes, detected_type, type_confidence, parse_status, parse_notes, drive_file_id, drive_source_url, uploaded_by, uploaded_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .order('uploaded_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const guard = await ensureMember()
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  // Verify deal.
  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Multipart upload.
  let formData: FormData
  try {
    formData = await req.formData()
  } catch {
    return NextResponse.json({ error: 'Expected multipart/form-data' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'File exceeds 100 MB limit' }, { status: 400 })
  }
  if (file.size === 0) {
    return NextResponse.json({ error: 'Empty file' }, { status: 400 })
  }

  const safeName = file.name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
  const ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'bin').toLowerCase()
  const storagePath = `${params.id}/${Date.now()}_${safeName}`
  const buffer = Buffer.from(await file.arrayBuffer())

  const { error: uploadErr } = await admin.storage
    .from('diligence-documents')
    .upload(storagePath, buffer, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (uploadErr) {
    return NextResponse.json({ error: `Upload failed: ${uploadErr.message}` }, { status: 500 })
  }

  const { detected_type, confidence } = classifyDocumentHeuristic(safeName, file.type)

  const { data: row, error: insertErr } = await admin
    .from('diligence_documents')
    .insert({
      deal_id: params.id,
      fund_id: fundId,
      storage_path: storagePath,
      file_name: safeName,
      file_format: ext,
      file_size_bytes: file.size,
      detected_type,
      type_confidence: confidence,
      parse_status: 'pending',
      uploaded_by: userId,
    } as any)
    .select('id, deal_id, file_name, file_format, file_size_bytes, detected_type, type_confidence, parse_status, uploaded_at')
    .single()

  if (insertErr || !row) {
    // Clean up the storage object on row-insert failure.
    await admin.storage.from('diligence-documents').remove([storagePath]).catch(() => {})
    return NextResponse.json({ error: insertErr?.message ?? 'Insert failed' }, { status: 500 })
  }

  return NextResponse.json(row)
}

// ---------------------------------------------------------------------------

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
    role: (membership as any).role as string,
  }
}
