import { NextRequest, NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { runPipeline, type PostmarkPayload } from '@/lib/pipeline/processEmail'
import { processDeal } from '@/lib/pipeline/processDeal'
import { extractAttachmentText, hydrateAttachments } from '@/lib/parsing/extractAttachmentText'
import { createFundAIProvider } from '@/lib/ai'
import { rateLimit } from '@/lib/rate-limit'
import { assertWriteAccess } from '@/lib/api-helpers'

const VALID_TARGETS = ['reporting', 'interactions', 'deals', 'audit'] as const
type RerouteTarget = typeof VALID_TARGETS[number]

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const limited = await rateLimit({ key: `reroute:${user.id}`, limit: 20, windowSeconds: 300 })
  if (limited) return limited

  const body = await req.json().catch(() => ({}))
  const target = body.to as RerouteTarget
  if (!VALID_TARGETS.includes(target)) {
    return NextResponse.json({ error: 'Invalid target' }, { status: 400 })
  }

  // Fetch email (RLS via RPC scopes by membership)
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const { data: emailData } = await admin
    .from('inbound_emails')
    .select('id, fund_id, raw_payload, routed_to, routing_label')
    .eq('id', params.id)
    .eq('fund_id', membership.fund_id)
    .maybeSingle()

  if (!emailData) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!(emailData as any).raw_payload) return NextResponse.json({ error: 'No stored payload' }, { status: 422 })

  const emailId = (emailData as any).id as string
  const fundId = (emailData as any).fund_id as string
  const originalLabel = ((emailData as any).routing_label ?? (emailData as any).routed_to ?? 'reporting') as string

  // Wipe records from all pipelines so the destination starts from a clean slate.
  await Promise.all([
    admin.from('inbound_deals').delete().eq('email_id', emailId).eq('fund_id', fundId),
    admin.from('interactions').delete().eq('email_id', emailId).eq('fund_id', fundId),
    admin.from('metric_values').delete().eq('source_email_id', emailId).eq('fund_id', fundId),
    admin.from('parsing_reviews').delete().eq('email_id', emailId).eq('fund_id', fundId),
  ])

  // Log the correction.
  await admin.from('routing_corrections').insert({
    email_id: emailId,
    fund_id: fundId,
    original_label: originalLabel,
    corrected_label: target,
    corrected_by: user.id,
  })

  // Update routed_to first; the destination pipeline may set this again on success.
  await admin
    .from('inbound_emails')
    .update({ routed_to: target, processing_status: 'processing', processing_error: null, claude_response: null, metrics_extracted: 0 })
    .eq('id', emailId)

  const payload = (emailData as any).raw_payload as PostmarkPayload

  if (target === 'audit') {
    await admin
      .from('inbound_emails')
      .update({ processing_status: 'not_processed', routed_to: 'audit' })
      .eq('id', emailId)
    revalidateTag('fund-data')
    return NextResponse.json({ ok: true })
  }

  if (target === 'deals') {
    // Hydrate attachment Content from storage if needed (raw_payload strips it)
    const hydrated = (await hydrateAttachments(payload as any)) as PostmarkPayload
    const extracted = await extractAttachmentText(hydrated)
    const { provider, model, providerType } = await createFundAIProvider(admin, fundId)
    try {
      await processDeal({ supabase: admin, emailId, fundId, payload: hydrated, extracted, provider, providerType, model })
      await admin
        .from('inbound_emails')
        .update({ processing_status: 'success', routed_to: 'deals' })
        .eq('id', emailId)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      await admin
        .from('inbound_emails')
        .update({ processing_status: 'failed', processing_error: msg })
        .eq('id', emailId)
      return NextResponse.json({ error: msg }, { status: 500 })
    }
    revalidateTag('fund-data')
    return NextResponse.json({ ok: true })
  }

  // 'reporting' or 'interactions' — fall through to the existing pipeline.
  // Look up fund member info so the pipeline can extract interactions when applicable.
  const senderEmail = (payload.FromFull?.Email ?? payload.From ?? '').trim().toLowerCase()
  const { data: memberRow } = await admin.rpc('is_fund_member_by_email', {
    p_fund_id: fundId,
    p_email: senderEmail,
  })
  const fundMember = (memberRow as any)?.[0] ? { userId: (memberRow as any)[0].user_id } : null

  const hydrated = (await hydrateAttachments(payload as any)) as PostmarkPayload
  try {
    await runPipeline(admin, emailId, fundId, hydrated, fundMember)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await admin
      .from('inbound_emails')
      .update({ processing_status: 'failed', processing_error: msg })
      .eq('id', emailId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  revalidateTag('fund-data')
  return NextResponse.json({ ok: true })
}
