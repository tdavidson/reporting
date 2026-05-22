import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { getAccessToken, listFilesRecursive, parseDriveFolderUrl } from '@/lib/google/drive'

/**
 * List the files in the deal's Google Drive folder, each flagged with whether
 * it's already been imported into the data room. Backs the "add a specific
 * file from Drive" picker — so a partner can pull one new file without
 * re-walking and re-importing the whole folder.
 *
 * Folder source: the `folder_url` query param if provided, else the deal's
 * stored drive_folder_url.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = (membership as any).fund_id as string

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, drive_folder_url')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const folderUrlParam = req.nextUrl.searchParams.get('folder_url')
  const folderUrl = folderUrlParam || (deal as any).drive_folder_url || ''
  const folderId = parseDriveFolderUrl(folderUrl)
  if (!folderId) {
    return NextResponse.json({ error: 'No Drive folder configured for this deal. Provide a folder URL.' }, { status: 400 })
  }

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

  const creds = await getGoogleCredentials(admin, fundId)
  if (!creds?.clientId || !creds?.clientSecret) {
    return NextResponse.json({ error: 'Google OAuth credentials missing' }, { status: 400 })
  }

  let accessToken: string
  try {
    const dek = decrypt(dekEnc, kek)
    const refreshToken = decrypt(refreshEnc, dek)
    accessToken = await getAccessToken(refreshToken, creds.clientId, creds.clientSecret)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Token refresh failed' }, { status: 502 })
  }

  let files
  try {
    files = await listFilesRecursive(accessToken, folderId)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Drive listing failed' }, { status: 502 })
  }

  // Which of these are already in the data room?
  const { data: existing } = await admin
    .from('diligence_documents')
    .select('drive_file_id')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .in('drive_file_id', files.length > 0 ? files.map(f => f.id) : ['__none__'])
  const imported = new Set(((existing as any[]) ?? []).map(r => r.drive_file_id as string))

  return NextResponse.json({
    folder_id: folderId,
    files: files.map(f => ({
      id: f.id,
      name: f.name,
      relative_path: f.relativePath ?? '',
      mime_type: f.mimeType,
      google_native: f.mimeType.startsWith('application/vnd.google-apps'),
      already_imported: imported.has(f.id),
    })),
  })
}
