import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/crypto'
import { randomBytes } from 'crypto'

// GET — check onboarding status so the UI can resume where the user left off
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  // Check if user already has a fund
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ step: 1, fundId: null, webhookToken: null })
  }

  const fundId = membership.fund_id

  // Get fund settings to determine progress
  const { data: settings } = await admin
    .from('fund_settings')
    .select('postmark_inbound_address, postmark_webhook_token, inbound_email_provider, mailgun_inbound_domain')
    .eq('fund_id', fundId)
    .maybeSingle()

  if (!settings) {
    return NextResponse.json({ step: 1, fundId: null, webhookToken: null })
  }

  // Check if senders are configured
  const { count: senderCount } = await admin
    .from('authorized_senders')
    .select('id', { count: 'exact', head: true })
    .eq('fund_id', fundId)

  const webhookToken = settings.postmark_webhook_token

  // Step 2 is complete if either Postmark or Mailgun inbound is configured
  const inboundConfigured =
    (settings.inbound_email_provider === 'postmark' && settings.postmark_inbound_address) ||
    (settings.inbound_email_provider === 'mailgun' && settings.mailgun_inbound_domain) ||
    // Legacy: postmark address set without explicit provider
    (!settings.inbound_email_provider && settings.postmark_inbound_address)

  if (!inboundConfigured) {
    return NextResponse.json({ step: 2, fundId, webhookToken })
  }

  if (!senderCount || senderCount === 0) {
    return NextResponse.json({ step: 3, fundId, webhookToken })
  }

  // Fully complete — redirect to dashboard
  return NextResponse.json({ step: 'complete', fundId, webhookToken })
}

// POST — create fund (idempotent: returns existing fund if user already has one)
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { fundName, claudeApiKey } = await req.json()
  if (!fundName?.trim() || !claudeApiKey?.trim()) {
    return NextResponse.json({ error: 'Fund name and API key are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Check if user already has a fund — return it instead of creating a duplicate
  const { data: existing } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (existing) {
    // Update fund name and API key on the existing fund
    await admin.from('funds').update({ name: fundName.trim() }).eq('id', existing.fund_id)

    const kek = process.env.ENCRYPTION_KEY
    if (kek) {
      const dek = randomBytes(32).toString('hex')
      await admin
        .from('fund_settings')
        .update({
          claude_api_key_encrypted: encrypt(claudeApiKey.trim(), dek),
          encryption_key_encrypted: encrypt(dek, kek),
        })
        .eq('fund_id', existing.fund_id)
    }

    const { data: settings } = await admin
      .from('fund_settings')
      .select('postmark_webhook_token')
      .eq('fund_id', existing.fund_id)
      .single()

    return NextResponse.json({
      fundId: existing.fund_id,
      webhookToken: settings?.postmark_webhook_token,
    })
  }

  // Extract email domain for fund-level domain matching
  const emailDomain = user.email?.split('@')[1]?.toLowerCase() || null

  // Create the fund — the trigger auto-adds the creator to fund_members
  const { data: fund, error: fundError } = await admin
    .from('funds')
    .insert({ name: fundName.trim(), created_by: user.id, email_domain: emailDomain })
    .select('id')
    .single()

  if (fundError || !fund) {
    console.error('[onboarding/fund] Failed to create fund:', fundError)
    return NextResponse.json({ error: 'Failed to create fund' }, { status: 500 })
  }

  // Envelope encryption:
  //   1. Generate a random per-fund DEK (data encryption key)
  //   2. Encrypt the DEK with the master KEK from ENCRYPTION_KEY env var
  //   3. Encrypt the Claude API key with the DEK
  const kek = process.env.ENCRYPTION_KEY
  if (!kek) {
    await admin.from('funds').delete().eq('id', fund.id)
    return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })
  }

  const dek = randomBytes(32).toString('hex')
  const encryptionKeyEncrypted = encrypt(dek, kek)
  const claudeApiKeyEncrypted = encrypt(claudeApiKey.trim(), dek)

  // Generate a random webhook token for Postmark URL validation
  const webhookToken = randomBytes(32).toString('hex')
  const webhookTokenEncrypted = encrypt(webhookToken, dek)

  const { error: settingsError } = await admin
    .from('fund_settings')
    .insert({
      fund_id: fund.id,
      claude_api_key_encrypted: claudeApiKeyEncrypted,
      encryption_key_encrypted: encryptionKeyEncrypted,
      postmark_webhook_token: webhookToken,
      postmark_webhook_token_encrypted: webhookTokenEncrypted,
    })

  if (settingsError) {
    console.error('[onboarding/fund] Failed to create fund_settings:', settingsError)
    await admin.from('funds').delete().eq('id', fund.id)
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 })
  }

  return NextResponse.json({ fundId: fund.id, webhookToken })
}
