import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { decrypt } from '@/lib/crypto'
import { getAccessToken as getGoogleAccessToken, findOrCreateFolder as findOrCreateGoogleFolder, uploadFile as uploadGoogleFile } from '@/lib/google/drive'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { getDropboxCredentials } from '@/lib/dropbox/credentials'
import { getAccessToken as getDropboxAccessToken, findOrCreateFolder as findOrCreateDropboxFolder, uploadFile as uploadDropboxFile } from '@/lib/dropbox/files'

// POST — save one or more emails to file storage (Google Drive or Dropbox)
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const body = await req.json()
  const emailIds: string[] = body.emailIds ?? (body.emailId ? [body.emailId] : [])

  if (emailIds.length === 0) {
    return NextResponse.json({ error: 'No email IDs provided' }, { status: 400 })
  }

  // Check file storage provider
  const { data: settings } = await admin
    .from('fund_settings')
    .select('file_storage_provider, google_refresh_token_encrypted, encryption_key_encrypted, google_drive_folder_id, dropbox_refresh_token_encrypted, dropbox_folder_path')
    .eq('fund_id', membership.fund_id)
    .single()

  const provider = settings?.file_storage_provider
  if (!provider) {
    return NextResponse.json({ error: 'No file storage provider configured' }, { status: 400 })
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })
  if (!settings?.encryption_key_encrypted) {
    return NextResponse.json({ error: 'Encryption not configured' }, { status: 500 })
  }

  const dek = decrypt(settings.encryption_key_encrypted, kek)

  // Set up provider-specific upload functions
  let uploadEmail: (companyName: string, dateStr: string, subject: string, emailBody: string) => Promise<void>
  let uploadAttachment: (companyName: string, name: string, content: Buffer) => Promise<void>

  if (provider === 'google_drive') {
    if (!settings.google_refresh_token_encrypted || !settings.google_drive_folder_id) {
      return NextResponse.json({ error: 'Google Drive not connected or no folder selected' }, { status: 400 })
    }
    const refreshToken = decrypt(settings.google_refresh_token_encrypted, dek)
    const creds = await getGoogleCredentials(admin, membership.fund_id)
    if (!creds?.clientId || !creds?.clientSecret) {
      return NextResponse.json({ error: 'Google OAuth credentials not configured' }, { status: 400 })
    }
    const accessToken = await getGoogleAccessToken(refreshToken, creds.clientId, creds.clientSecret)
    const rootFolderId = settings.google_drive_folder_id

    uploadEmail = async (companyName, dateStr, subject, emailBody) => {
      const folderId = await findOrCreateGoogleFolder(accessToken, rootFolderId, companyName)
      await uploadGoogleFile(accessToken, folderId, `${dateStr}_${subject}.txt`, emailBody, 'text/plain')
    }
    uploadAttachment = async (companyName, name, content) => {
      const folderId = await findOrCreateGoogleFolder(accessToken, rootFolderId, companyName)
      await uploadGoogleFile(accessToken, folderId, name, content, 'application/octet-stream')
    }
  } else if (provider === 'dropbox') {
    if (!settings.dropbox_refresh_token_encrypted || !settings.dropbox_folder_path) {
      return NextResponse.json({ error: 'Dropbox not connected or no folder selected' }, { status: 400 })
    }
    const refreshToken = decrypt(settings.dropbox_refresh_token_encrypted, dek)
    const creds = await getDropboxCredentials(admin, membership.fund_id)
    if (!creds) return NextResponse.json({ error: 'Dropbox credentials not found' }, { status: 400 })
    const accessToken = await getDropboxAccessToken(refreshToken, creds.appKey, creds.appSecret)
    const rootPath = settings.dropbox_folder_path

    uploadEmail = async (companyName, dateStr, subject, emailBody) => {
      const companyPath = `${rootPath}/${companyName}`
      await findOrCreateDropboxFolder(accessToken, companyPath)
      await uploadDropboxFile(accessToken, companyPath, `${dateStr}_${subject}.txt`, emailBody)
    }
    uploadAttachment = async (companyName, name, content) => {
      const companyPath = `${rootPath}/${companyName}`
      await findOrCreateDropboxFolder(accessToken, companyPath)
      await uploadDropboxFile(accessToken, companyPath, name, content)
    }
  } else {
    return NextResponse.json({ error: `Unknown storage provider: ${provider}` }, { status: 400 })
  }

  // Fetch the emails with their company info
  const { data: emails, error: emailsError } = await admin
    .from('inbound_emails')
    .select('id, subject, company_id, raw_payload, received_at')
    .eq('fund_id', membership.fund_id)
    .in('id', emailIds)

  if (emailsError) {
    return NextResponse.json({ error: emailsError.message }, { status: 500 })
  }

  if (!emails || emails.length === 0) {
    return NextResponse.json({ error: 'No matching emails found' }, { status: 404 })
  }

  // Get company names for subfolder creation
  const companyIds = Array.from(new Set(emails.map(e => e.company_id).filter(Boolean))) as string[]
  const companiesMap: Record<string, string> = {}

  if (companyIds.length > 0) {
    const { data: companies } = await admin
      .from('companies')
      .select('id, name')
      .in('id', companyIds)

    for (const c of companies ?? []) {
      companiesMap[c.id] = c.name
    }
  }

  // Save each email
  let saved = 0
  let failed = 0
  const errors: string[] = []

  for (const email of emails) {
    try {
      const payload = email.raw_payload as Record<string, unknown> | null
      if (!payload) {
        errors.push(`${email.id}: no payload stored`)
        failed++
        continue
      }

      const companyName = email.company_id
        ? companiesMap[email.company_id] ?? 'Unknown Company'
        : 'Unidentified'

      const dateStr = new Date(email.received_at).toISOString().slice(0, 10)
      const subject = ((payload.Subject as string) ?? '')
        .replace(/[^a-zA-Z0-9 _-]/g, '')
        .slice(0, 60) || 'Report'
      const emailBody = (payload.TextBody as string) || (payload.HtmlBody as string) || '(no body)'

      await uploadEmail(companyName, dateStr, subject, emailBody)

      const attachments = (payload.Attachments as Array<{
        Name: string
        ContentType: string
        Content: string
      }>) ?? []

      for (const att of attachments) {
        const content = Buffer.from(att.Content, 'base64')
        await uploadAttachment(companyName, att.Name, content)
      }

      saved++
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      errors.push(`${email.id}: ${msg}`)
      failed++
    }
  }

  return NextResponse.json({ saved, failed, errors: errors.length > 0 ? errors : undefined })
}
