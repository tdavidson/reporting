import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { getAccessToken, listFiles, downloadFile, parseDriveFolderUrl } from '@/lib/google/drive'
import { classifyDocumentHeuristic } from '@/lib/memo-agent/heuristic-classify'

/**
 * Walk a Google Drive folder and ingest every file into the deal's deal room.
 * Each file is downloaded, uploaded to the diligence-documents bucket, and a
 * row is inserted in diligence_documents with drive_file_id + drive_source_url
 * set so we can detect re-imports later.
 *
 * This is a synchronous endpoint. For folders >50 files, the user should split
 * across multiple imports or rely on Phase 4's job runner once that lands.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
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
  const fundId = (membership as any).fund_id as string

  // Verify deal.
  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const folderUrl = typeof body.folder_url === 'string' ? body.folder_url : ''
  // Require the full Drive folder URL — accepting a raw folder_id let callers
  // skip URL-format validation. The OAuth scope still permits the fund's
  // token to read any folder it can see, but requiring a URL surfaces intent
  // and makes audit logs more legible.
  const folderId = parseDriveFolderUrl(folderUrl)
  if (!folderId) {
    return NextResponse.json({ error: 'Provide a valid Google Drive folder URL (must contain /folders/<id>)' }, { status: 400 })
  }

  // Resolve Google credentials + access token.
  const { data: settings } = await admin
    .from('fund_settings')
    .select('google_refresh_token_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .maybeSingle()
  const refreshEnc = (settings as any)?.google_refresh_token_encrypted as string | null
  const dekEnc = (settings as any)?.encryption_key_encrypted as string | null
  if (!refreshEnc || !dekEnc) {
    return NextResponse.json({ error: 'Google Drive not connected for this fund' }, { status: 400 })
  }
  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return NextResponse.json({ error: 'ENCRYPTION_KEY not configured' }, { status: 500 })

  const dek = decrypt(dekEnc, kek)
  const refreshToken = decrypt(refreshEnc, dek)

  const creds = await getGoogleCredentials(admin, fundId)
  if (!creds?.clientId || !creds?.clientSecret) {
    return NextResponse.json({ error: 'Google OAuth credentials missing' }, { status: 400 })
  }

  let accessToken: string
  try {
    accessToken = await getAccessToken(refreshToken, creds.clientId, creds.clientSecret)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Token refresh failed' }, { status: 502 })
  }

  // List files.
  let files: Awaited<ReturnType<typeof listFiles>>
  try {
    files = await listFiles(accessToken, folderId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Drive list failed' }, { status: 502 })
  }

  if (files.length === 0) {
    return NextResponse.json({ ok: true, imported: 0, skipped: 0 })
  }

  // Skip files already imported by drive_file_id.
  const driveIds = files.map(f => f.id)
  const { data: existing } = await admin
    .from('diligence_documents')
    .select('drive_file_id')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .in('drive_file_id', driveIds)
  const seen = new Set(((existing as any[]) ?? []).map(r => r.drive_file_id as string))

  let imported = 0
  let skipped = 0
  const errors: string[] = []

  for (const f of files) {
    if (seen.has(f.id)) {
      skipped++
      continue
    }

    // Skip Google Docs / Sheets / Slides — they need export, not raw download.
    // (We can add export-as-pdf later; for v1, partner can save them as files manually.)
    if (f.mimeType.startsWith('application/vnd.google-apps')) {
      errors.push(`${f.name}: Google-native file (export not yet supported)`)
      continue
    }

    try {
      const buffer = await downloadFile(accessToken, f.id)
      const safeName = f.name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
      const ext = (safeName.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'bin').toLowerCase()
      const storagePath = `${params.id}/${Date.now()}_${f.id.slice(0, 8)}_${safeName}`

      const { error: uploadErr } = await admin.storage
        .from('diligence-documents')
        .upload(storagePath, buffer, { contentType: f.mimeType, upsert: false })
      if (uploadErr) {
        errors.push(`${f.name}: ${uploadErr.message}`)
        continue
      }

      const { detected_type, confidence } = classifyDocumentHeuristic(safeName, f.mimeType)

      const { error: insertErr } = await admin
        .from('diligence_documents')
        .insert({
          deal_id: params.id,
          fund_id: fundId,
          storage_path: storagePath,
          file_name: safeName,
          file_format: ext,
          file_size_bytes: buffer.length,
          detected_type,
          type_confidence: confidence,
          parse_status: 'pending',
          drive_file_id: f.id,
          drive_source_url: f.webViewLink ?? null,
          uploaded_by: user.id,
        } as any)
      if (insertErr) {
        await admin.storage.from('diligence-documents').remove([storagePath]).catch(() => {})
        errors.push(`${f.name}: ${insertErr.message}`)
        continue
      }
      imported++
    } catch (err) {
      errors.push(`${f.name}: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  return NextResponse.json({ ok: true, imported, skipped, errors })
}
