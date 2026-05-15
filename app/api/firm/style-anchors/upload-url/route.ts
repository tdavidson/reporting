import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ALLOWED_FORMATS = ['pdf', 'docx', 'md', 'markdown', 'txt'] as const

/**
 * Issue a signed upload URL for a style-anchor memo. The browser uses this to
 * upload the file directly to Supabase Storage, bypassing Vercel's ~4.5 MB
 * serverless function body limit. After upload succeeds, the client calls
 * `POST /api/firm/style-anchors` with `{ storage_path, ...metadata }` to
 * record the row and trigger text extraction.
 *
 * Server still controls the storage path so the browser can't write outside
 * the fund's folder, and we validate the file extension up front.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  const body = await req.json().catch(() => ({}))
  const rawName = typeof body.file_name === 'string' ? body.file_name : ''
  if (!rawName) return NextResponse.json({ error: 'file_name is required' }, { status: 400 })

  const safeName = rawName.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
  const ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] ?? '').toLowerCase()
  if (!ALLOWED_FORMATS.includes(ext as any)) {
    return NextResponse.json({
      error: `Unsupported format ".${ext}". Allowed: PDF, DOCX, MD.`,
    }, { status: 400 })
  }

  const storagePath = `${fundId}/${Date.now()}_${safeName}`
  const { data: signed, error } = await admin.storage
    .from('style-anchor-memos')
    .createSignedUploadUrl(storagePath)
  if (error || !signed) {
    return NextResponse.json({ error: error?.message ?? 'Failed to create upload URL' }, { status: 500 })
  }

  return NextResponse.json({
    storage_path: storagePath,
    token: signed.token,
    signed_url: signed.signedUrl,
  })
}
