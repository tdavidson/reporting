import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  runPipeline,
  type PostmarkPayload,
} from '@/lib/pipeline/processEmail'

// ---------------------------------------------------------------------------
// Entry point — always returns HTTP 200 to Postmark
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  try {
    await handleInbound(req)
  } catch (err) {
    console.error('[inbound-email] Unhandled error:', err)
  }
  return NextResponse.json({ ok: true })
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

async function handleInbound(req: NextRequest) {
  const supabase = createAdminClient()
  const token = req.nextUrl.searchParams.get('token') ?? ''
  const payload = (await req.json()) as PostmarkPayload

  const toAddress = payload.OriginalRecipient || payload.To
  const fromAddress = payload.FromFull?.Email || payload.From

  // Step 1: Resolve which fund this email belongs to and validate the token
  const fundInfo = await resolveFund(supabase, toAddress, fromAddress, token)
  if (!fundInfo) {
    console.warn(`[inbound-email] Could not resolve fund for to=${toAddress} from=${fromAddress}`)
    return
  }
  const { fundId, isGlobal } = fundInfo

  // Step 2: Check authorized senders
  if (!isGlobal) {
    const authorized = await isAuthorizedSender(supabase, fundId, fromAddress)
    if (!authorized) {
      console.warn(`[inbound-email] Unauthorized sender ${fromAddress} for fund ${fundId}`)
      return
    }
  }

  // Step 3: Persist raw payload with status 'pending'
  const { data: emailRow, error: insertError } = await supabase
    .from('inbound_emails')
    .insert({
      fund_id: fundId,
      from_address: fromAddress,
      subject: payload.Subject ?? null,
      raw_payload: payload as unknown as import('@/lib/types/database').Json,
      processing_status: 'pending',
      attachments_count: payload.Attachments?.length ?? 0,
    })
    .select('id')
    .single()

  if (insertError || !emailRow) {
    console.error('[inbound-email] Failed to insert email record:', insertError)
    return
  }

  const emailId = emailRow.id

  // Steps 4–8: extraction pipeline. Any error → mark failed.
  try {
    await supabase
      .from('inbound_emails')
      .update({ processing_status: 'processing' })
      .eq('id', emailId)

    await runPipeline(supabase, emailId, fundId, payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`[inbound-email] Pipeline error for email ${emailId}:`, err)
    await supabase
      .from('inbound_emails')
      .update({ processing_status: 'failed', processing_error: message })
      .eq('id', emailId)
  }
}

// ---------------------------------------------------------------------------
// Fund resolution helpers (specific to inbound routing)
// ---------------------------------------------------------------------------

type AdminClient = ReturnType<typeof createAdminClient>

async function resolveFund(
  supabase: AdminClient,
  toAddress: string,
  fromAddress: string,
  token: string
): Promise<{ fundId: string; isGlobal: boolean } | null> {
  const { data: fundSettings } = await supabase
    .from('fund_settings')
    .select('fund_id, postmark_webhook_token')
    .eq('postmark_inbound_address', toAddress)
    .maybeSingle()

  if (fundSettings) {
    if (!token || token !== fundSettings.postmark_webhook_token) {
      console.warn('[inbound-email] Invalid token for per-fund address')
      return null
    }
    return { fundId: fundSettings.fund_id, isGlobal: false }
  }

  const { data: appSettings } = await supabase
    .from('app_settings')
    .select('global_inbound_address, global_inbound_token')
    .maybeSingle()

  if (!appSettings?.global_inbound_address || toAddress !== appSettings.global_inbound_address) {
    return null
  }

  if (!token || token !== appSettings.global_inbound_token) {
    console.warn('[inbound-email] Invalid token for global address')
    return null
  }

  const { data: senders } = await supabase
    .from('authorized_senders')
    .select('fund_id')
    .eq('email', fromAddress)

  if (!senders || senders.length === 0) return null

  if (senders.length > 1) {
    console.error(
      `[inbound-email] Ambiguous routing: ${fromAddress} is an authorized sender for multiple funds`
    )
    return null
  }

  return { fundId: senders[0].fund_id, isGlobal: true }
}

async function isAuthorizedSender(
  supabase: AdminClient,
  fundId: string,
  email: string
): Promise<boolean> {
  const { data } = await supabase
    .from('authorized_senders')
    .select('id')
    .eq('fund_id', fundId)
    .eq('email', email)
    .maybeSingle()
  return !!data
}
