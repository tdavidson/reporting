import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProvider } from '@/lib/ai'
import { extractAttachmentText, type AttachmentResult } from '@/lib/parsing/extractAttachmentText'
import { analyzeDeal, DEFAULT_SCREENING_PROMPT } from '@/lib/claude/analyzeDeal'
import type { PostmarkPayload } from '@/lib/pipeline/processEmail'

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
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

  // Load the deal + originating email payload.
  const { data: deal } = await admin
    .from('inbound_deals')
    .select('id, email_id')
    .eq('id', params.id)
    .eq('fund_id', membership.fund_id)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: email } = await admin
    .from('inbound_emails')
    .select('raw_payload')
    .eq('id', (deal as any).email_id)
    .maybeSingle()
  if (!email || !(email as any).raw_payload) {
    return NextResponse.json({ error: 'Email payload missing' }, { status: 400 })
  }

  const payload = (email as any).raw_payload as PostmarkPayload

  // raw_payload has Attachments stripped of Content (see inbound webhook).
  // Use extractAttachmentText with what we have — text-only attachments
  // already have extractedText baked into raw_payload's stored output, but
  // since we don't store that, re-extract from the text body alone.
  const extracted = await extractAttachmentText(payload)

  const { provider, model, providerType } = await createFundAIProvider(admin, membership.fund_id)

  const { data: settings } = await admin
    .from('fund_settings')
    .select('deal_thesis, deal_screening_prompt')
    .eq('fund_id', membership.fund_id)
    .maybeSingle()
  const thesis = ((settings as any)?.deal_thesis as string | null) ?? ''
  const screening = ((settings as any)?.deal_screening_prompt as string | null) ?? DEFAULT_SCREENING_PROMPT

  const combinedText = extracted.attachments
    .filter((a: AttachmentResult) => !a.skipped && a.extractedText)
    .map((a: AttachmentResult) => `[${a.filename}]\n${a.extractedText}`)
    .join('\n\n')

  const pdfBase64s = extracted.attachments
    .filter((a: AttachmentResult) => !a.skipped && a.base64Content && a.contentType === 'application/pdf')
    .map((a: AttachmentResult) => a.base64Content!)

  const images = extracted.attachments
    .filter((a: AttachmentResult) => !a.skipped && a.base64Content && a.contentType.startsWith('image/'))
    .map((a: AttachmentResult) => ({ data: a.base64Content!, mediaType: a.contentType }))

  const analysis = await analyzeDeal({
    emailSubject: payload.Subject ?? '',
    emailBody: extracted.emailBody,
    combinedAttachmentText: combinedText,
    pdfBase64s,
    images,
    thesis,
    screeningPrompt: screening,
    provider,
    providerType,
    model,
    log: { admin, fundId: membership.fund_id },
  })

  // Update only the analysis fields — preserve user-edited status/assigned_to.
  await admin
    .from('inbound_deals')
    .update({
      company_summary: analysis.company_summary,
      thesis_fit_analysis: analysis.thesis_fit_analysis,
      thesis_fit_score: analysis.thesis_fit_score,
      updated_at: new Date().toISOString(),
    })
    .eq('id', params.id)
    .eq('fund_id', membership.fund_id)

  return NextResponse.json({ ok: true, analysis })
}
