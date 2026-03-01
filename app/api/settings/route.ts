import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/crypto'
import { randomBytes } from 'crypto'

// GET — returns fund settings (safe fields only)
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role, display_name')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 404 })

  const [{ data: fund }, { data: settings }, { data: senders }] = await Promise.all([
    admin.from('funds').select('id, name, logo_url').eq('id', membership.fund_id).single(),
    admin.from('fund_settings').select('postmark_inbound_address, postmark_webhook_token, retain_resolved_reviews, resolved_reviews_ttl_days, claude_api_key_encrypted, claude_model, ai_summary_prompt, auth_subtitle, auth_contact, google_refresh_token_encrypted, google_drive_folder_id, google_drive_folder_name, google_client_id, google_client_secret_encrypted').eq('fund_id', membership.fund_id).single(),
    admin.from('authorized_senders').select('id, email, label, created_at').eq('fund_id', membership.fund_id).order('email'),
  ])

  return NextResponse.json({
    fundId: fund?.id,
    fundName: fund?.name,
    fundLogo: fund?.logo_url ?? null,
    postmarkInboundAddress: settings?.postmark_inbound_address ?? '',
    postmarkWebhookToken: settings?.postmark_webhook_token ?? '',
    hasClaudeKey: !!settings?.claude_api_key_encrypted,
    claudeModel: settings?.claude_model ?? 'claude-sonnet-4-5',
    retainResolvedReviews: settings?.retain_resolved_reviews ?? true,
    resolvedReviewsTtlDays: settings?.resolved_reviews_ttl_days ?? null,
    senders: senders ?? [],
    googleDriveConnected: !!settings?.google_refresh_token_encrypted,
    googleDriveFolderId: settings?.google_drive_folder_id ?? null,
    googleDriveFolderName: settings?.google_drive_folder_name ?? null,
    hasGoogleCredentials: !!(settings?.google_client_id && settings?.google_client_secret_encrypted) || !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    googleClientId: settings?.google_client_id ?? '',
    aiSummaryPrompt: settings?.ai_summary_prompt ?? null,
    authSubtitle: settings?.auth_subtitle ?? '',
    authContact: settings?.auth_contact ?? '',
    displayName: membership.display_name ?? '',
    isAdmin: membership.role === 'admin',
  })
}

// PATCH — update fund settings
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 404 })

  const body = await req.json()
  const { fundName, fundLogo, postmarkInboundAddress, claudeApiKey, claudeModel, retainResolvedReviews, resolvedReviewsTtlDays, googleClientId, googleClientSecret, aiSummaryPrompt, authSubtitle, authContact, displayName } = body

  // Update display name on fund_members (any user can do this)
  if (displayName !== undefined) {
    await admin.from('fund_members').update({ display_name: displayName?.trim() || null }).eq('fund_id', membership.fund_id).eq('user_id', user.id)
  }

  // All other settings require admin role
  const hasAdminFields = fundName !== undefined || fundLogo !== undefined || postmarkInboundAddress !== undefined ||
    claudeApiKey !== undefined || claudeModel !== undefined || retainResolvedReviews !== undefined ||
    resolvedReviewsTtlDays !== undefined || googleClientId !== undefined || googleClientSecret !== undefined ||
    aiSummaryPrompt !== undefined || authSubtitle !== undefined || authContact !== undefined

  if (hasAdminFields && membership.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  // Update fund name
  if (fundName !== undefined) {
    if (!fundName?.trim()) return NextResponse.json({ error: 'Fund name cannot be empty' }, { status: 400 })
    await admin.from('funds').update({ name: fundName.trim() }).eq('id', membership.fund_id)
  }

  // Update fund logo
  if (fundLogo !== undefined) {
    if (fundLogo !== null) {
      if (typeof fundLogo !== 'string' || !fundLogo.startsWith('data:image/')) {
        return NextResponse.json({ error: 'Logo must be a data:image/ URL' }, { status: 400 })
      }
      if (fundLogo.length > 200 * 1024) {
        return NextResponse.json({ error: 'Logo must be under 200KB' }, { status: 400 })
      }
    }
    await admin.from('funds').update({ logo_url: fundLogo }).eq('id', membership.fund_id)
  }

  // Update fund_settings
  const settingsUpdates: Record<string, unknown> = {}

  if (postmarkInboundAddress !== undefined) {
    settingsUpdates.postmark_inbound_address = postmarkInboundAddress?.trim() || null
  }

  if (retainResolvedReviews !== undefined) {
    settingsUpdates.retain_resolved_reviews = retainResolvedReviews
  }

  if (resolvedReviewsTtlDays !== undefined) {
    settingsUpdates.resolved_reviews_ttl_days = resolvedReviewsTtlDays
  }

  if (claudeModel !== undefined) {
    settingsUpdates.claude_model = claudeModel.trim() || 'claude-sonnet-4-5'
  }

  if (aiSummaryPrompt !== undefined) {
    settingsUpdates.ai_summary_prompt = aiSummaryPrompt?.trim() || null
  }

  if (authSubtitle !== undefined) {
    settingsUpdates.auth_subtitle = authSubtitle?.trim() || null
  }

  if (authContact !== undefined) {
    settingsUpdates.auth_contact = authContact?.trim() || null
  }

  // Update Claude API key with envelope encryption
  if (claudeApiKey !== undefined && claudeApiKey.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

    const dek = randomBytes(32).toString('hex')
    settingsUpdates.encryption_key_encrypted = encrypt(dek, kek)
    settingsUpdates.claude_api_key_encrypted = encrypt(claudeApiKey.trim(), dek)
  }

  // Update Google OAuth credentials
  if (googleClientId !== undefined) {
    settingsUpdates.google_client_id = googleClientId?.trim() || null
  }
  if (googleClientSecret !== undefined && googleClientSecret.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

    // Ensure we have an encryption key; reuse existing or create new
    const { data: existing } = await admin
      .from('fund_settings')
      .select('encryption_key_encrypted')
      .eq('fund_id', membership.fund_id)
      .single()

    let dek: string
    if (existing?.encryption_key_encrypted) {
      const { decrypt } = await import('@/lib/crypto')
      dek = decrypt(existing.encryption_key_encrypted, kek)
    } else {
      dek = randomBytes(32).toString('hex')
      settingsUpdates.encryption_key_encrypted = encrypt(dek, kek)
    }
    settingsUpdates.google_client_secret_encrypted = encrypt(googleClientSecret.trim(), dek)
  }

  if (Object.keys(settingsUpdates).length > 0) {
    const { error } = await admin
      .from('fund_settings')
      .update(settingsUpdates)
      .eq('fund_id', membership.fund_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

// DELETE — delete all fund data
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { confirm } = await req.json()
  if (confirm !== 'DELETE ALL DATA') {
    return NextResponse.json({ error: 'Confirmation text does not match' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 404 })

  if (membership.role !== 'admin') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const fundId = membership.fund_id

  // Delete in dependency order
  await admin.from('parsing_reviews').delete().eq('fund_id', fundId)
  await admin.from('metric_values').delete().eq('fund_id', fundId)
  await admin.from('metrics').delete().eq('fund_id', fundId)
  await admin.from('inbound_emails').delete().eq('fund_id', fundId)
  await admin.from('companies').delete().eq('fund_id', fundId)
  await admin.from('authorized_senders').delete().eq('fund_id', fundId)
  await admin.from('fund_join_requests').delete().eq('fund_id', fundId)
  await admin.from('fund_settings').delete().eq('fund_id', fundId)
  await admin.from('fund_members').delete().eq('fund_id', fundId)
  await admin.from('funds').delete().eq('id', fundId)

  return NextResponse.json({ ok: true })
}
