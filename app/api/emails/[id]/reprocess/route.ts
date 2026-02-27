import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runPipeline, type PostmarkPayload } from '@/lib/pipeline/processEmail'
import type { InboundEmail } from '@/lib/types/database'

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Fetch email — RLS ensures it belongs to the user's fund
  const { data: emailData, error } = await supabase
    .from('inbound_emails')
    .select('id, fund_id, raw_payload, processing_status')
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
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

  // Delete existing reviews and metric_values sourced from this email
  await admin.from('parsing_reviews').delete().eq('email_id', emailId)
  await admin.from('metric_values').delete().eq('source_email_id', emailId)

  // Reset the email record
  await admin
    .from('inbound_emails')
    .update({
      processing_status: 'processing',
      processing_error: null,
      claude_response: null,
      metrics_extracted: 0,
      company_id: null,
    })
    .eq('id', emailId)

  // Re-run pipeline asynchronously — return immediately
  runPipeline(admin, emailId, fundId, email.raw_payload as unknown as PostmarkPayload).catch(
    async err => {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[reprocess] Pipeline error for email ${emailId}:`, err)
      await admin
        .from('inbound_emails')
        .update({ processing_status: 'failed', processing_error: message })
        .eq('id', emailId)
    }
  )

  return NextResponse.json({ ok: true, message: 'Reprocessing started' })
}
