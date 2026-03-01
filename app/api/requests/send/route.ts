import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { getAccessToken } from '@/lib/google/drive'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { getGmailProfile, sendEmail } from '@/lib/google/gmail'

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
  if (membership.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const body = await req.json()
  const { subject, body_html, body_text, recipients, quarter_label, cc } = body

  if (!subject?.trim()) return NextResponse.json({ error: 'Subject is required' }, { status: 400 })
  if (!body_html?.trim() && !body_text?.trim()) return NextResponse.json({ error: 'Body is required' }, { status: 400 })
  if (!recipients?.length) return NextResponse.json({ error: 'No recipients selected' }, { status: 400 })

  // Get Google credentials and access token
  const { data: settings } = await admin
    .from('fund_settings')
    .select('google_refresh_token_encrypted, encryption_key_encrypted')
    .eq('fund_id', membership.fund_id)
    .single()

  if (!settings?.google_refresh_token_encrypted || !settings?.encryption_key_encrypted) {
    return NextResponse.json({ error: 'Google not connected. Connect Google in Settings.' }, { status: 400 })
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return NextResponse.json({ error: 'Server misconfiguration' }, { status: 500 })

  const dek = decrypt(settings.encryption_key_encrypted, kek)
  const refreshToken = decrypt(settings.google_refresh_token_encrypted, dek)
  const creds = await getGoogleCredentials(admin, membership.fund_id)

  let accessToken: string
  try {
    accessToken = await getAccessToken(refreshToken, creds?.clientId, creds?.clientSecret)
  } catch {
    return NextResponse.json({ error: 'Failed to get Google access token. You may need to reconnect Google in Settings.' }, { status: 400 })
  }

  let senderEmail: string
  try {
    senderEmail = await getGmailProfile(accessToken)
  } catch {
    return NextResponse.json({ error: 'Gmail access denied. You may need to reconnect Google in Settings to grant Gmail permissions.' }, { status: 403 })
  }

  // Send one email per company — all addresses for a company go in the To field
  const results: { emails: string; success: boolean; error?: string; messageId?: string }[] = []

  for (const recipient of recipients as { emails: string[]; companyName: string }[]) {
    const toAddresses = recipient.emails.join(', ')
    try {
      const result = await sendEmail(accessToken, toAddresses, senderEmail, subject.trim(), body_html.trim(), cc?.trim() || undefined)
      results.push({ emails: toAddresses, success: true, messageId: result.id })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      results.push({ emails: toAddresses, success: false, error: msg })
    }
  }

  // Save the request record
  const sent = results.filter(r => r.success).length
  const failed = results.filter(r => !r.success).length

  await admin.from('email_requests').insert({
    fund_id: membership.fund_id,
    subject: subject.trim(),
    body_html: (body_text ?? body_html).trim(),
    recipients,
    quarter_label: quarter_label?.trim() || null,
    sent_by: user.id,
    status: 'sent',
    sent_at: new Date().toISOString(),
    send_results: { sent, failed, details: results },
  })

  return NextResponse.json({ sent, failed, results })
}
