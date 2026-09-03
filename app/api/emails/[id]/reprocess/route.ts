import { NextRequest, NextResponse } from 'next/server'
import { expireTag } from '@/lib/cache/tags'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { runPipeline, type PostmarkPayload } from '@/lib/pipeline/processEmail'
import { hydrateAttachments } from '@/lib/parsing/extractAttachmentText'
import type { InboundEmail } from '@/lib/types/database'
import { dbError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'

export const maxDuration = 300

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  // Rate limit reprocessing: 10 per 5 minutes per user
  const limited = await rateLimit({ key: `reprocess:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  // Fetch email — RLS ensures it belongs to the user's fund
  const { data: emailData, error } = await supabase
    .from('inbound_emails')
    .select('id, fund_id, raw_payload, processing_status')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return dbError(error, 'emails-id-reprocess')
  if (!emailData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const email = emailData as unknown as Pick<
    InboundEmail,
    'id' | 'fund_id' | 'raw_payload' | 'processing_status'
  >

  if (email.processing_status === 'processing') {
    return NextResponse.json({ error: 'Already processing' }, { status: 409 })
  }
  if (!email.raw_payload) {
    return NextResponse.json({ error: 'No stored payload to reprocess' }, { status: 422 })
  }

  const admin = createAdminClient()
  const emailId = email.id
  const fundId = email.fund_id

  // Delete existing reviews and metric_values sourced from this email (scoped to fund)
  await admin.from('parsing_reviews').delete().eq('email_id', emailId).eq('fund_id', fundId)
  await admin.from('metric_values').delete().eq('source_email_id', emailId).eq('fund_id', fundId)

  // Reset the email record (preserve company_id so manual assignment isn't lost)
  await admin
    .from('inbound_emails')
    .update({
      processing_status: 'processing',
      processing_error: null,
      claude_response: null,
      metrics_extracted: 0,
    })
    .eq('id', emailId)

  // Hydrate attachments from Storage before re-running pipeline
  const hydratedPayload = await hydrateAttachments(
    email.raw_payload as unknown as PostmarkPayload
  ) as unknown as PostmarkPayload

  const senderEmail = (hydratedPayload.FromFull?.Email ?? hydratedPayload.From ?? '').trim().toLowerCase()
  const { data: memberRow } = await admin.rpc('is_fund_member_by_email', {
    p_fund_id: fundId,
    p_email: senderEmail,
  })
  const fundMember = (memberRow as any)?.[0]
    ? { userId: (memberRow as any)[0].user_id as string }
    : null

  // Keep the request alive until the pipeline reaches a terminal state. A
  // fire-and-forget promise can be terminated when a serverless response ends.
  try {
    await runPipeline(admin, emailId, fundId, hydratedPayload, fundMember)
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err)
    console.error(`[reprocess] Pipeline error for email ${emailId}:`, err)
    const message = describePipelineError(raw)
    await admin
      .from('inbound_emails')
      .update({ processing_status: 'failed', processing_error: message })
      .eq('id', emailId)
  }

  expireTag('review-badge')

  const { data: result } = await admin
    .from('inbound_emails')
    .select('processing_status, processing_error')
    .eq('id', emailId)
    .maybeSingle()

  return NextResponse.json({
    ok: true,
    message: 'Reprocessing finished',
    processing_status: result?.processing_status ?? 'failed',
    processing_error: result?.processing_error ?? null,
  })
}

function describePipelineError(raw: string): string {
  if (raw.includes('API key not configured')) {
    const provider = raw.includes('OpenAI') ? 'OpenAI' : raw.includes('Gemini') ? 'Gemini' : 'AI'
    return `${provider} API key not configured. Add it in Settings to process emails.`
  }
  if (raw.includes('Failed to refresh Google token') || raw.includes('invalid_grant')) {
    return 'Google Drive connection expired. Reconnect in Settings > Google credentials, then reprocess this email.'
  }
  if (raw.includes('rate limit') || raw.includes('429')) {
    return 'AI provider rate limit reached. Wait a few minutes and reprocess this email.'
  }
  if (raw.includes('timeout') || raw.includes('ETIMEDOUT') || raw.includes('ECONNREFUSED')) {
    return 'Connection to AI provider timed out. Check your API key and try reprocessing.'
  }
  return raw
}
