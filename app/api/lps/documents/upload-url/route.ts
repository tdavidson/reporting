import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

/**
 * Admin-only: issue a signed upload URL for an LP document. The browser uploads
 * the file directly to Storage (bypassing the serverless body limit), then calls
 * POST /api/lps/documents with { storage_path, ...metadata }. The server owns the
 * path so the browser can't write outside the fund's folder.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  const rawName = typeof body.file_name === 'string' ? body.file_name : ''
  if (!rawName) return NextResponse.json({ error: 'file_name is required' }, { status: 400 })

  const safeName = rawName.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
  const storagePath = `${writeCheck.fundId}/${Date.now()}_${safeName}`

  const { data: signed, error } = await admin.storage.from('lp-documents').createSignedUploadUrl(storagePath)
  if (error || !signed) return NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })

  return NextResponse.json({ storage_path: storagePath, token: signed.token, signed_url: signed.signedUrl })
}
