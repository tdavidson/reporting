import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

/**
 * Admin-only LP document management (gap 2).
 *
 *   GET  → the fund's documents (with their per-investor assignments).
 *   POST { title, file_name, storage_path, mime_type?, size_bytes?, scope, lp_investor_ids? }
 *        → record an uploaded file. scope 'fund' = all LPs; 'investor' = the
 *          listed investors only (verified to belong to this fund).
 *   DELETE ?id=... → remove the row, its shares, and the storage object.
 */

export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { data: docs, error } = await (admin as any)
    .from('lp_documents')
    .select('id, title, file_name, mime_type, size_bytes, scope, category, doc_date, uploaded_at, lp_document_shares(lp_investor_id, lp_investors(name))')
    .eq('fund_id', writeCheck.fundId)
    .order('uploaded_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ documents: docs ?? [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  const fundId = writeCheck.fundId

  const body = await req.json().catch(() => ({}))
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const fileName = typeof body.file_name === 'string' ? body.file_name.trim() : ''
  const storagePath = typeof body.storage_path === 'string' ? body.storage_path : ''
  const scope = body.scope === 'investor' ? 'investor' : 'fund'
  const requestedInvestorIds: string[] = Array.isArray(body.lp_investor_ids) ? body.lp_investor_ids.filter((x: unknown): x is string => typeof x === 'string') : []

  if (!title || !fileName || !storagePath) return NextResponse.json({ error: 'title, file_name and storage_path are required' }, { status: 400 })
  // The path must be inside this fund's folder (the upload-url route guarantees this).
  if (!storagePath.startsWith(`${fundId}/`)) return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })

  let investorIds: string[] = []
  if (scope === 'investor') {
    const { data: valid } = await (admin as any)
      .from('lp_investors').select('id').eq('fund_id', fundId)
      .in('id', requestedInvestorIds.length ? requestedInvestorIds : ['00000000-0000-0000-0000-000000000000'])
    investorIds = (valid ?? []).map((r: any) => r.id)
    if (investorIds.length === 0) return NextResponse.json({ error: 'Select at least one investor for an investor-scoped document' }, { status: 400 })
  }

  const { data: doc, error } = await (admin as any)
    .from('lp_documents')
    .insert({ fund_id: fundId, title, file_name: fileName, storage_path: storagePath, mime_type: body.mime_type ?? null, size_bytes: body.size_bytes ?? null, scope, category: (typeof body.category === 'string' && body.category.trim()) ? body.category.trim() : null, doc_date: body.doc_date || null, uploaded_by: user.id })
    .select('id').single()
  if (error || !doc) return NextResponse.json({ error: error?.message ?? 'Insert failed' }, { status: 500 })

  if (scope === 'investor' && investorIds.length) {
    const rows = investorIds.map(id => ({ document_id: doc.id, lp_investor_id: id, fund_id: fundId }))
    await (admin as any).from('lp_document_shares').insert(rows)
  }

  return NextResponse.json({ ok: true, id: doc.id })
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  const { data: doc } = await (admin as any)
    .from('lp_documents').select('id, storage_path').eq('id', id).eq('fund_id', writeCheck.fundId).maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await admin.storage.from('lp-documents').remove([doc.storage_path]).catch(() => {})
  const { error } = await (admin as any).from('lp_documents').delete().eq('id', id).eq('fund_id', writeCheck.fundId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
