import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { getAccessToken, listFilesRecursive, downloadFile, exportFile, googleExportTarget, parseDriveFolderUrl } from '@/lib/google/drive'
import { classifyDocumentHeuristic } from '@/lib/memo-agent/heuristic-classify'

// The diligence-documents bucket caps each object at 100 MB. Skip larger files
// up front with a clear reason instead of a cryptic storage error mid-upload.
const MAX_IMPORT_BYTES = 100 * 1024 * 1024

/**
 * Walk a Google Drive folder and ingest every file into the deal's deal room.
 *
 * Returns a streaming NDJSON response so the client can show live progress:
 *   {type:'log',message:string}        — human-readable status line
 *   {type:'listed',count:number}       — total files found across all subfolders
 *   {type:'progress',current:number,total:number,file:string,relativePath:string}
 *   {type:'file_imported',file:string} — one document successfully ingested
 *   {type:'file_skipped',file:string,reason:string}
 *   {type:'file_error',file:string,error:string}
 *   {type:'done',imported:number,skipped:number,errors:number}
 *
 * Upfront validation (auth, deal scope, Drive credentials, initial listing)
 * still returns standard JSON 4xx/5xx — the stream only starts after listing
 * succeeds, so the client knows once headers arrive that processing is
 * underway.
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

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json().catch(() => ({}))
  const folderUrl = typeof body.folder_url === 'string' ? body.folder_url : ''
  const folderId = parseDriveFolderUrl(folderUrl)
  if (!folderId) {
    return NextResponse.json({ error: 'Provide a valid Google Drive folder URL (must contain /folders/<id>)' }, { status: 400 })
  }
  // Optional: import only these specific files (incremental import — pick a
  // new file without re-importing the whole folder). When absent, all
  // not-yet-imported files in the folder are imported.
  const onlyFileIds: Set<string> | null = Array.isArray(body.file_ids) && body.file_ids.length > 0
    ? new Set(body.file_ids.filter((x: unknown): x is string => typeof x === 'string'))
    : null

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

  // From here on we stream. Listing runs inside the stream so the client sees
  // the "walking folders" message immediately rather than waiting for the
  // full recursive walk to complete before headers flush.
  const dealId = params.id
  const userId = user.id

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'))
      }

      let imported = 0
      let skipped = 0
      let errorCount = 0

      try {
        emit({ type: 'log', message: 'Walking Drive folders…' })
        const allFiles = await listFilesRecursive(accessToken, folderId)
        // When specific file_ids were requested, import only those.
        const files = onlyFileIds ? allFiles.filter(f => onlyFileIds.has(f.id)) : allFiles
        emit({ type: 'listed', count: files.length })

        if (files.length === 0) {
          emit({ type: 'log', message: 'No files found in folder.' })
          emit({ type: 'done', imported: 0, skipped: 0, errors: 0 })
          controller.close()
          return
        }

        emit({ type: 'log', message: `Found ${files.length} file${files.length === 1 ? '' : 's'} across subfolders.` })

        // Dedupe pass — fetch existing drive_file_ids in one query.
        const driveIds = files.map(f => f.id)
        const { data: existing } = await admin
          .from('diligence_documents')
          .select('drive_file_id')
          .eq('deal_id', dealId)
          .eq('fund_id', fundId)
          .in('drive_file_id', driveIds)
        const seen = new Set(((existing as any[]) ?? []).map(r => r.drive_file_id as string))

        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          const displayName = f.relativePath ? `${f.relativePath}/${f.name}` : f.name
          emit({
            type: 'progress',
            current: i + 1,
            total: files.length,
            file: f.name,
            relativePath: f.relativePath ?? '',
          })

          if (seen.has(f.id)) {
            skipped++
            emit({ type: 'file_skipped', file: displayName, reason: 'already imported' })
            continue
          }

          // Google-native files (Docs/Slides/Sheets) must be exported, not
          // downloaded; other native types (Forms, Drawings) aren't importable.
          const isNative = f.mimeType.startsWith('application/vnd.google-apps')
          const exportTarget = isNative ? googleExportTarget(f.mimeType) : null
          if (isNative && !exportTarget) {
            skipped++
            emit({ type: 'file_skipped', file: displayName, reason: 'Google file type not importable' })
            continue
          }

          // Pre-skip oversized binaries (bucket caps at 100 MB) with a clear reason.
          if (!isNative && typeof f.size === 'number' && f.size > MAX_IMPORT_BYTES) {
            skipped++
            emit({ type: 'file_skipped', file: displayName, reason: `too large (${Math.round(f.size / 1024 / 1024)} MB, 100 MB max) — add it directly if needed` })
            continue
          }

          try {
            const buffer = exportTarget
              ? await exportFile(accessToken, f.id, exportTarget.exportMime)
              : await downloadFile(accessToken, f.id)
            const effectiveMime = exportTarget ? exportTarget.exportMime : f.mimeType

            // Strip control characters (NUL, tab, CR, LF, etc.) in addition
            // to the path-traversal and reserved characters. Drive permits
            // newlines and other control chars in folder/file names; left
            // unstripped they could later forge CRLF in HTTP headers (e.g.
            // Content-Disposition when serving downloads).
            const sanitizedPath = (f.relativePath ?? '').replace(/[\x00-\x1f\x7f\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 150)
            let baseName = f.name.replace(/[\x00-\x1f\x7f\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_').slice(0, 200)
            // Exported Google files get the exported extension (a Doc "Pitch" → "Pitch.pdf").
            if (exportTarget && !baseName.toLowerCase().endsWith(`.${exportTarget.ext}`)) {
              baseName = `${baseName}.${exportTarget.ext}`
            }
            const safeName = sanitizedPath ? `${sanitizedPath}/${baseName}` : baseName
            const ext = exportTarget ? exportTarget.ext : (baseName.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'bin').toLowerCase()
            // The storage KEY must be ASCII-safe — Supabase Storage rejects
            // spaces, brackets and other chars that are fine in a display name.
            const keySafe = baseName.replace(/[^a-zA-Z0-9._-]/g, '_')
            const storagePath = `${dealId}/${Date.now()}_${f.id.slice(0, 8)}_${keySafe}`

            const { error: uploadErr } = await admin.storage
              .from('diligence-documents')
              .upload(storagePath, buffer, { contentType: effectiveMime, upsert: false })
            if (uploadErr) {
              errorCount++
              emit({ type: 'file_error', file: displayName, error: uploadErr.message })
              continue
            }

            const { detected_type, confidence } = classifyDocumentHeuristic(safeName, effectiveMime)

            const { error: insertErr } = await admin
              .from('diligence_documents')
              .insert({
                deal_id: dealId,
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
                uploaded_by: userId,
              } as any)
            if (insertErr) {
              await admin.storage.from('diligence-documents').remove([storagePath]).catch(() => {})
              errorCount++
              emit({ type: 'file_error', file: displayName, error: insertErr.message })
              continue
            }

            imported++
            emit({ type: 'file_imported', file: displayName })
          } catch (err) {
            errorCount++
            emit({ type: 'file_error', file: displayName, error: err instanceof Error ? err.message : 'unknown error' })
          }
        }

        emit({ type: 'done', imported, skipped, errors: errorCount })
      } catch (err) {
        emit({ type: 'fatal', error: err instanceof Error ? err.message : 'Drive import failed' })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store',
      // Disable buffering on reverse proxies — Vercel honors this.
      'X-Accel-Buffering': 'no',
    },
  })
}
