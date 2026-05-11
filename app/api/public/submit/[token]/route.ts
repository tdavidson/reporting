import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProvider } from '@/lib/ai'
import { extractAttachmentText, type PostmarkPayload } from '@/lib/parsing/extractAttachmentText'
import { processDeal } from '@/lib/pipeline/processDeal'
import type { PostmarkPayload as PipelinePayload } from '@/lib/pipeline/processEmail'
import { rateLimit } from '@/lib/rate-limit'

const MAX_FILE_BYTES = 10 * 1024 * 1024
const MIN_PITCH_LEN = 50

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() || 'unknown'
  const limited = await rateLimit({ key: `public-submit:${ip}`, limit: 5, windowSeconds: 3600 })
  if (limited) return limited

  const admin = createAdminClient()

  // Resolve the token to a fund. RLS bypass via service role; the token is the auth.
  const { data: settings } = await admin
    .from('fund_settings')
    .select('fund_id, deal_intake_enabled, deal_submission_token')
    .eq('deal_submission_token', params.token)
    .maybeSingle()

  if (!settings || !(settings as any).deal_intake_enabled) {
    return NextResponse.json({ error: 'Submission form is not active' }, { status: 404 })
  }
  const fundId = (settings as any).fund_id as string

  let body: {
    companyName?: string
    companyUrl?: string
    founderName?: string
    founderEmail?: string
    pitch?: string
    attachment?: { name: string; contentType: string; data: string } | null
    website?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Honeypot — silently accept-but-discard.
  if (body.website && body.website.trim()) {
    return NextResponse.json({ ok: true })
  }

  const companyName = body.companyName?.trim() ?? ''
  const founderName = body.founderName?.trim() ?? ''
  const founderEmail = body.founderEmail?.trim().toLowerCase() ?? ''
  const pitch = body.pitch?.trim() ?? ''
  const companyUrl = body.companyUrl?.trim() ?? ''

  if (!companyName || !founderName || !founderEmail || !pitch) {
    return NextResponse.json({ error: 'Required fields missing' }, { status: 400 })
  }
  if (!founderEmail.includes('@')) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }
  if (pitch.length < MIN_PITCH_LEN) {
    return NextResponse.json({ error: `Pitch must be at least ${MIN_PITCH_LEN} characters` }, { status: 400 })
  }

  // Validate attachment if present.
  let attachment: { Name: string; ContentType: string; Content: string; ContentLength: number } | null = null
  if (body.attachment && typeof body.attachment === 'object' && body.attachment.data) {
    if (typeof body.attachment.name !== 'string' || typeof body.attachment.contentType !== 'string') {
      return NextResponse.json({ error: 'Invalid attachment metadata' }, { status: 400 })
    }
    const raw = Buffer.from(body.attachment.data, 'base64')
    if (raw.length === 0 || raw.length > MAX_FILE_BYTES) {
      return NextResponse.json({ error: 'Attachment too large' }, { status: 400 })
    }
    attachment = {
      Name: body.attachment.name.replace(/[\/\\:*?"<>|]/g, '_').slice(0, 200),
      ContentType: body.attachment.contentType,
      Content: body.attachment.data,
      ContentLength: raw.length,
    }
  }

  // Build a synthetic Postmark-shaped payload so the rest of the pipeline can
  // consume it without special-casing public submissions.
  const subject = `Web submission: ${companyName}`
  const composedBody = [
    `Founder: ${founderName} <${founderEmail}>`,
    companyUrl ? `Website: ${companyUrl}` : null,
    '',
    pitch,
  ].filter(Boolean).join('\n')

  const messageId = `<public-submit-${crypto.randomUUID()}@hemrock.local>`

  const payload: PostmarkPayload & { From: string; To: string; FromFull: { Email: string; Name: string }; Subject: string; MessageID: string } = {
    From: founderEmail,
    To: 'public-submit@hemrock.local',
    FromFull: { Email: founderEmail, Name: founderName },
    Subject: subject,
    TextBody: composedBody,
    HtmlBody: '',
    MessageID: messageId,
    Attachments: attachment ? [attachment] : [],
  }

  // Insert inbound_emails row first so processDeal can FK to it.
  const { data: emailInsert, error: emailErr } = await admin
    .from('inbound_emails')
    .insert({
      fund_id: fundId,
      from_address: founderEmail,
      subject,
      received_at: new Date().toISOString(),
      raw_payload: stripAttachmentContent(payload) as any,
      processing_status: 'processing',
      attachments_count: attachment ? 1 : 0,
      routing_label: 'deals',
      routing_confidence: 1.0,
      routing_reasoning: 'Public submission form (bypassed classifier)',
      routing_secondary_label: null,
      routed_to: 'deals',
    } as any)
    .select('id')
    .single()

  if (emailErr || !emailInsert) {
    console.error('[public-submit] inbound_emails insert failed:', emailErr)
    return NextResponse.json({ error: 'Submission failed' }, { status: 500 })
  }

  const emailId = (emailInsert as { id: string }).id

  // Upload attachment to Supabase Storage if present, and update payload to
  // reference the StoragePath so future re-runs (regenerate, reroute) can
  // re-hydrate it.
  if (attachment) {
    const safeName = `0_${attachment.Name}`
    const storagePath = `${emailId}/${safeName}`
    const buf = Buffer.from(attachment.Content, 'base64')
    const { error: uploadErr } = await admin.storage
      .from('email-attachments')
      .upload(storagePath, buf, { contentType: attachment.ContentType, upsert: true })
    if (!uploadErr) {
      // Re-store payload with StoragePath (and Content stripped to save bytes).
      const stripped = {
        ...stripAttachmentContent(payload),
        Attachments: [{
          Name: attachment.Name,
          ContentType: attachment.ContentType,
          ContentLength: attachment.ContentLength,
          StoragePath: storagePath,
        }],
      }
      await admin.from('inbound_emails').update({ raw_payload: stripped as any }).eq('id', emailId)
    }
  }

  // Run the deals pipeline. Failures don't roll back the email row — they're
  // recorded as processing_status='failed' so admins can retry from the email page.
  try {
    const { provider, model, providerType } = await createFundAIProvider(admin, fundId)
    const extracted = await extractAttachmentText(payload)
    await processDeal({
      supabase: admin,
      emailId,
      fundId,
      payload: payload as PipelinePayload,
      extracted,
      provider,
      providerType,
      model,
    })
    await admin
      .from('inbound_emails')
      .update({ processing_status: 'success' })
      .eq('id', emailId)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[public-submit] processDeal failed:', msg)
    await admin
      .from('inbound_emails')
      .update({ processing_status: 'failed', processing_error: msg })
      .eq('id', emailId)
    // We still return ok to the founder — admins can recover from the audit/emails page.
  }

  return NextResponse.json({ ok: true })
}

function stripAttachmentContent(payload: any) {
  if (!payload.Attachments) return payload
  return {
    ...payload,
    Attachments: payload.Attachments.map((a: any) => {
      const { Content, ...rest } = a
      return rest
    }),
  }
}
