import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { getAccessToken, listFolders, findOrCreateFolder } from '@/lib/google/drive'
import { getGoogleCredentials } from '@/lib/google/credentials'

async function getDriveAccess(userId: string) {
  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) return { error: 'No fund found', status: 403 }

  const { data: settings } = await admin
    .from('fund_settings')
    .select('google_refresh_token_encrypted, encryption_key_encrypted')
    .eq('fund_id', membership.fund_id)
    .single()

  if (!settings?.google_refresh_token_encrypted || !settings?.encryption_key_encrypted) {
    return { error: 'Google Drive not connected', status: 400 }
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return { error: 'Server misconfiguration', status: 500 }

  let accessToken: string
  try {
    const dek = decrypt(settings.encryption_key_encrypted, kek)
    const refreshToken = decrypt(settings.google_refresh_token_encrypted, dek)

    const creds = await getGoogleCredentials(admin, membership.fund_id)
    if (!creds?.clientId || !creds?.clientSecret) {
      return { error: 'Google OAuth credentials not configured', status: 400 }
    }
    accessToken = await getAccessToken(refreshToken, creds.clientId, creds.clientSecret)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[drive/folders] Failed to get Drive access:', msg)
    return { error: `Google Drive connection failed: ${msg}`, status: 500 }
  }

  return { accessToken, fundId: membership.fund_id, admin }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const result = await getDriveAccess(user.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  try {
    const parent = req.nextUrl.searchParams.get('parent') || undefined
    const shared = req.nextUrl.searchParams.get('shared') === 'true'
    const folders = await listFolders(result.accessToken, shared ? undefined : parent, shared)
    return NextResponse.json({ folders })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to list folders'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// POST — create a folder in the user's Drive root and set it as the target
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Admin-only: check role before modifying fund settings
  const adminCheck = createAdminClient()
  const { data: memberRole } = await adminCheck
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!memberRole || memberRole.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const { folderName } = await req.json()
  if (!folderName?.trim()) {
    return NextResponse.json({ error: 'Folder name is required' }, { status: 400 })
  }

  const result = await getDriveAccess(user.id)
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: result.status })

  try {
    const folderId = await findOrCreateFolder(result.accessToken, 'root', folderName.trim())

    // Save as the fund's drive folder
    await result.admin
      .from('fund_settings')
      .update({
        google_drive_folder_id: folderId,
        google_drive_folder_name: folderName.trim(),
      })
      .eq('fund_id', result.fundId)

    return NextResponse.json({ ok: true, folderId, folderName: folderName.trim() })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create folder'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
