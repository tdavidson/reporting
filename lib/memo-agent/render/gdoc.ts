import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { getAccessToken, uploadFile } from '@/lib/google/drive'

type Admin = ReturnType<typeof createAdminClient>

/**
 * Upload a Word doc Buffer to the fund's Google Drive folder. Drive
 * auto-converts .docx to a Google Doc the first time someone opens it from
 * the Drive UI, which is sufficient for v1 — partners get a sharable Doc URL.
 *
 * Native rich-format Google Doc creation (with header runs, footnotes,
 * etc.) requires the Google Docs API and an additional OAuth scope. Wire that
 * up later if a fund explicitly needs it.
 */
export async function uploadDocxToDrive(params: {
  admin: Admin
  fundId: string
  filename: string
  buffer: Buffer
  /**
   * Target Drive folder ID. When provided (e.g. the deal's own data-room
   * folder), the upload goes there instead of the fund's default
   * google_drive_folder_id (the portfolio-reports folder).
   */
  folderIdOverride?: string | null
}): Promise<{ webViewLink: string | null; fileId: string | null }> {
  const { admin, fundId, filename, buffer, folderIdOverride } = params

  const { data: settings } = await admin
    .from('fund_settings')
    .select('google_refresh_token_encrypted, encryption_key_encrypted, google_drive_folder_id')
    .eq('fund_id', fundId)
    .maybeSingle()
  const refreshEnc = (settings as any)?.google_refresh_token_encrypted as string | null
  const dekEnc = (settings as any)?.encryption_key_encrypted as string | null
  const defaultFolderId = (settings as any)?.google_drive_folder_id as string | null
  const folderId = folderIdOverride || defaultFolderId
  if (!refreshEnc || !dekEnc) throw new Error('Google Drive not connected for this fund.')
  if (!folderId) throw new Error('No Google Drive folder available. Set a data-room folder on the deal, or a default folder in Settings → Storage.')

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) throw new Error('ENCRYPTION_KEY not set')

  const dek = decrypt(dekEnc, kek)
  const refreshToken = decrypt(refreshEnc, dek)
  const creds = await getGoogleCredentials(admin, fundId)
  if (!creds?.clientId || !creds?.clientSecret) throw new Error('Google OAuth credentials missing')

  const accessToken = await getAccessToken(refreshToken, creds.clientId, creds.clientSecret)

  const fileId = await uploadFile(
    accessToken,
    folderId,
    filename,
    buffer,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    { convert: true },  // converts to a native Google Doc on upload
  )

  return {
    fileId,
    webViewLink: fileId ? `https://docs.google.com/document/d/${fileId}/edit` : null,
  }
}
