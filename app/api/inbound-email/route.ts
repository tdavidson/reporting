import { NextRequest, NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { createAdminClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import {
  runPipeline,
  type PostmarkPayload,
} from '@/lib/pipeline/processEmail'
import { isAuthorizedSender } from '@/lib/pipeline/isAuthorizedSender'

function safeTokenCompare(a: string, b: string): boolean {
  try {
    return a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// Entry point — always returns HTTP 200 to Postmark
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  if (process.env.DEMO_MODE === 'true') {
    console.log('[inbound-email] Skipped — demo mode is enabled')
    return NextResponse.json({ ok: true })
  }

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
  // Accept token from Authorization header (preferred) or query string (legacy/Postmark)
  const authHeader = req.headers.get('authorization')
  const token = (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null)
    ?? req.nextUrl.searchParams.get('token')
    ?? ''
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

async function resolveFund(
  supabase: ReturnType<typeof createAdminClient>,
  toAddress: string,
  fromAddress: string,
  token: string
): Promise<{ fundId: string; isGlobal: boolean } | null> {
  const { data: fundSettings } = await supabase
    .from('fund_settings')
    .select('fund_id, postmark_webhook_token, postmark_webhook_token_encrypted, encryption_key_encrypted')
    .eq('postmark_inbound_address', toAddress)
    .maybeSingle()

  if (fundSettings) {
    // Prefer encrypted token; fall back to plaintext for legacy
    let expectedToken = fundSettings.postmark_webhook_token ?? ''
    if (fundSettings.postmark_webhook_token_encrypted && fundSettings.encryption_key_encrypted) {
      try {
        const kek = process.env.ENCRYPTION_KEY
        if (kek) {
          const dek = decrypt(fundSettings.encryption_key_encrypted, kek)
          expectedToken = decrypt(fundSettings.postmark_webhook_token_encrypted, dek)
        }
      } catch {
        // Fall back to plaintext
      }
    }
    if (!token || !expectedToken || !safeTokenCompare(token, expectedToken)) {
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

  if (!token || !appSettings.global_inbound_token || !safeTokenCompare(token, appSettings.global_inbound_token)) {
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

