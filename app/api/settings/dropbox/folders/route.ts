import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { getDropboxCredentials } from '@/lib/dropbox/credentials'
import { getAccessToken, findOrCreateFolder } from '@/lib/dropbox/files'

// POST — create/set Dropbox folder path
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { folderPath } = await req.json()
  if (!folderPath?.trim()) {
    return NextResponse.json({ error: 'Folder path is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  // Get Dropbox connection
  const { data: settings } = await admin
    .from('fund_settings')
    .select('dropbox_refresh_token_encrypted, encryption_key_encrypted')
    .eq('fund_id', membership.fund_id)
    .single()

  if (!settings?.dropbox_refresh_token_encrypted || !settings?.encryption_key_encrypted) {
    return NextResponse.json({ error: 'Dropbox not connected' }, { status: 400 })
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })

  const dek = decrypt(settings.encryption_key_encrypted, kek)
  const refreshToken = decrypt(settings.dropbox_refresh_token_encrypted, dek)

  const creds = await getDropboxCredentials(admin, membership.fund_id)
  if (!creds) return NextResponse.json({ error: 'Dropbox credentials not found' }, { status: 400 })

  try {
    const accessToken = await getAccessToken(refreshToken, creds.appKey, creds.appSecret)

    // Normalize path: ensure it starts with /
    const normalizedPath = folderPath.trim().startsWith('/')
      ? folderPath.trim()
      : `/${folderPath.trim()}`

    await findOrCreateFolder(accessToken, normalizedPath)

    // Save the folder path
    await admin
      .from('fund_settings')
      .update({ dropbox_folder_path: normalizedPath })
      .eq('fund_id', membership.fund_id)

    return NextResponse.json({ ok: true, folderPath: normalizedPath })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create folder'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
