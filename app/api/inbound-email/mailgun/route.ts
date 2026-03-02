import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verifyMailgunWebhook } from '@/lib/mailgun/verify'
import { normalizeMailgunPayload, toPostmarkPayload } from '@/lib/pipeline/normalizePayload'
import { runPipeline } from '@/lib/pipeline/processEmail'
import { isAuthorizedSender } from '@/lib/pipeline/isAuthorizedSender'
import { decrypt } from '@/lib/crypto'
import type { Json } from '@/lib/types/database'

export async function POST(req: NextRequest) {
  try {
    await handleMailgunInbound(req)
  } catch (err) {
    console.error('[inbound-email/mailgun] Unhandled error:', err)
  }
  // Always return 200 so Mailgun doesn't retry
  return NextResponse.json({ ok: true })
}

async function handleMailgunInbound(req: NextRequest) {
  const supabase = createAdminClient()

  // Mailgun sends inbound emails as multipart/form-data
  const formData = await req.formData()
  const fields: Record<string, string> = {}
  const attachments: Array<{ filename: string; contentType: string; content: Buffer }> = []

  formData.forEach((value, key) => {
    if (typeof value === 'string') {
      fields[key] = value
    }
  })

  // Process file attachments separately
  const attachmentEntries = Array.from(formData.entries()).filter(
    (entry): entry is [string, File] => entry[1] instanceof File
  )
  for (const [, file] of attachmentEntries) {
    const buffer = Buffer.from(await file.arrayBuffer())
    attachments.push({
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      content: buffer,
    })
  }

  // Extract sender and recipient
  const fromAddress = extractEmail(fields.from || fields.sender || '')
  const recipient = fields.recipient || ''

  if (!fromAddress || !recipient) {
    console.warn('[inbound-email/mailgun] Missing from or recipient')
    return
  }

  // Resolve which fund this email belongs to by matching the Mailgun inbound domain
  const { data: allSettings } = await supabase
    .from('fund_settings')
    .select('fund_id, mailgun_inbound_domain, mailgun_signing_key_encrypted, encryption_key_encrypted')
    .eq('inbound_email_provider', 'mailgun')
    .not('mailgun_inbound_domain', 'is', null)

  if (!allSettings || allSettings.length === 0) {
    console.warn('[inbound-email/mailgun] No funds configured for Mailgun inbound')
    return
  }

  // Match fund by recipient domain
  const recipientDomain = recipient.split('@')[1]?.toLowerCase()
  const fundSettings = allSettings.find(s =>
    s.mailgun_inbound_domain?.toLowerCase() === recipientDomain
  )

  if (!fundSettings) {
    console.warn(`[inbound-email/mailgun] No fund matches domain ${recipientDomain}`)
    return
  }

  const fundId = fundSettings.fund_id

  // Verify webhook signature
  if (fundSettings.mailgun_signing_key_encrypted && fundSettings.encryption_key_encrypted) {
    const kek = process.env.ENCRYPTION_KEY
    if (kek) {
      const dek = decrypt(fundSettings.encryption_key_encrypted, kek)
      const signingKey = decrypt(fundSettings.mailgun_signing_key_encrypted, dek)

      const timestamp = fields.timestamp || ''
      const token = fields.token || ''
      const signature = fields.signature || ''

      if (!verifyMailgunWebhook(signingKey, timestamp, token, signature)) {
        console.warn('[inbound-email/mailgun] Invalid webhook signature')
        return
      }
    }
  }

  // Check authorized senders
  const authorized = await isAuthorizedSender(supabase, fundId, fromAddress)
  if (!authorized) {
    console.warn(`[inbound-email/mailgun] Unauthorized sender ${fromAddress} for fund ${fundId}`)
    return
  }

  // Normalize to PostmarkPayload format for the existing pipeline
  const normalized = normalizeMailgunPayload(fields, attachments)
  const payload = toPostmarkPayload(normalized)

  // Persist raw email
  const { data: emailRow, error: insertError } = await supabase
    .from('inbound_emails')
    .insert({
      fund_id: fundId,
      from_address: fromAddress,
      subject: fields.subject ?? null,
      raw_payload: fields as unknown as Json,
      processing_status: 'pending',
      attachments_count: attachments.length,
    })
    .select('id')
    .single()

  if (insertError || !emailRow) {
    console.error('[inbound-email/mailgun] Failed to insert email record:', insertError)
    return
  }

  const emailId = emailRow.id

  try {
    await supabase
      .from('inbound_emails')
      .update({ processing_status: 'processing' })
      .eq('id', emailId)

    await runPipeline(supabase, emailId, fundId, payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[inbound-email/mailgun] Pipeline error for email ${emailId}:`, err)
    await supabase
      .from('inbound_emails')
      .update({ processing_status: 'failed', processing_error: message })
      .eq('id', emailId)
  }
}

function extractEmail(from: string): string {
  const match = from.match(/<([^>]+)>/)
  return match ? match[1] : from.trim()
}
