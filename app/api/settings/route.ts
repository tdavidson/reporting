import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { encrypt } from '@/lib/crypto'
import { randomBytes } from 'crypto'
import { dbError } from '@/lib/api-error'

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
    admin.from('fund_settings').select('postmark_inbound_address, postmark_webhook_token, postmark_webhook_token_encrypted, encryption_key_encrypted, retain_resolved_reviews, resolved_reviews_ttl_days, claude_api_key_encrypted, claude_model, ai_summary_prompt, google_refresh_token_encrypted, google_drive_folder_id, google_drive_folder_name, google_client_id, google_client_secret_encrypted, outbound_email_provider, asks_email_provider, approval_email_subject, approval_email_body, system_email_from_name, system_email_from_address, resend_api_key_encrypted, postmark_server_token_encrypted, inbound_email_provider, mailgun_inbound_domain, mailgun_signing_key_encrypted, mailgun_api_key_encrypted, mailgun_sending_domain, file_storage_provider, dropbox_app_key, dropbox_app_secret_encrypted, dropbox_refresh_token_encrypted, dropbox_folder_path, openai_api_key_encrypted, openai_model, default_ai_provider').eq('fund_id', membership.fund_id).single(),
    admin.from('authorized_senders').select('id, email, label, created_at').eq('fund_id', membership.fund_id).order('email'),
  ])

  // Decrypt webhook token if encrypted; fall back to plaintext for legacy
  let webhookToken = ''
  if (membership.role === 'admin' && settings) {
    if (settings.postmark_webhook_token_encrypted && settings.encryption_key_encrypted) {
      try {
        const kek = process.env.ENCRYPTION_KEY
        if (kek) {
          const { decrypt } = await import('@/lib/crypto')
          const dek = decrypt(settings.encryption_key_encrypted, kek)
          webhookToken = decrypt(settings.postmark_webhook_token_encrypted, dek)
        }
      } catch {
        webhookToken = settings.postmark_webhook_token ?? ''
      }
    } else {
      webhookToken = settings.postmark_webhook_token ?? ''
    }
  }

  return NextResponse.json({
    fundId: fund?.id,
    fundName: fund?.name,
    fundLogo: fund?.logo_url ?? null,
    postmarkInboundAddress: settings?.postmark_inbound_address ?? '',
    postmarkWebhookToken: webhookToken,
    hasClaudeKey: !!settings?.claude_api_key_encrypted,
    claudeModel: settings?.claude_model ?? 'claude-sonnet-4-5',
    hasOpenAIKey: !!settings?.openai_api_key_encrypted,
    openaiModel: settings?.openai_model ?? 'gpt-4o',
    defaultAIProvider: settings?.default_ai_provider ?? 'anthropic',
    retainResolvedReviews: settings?.retain_resolved_reviews ?? true,
    resolvedReviewsTtlDays: settings?.resolved_reviews_ttl_days ?? null,
    senders: senders ?? [],
    googleDriveConnected: !!settings?.google_refresh_token_encrypted,
    googleDriveFolderId: settings?.google_drive_folder_id ?? null,
    googleDriveFolderName: settings?.google_drive_folder_name ?? null,
    hasGoogleCredentials: !!(settings?.google_client_id && settings?.google_client_secret_encrypted),
    googleClientId: settings?.google_client_id ?? '',
    aiSummaryPrompt: settings?.ai_summary_prompt ?? null,
    outboundEmailProvider: settings?.outbound_email_provider ?? null,
    asksEmailProvider: settings?.asks_email_provider ?? null,
    approvalEmailSubject: settings?.approval_email_subject ?? null,
    approvalEmailBody: settings?.approval_email_body ?? null,
    systemEmailFromName: settings?.system_email_from_name ?? null,
    systemEmailFromAddress: settings?.system_email_from_address ?? null,
    hasResendKey: !!settings?.resend_api_key_encrypted,
    hasPostmarkServerToken: !!settings?.postmark_server_token_encrypted,
    inboundEmailProvider: settings?.inbound_email_provider ?? null,
    mailgunInboundDomain: settings?.mailgun_inbound_domain ?? '',
    hasMailgunSigningKey: !!settings?.mailgun_signing_key_encrypted,
    hasMailgunApiKey: !!settings?.mailgun_api_key_encrypted,
    mailgunSendingDomain: settings?.mailgun_sending_domain ?? '',
    fileStorageProvider: settings?.file_storage_provider ?? null,
    dropboxConnected: !!settings?.dropbox_refresh_token_encrypted,
    hasDropboxCredentials: !!(settings?.dropbox_app_key && settings?.dropbox_app_secret_encrypted),
    dropboxAppKey: settings?.dropbox_app_key ?? '',
    dropboxFolderPath: settings?.dropbox_folder_path ?? null,
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

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 404 })

  const body = await req.json()
  const { fundName, fundLogo, postmarkInboundAddress, claudeApiKey, claudeModel, retainResolvedReviews, resolvedReviewsTtlDays, googleClientId, googleClientSecret, aiSummaryPrompt, displayName, outboundEmailProvider, asksEmailProvider, approvalEmailSubject, approvalEmailBody, systemEmailFromName, systemEmailFromAddress, resendApiKey, postmarkServerToken, inboundEmailProvider, mailgunInboundDomain, mailgunSigningKey, mailgunApiKey, mailgunSendingDomain, fileStorageProvider, dropboxAppKey, dropboxAppSecret, openaiApiKey, openaiModel, defaultAIProvider } = body

  // Update display name on fund_members (any user can do this)
  if (displayName !== undefined) {
    await admin.from('fund_members').update({ display_name: displayName?.trim() || null }).eq('fund_id', membership.fund_id).eq('user_id', user.id)
  }

  // All other settings require admin role
  const hasAdminFields = fundName !== undefined || fundLogo !== undefined || postmarkInboundAddress !== undefined ||
    claudeApiKey !== undefined || claudeModel !== undefined || retainResolvedReviews !== undefined ||
    resolvedReviewsTtlDays !== undefined || googleClientId !== undefined || googleClientSecret !== undefined ||
    aiSummaryPrompt !== undefined || outboundEmailProvider !== undefined || asksEmailProvider !== undefined ||
    approvalEmailSubject !== undefined || approvalEmailBody !== undefined ||
    systemEmailFromName !== undefined || systemEmailFromAddress !== undefined || resendApiKey !== undefined ||
    postmarkServerToken !== undefined || inboundEmailProvider !== undefined || mailgunInboundDomain !== undefined ||
    mailgunSigningKey !== undefined || mailgunApiKey !== undefined || mailgunSendingDomain !== undefined ||
    fileStorageProvider !== undefined || dropboxAppKey !== undefined || dropboxAppSecret !== undefined ||
    openaiApiKey !== undefined || openaiModel !== undefined || defaultAIProvider !== undefined

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

  // Update outbound email provider
  if (outboundEmailProvider !== undefined) {
    settingsUpdates.outbound_email_provider = outboundEmailProvider || null
  }

  // Update asks email provider
  if (asksEmailProvider !== undefined) {
    settingsUpdates.asks_email_provider = asksEmailProvider || null
  }

  // Update approval email template
  if (approvalEmailSubject !== undefined) {
    settingsUpdates.approval_email_subject = approvalEmailSubject?.trim() || null
  }
  if (approvalEmailBody !== undefined) {
    settingsUpdates.approval_email_body = approvalEmailBody?.trim() || null
  }

  // Update system email from name/address
  if (systemEmailFromName !== undefined) {
    settingsUpdates.system_email_from_name = systemEmailFromName?.trim() || null
  }
  if (systemEmailFromAddress !== undefined) {
    settingsUpdates.system_email_from_address = systemEmailFromAddress?.trim() || null
  }

  // Update Resend API key
  if (resendApiKey !== undefined && resendApiKey.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

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
    settingsUpdates.resend_api_key_encrypted = encrypt(resendApiKey.trim(), dek)
  }

  // Update Postmark server token
  if (postmarkServerToken !== undefined && postmarkServerToken.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

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
    settingsUpdates.postmark_server_token_encrypted = encrypt(postmarkServerToken.trim(), dek)
  }

  // Update inbound email provider
  if (inboundEmailProvider !== undefined) {
    settingsUpdates.inbound_email_provider = inboundEmailProvider || null
  }

  // Update Mailgun inbound domain
  if (mailgunInboundDomain !== undefined) {
    settingsUpdates.mailgun_inbound_domain = mailgunInboundDomain?.trim() || null
  }

  // Update Mailgun sending domain
  if (mailgunSendingDomain !== undefined) {
    settingsUpdates.mailgun_sending_domain = mailgunSendingDomain?.trim() || null
  }

  // Update Mailgun signing key (encrypted)
  if (mailgunSigningKey !== undefined && mailgunSigningKey.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

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
    settingsUpdates.mailgun_signing_key_encrypted = encrypt(mailgunSigningKey.trim(), dek)
  }

  // Update Mailgun API key (encrypted)
  if (mailgunApiKey !== undefined && mailgunApiKey.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

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
    settingsUpdates.mailgun_api_key_encrypted = encrypt(mailgunApiKey.trim(), dek)
  }

  // Update file storage provider
  if (fileStorageProvider !== undefined) {
    settingsUpdates.file_storage_provider = fileStorageProvider || null
  }

  // Update Dropbox app key
  if (dropboxAppKey !== undefined) {
    settingsUpdates.dropbox_app_key = dropboxAppKey?.trim() || null
  }

  // Update Dropbox app secret (encrypted)
  if (dropboxAppSecret !== undefined && dropboxAppSecret.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

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
    settingsUpdates.dropbox_app_secret_encrypted = encrypt(dropboxAppSecret.trim(), dek)
  }

  // Update OpenAI API key with envelope encryption
  if (openaiApiKey !== undefined && openaiApiKey.trim()) {
    const kek = process.env.ENCRYPTION_KEY
    if (!kek) return NextResponse.json({ error: 'Server misconfiguration: ENCRYPTION_KEY not set' }, { status: 500 })

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
    settingsUpdates.openai_api_key_encrypted = encrypt(openaiApiKey.trim(), dek)
  }

  // Update OpenAI model
  if (openaiModel !== undefined) {
    settingsUpdates.openai_model = openaiModel.trim() || 'gpt-4o'
  }

  // Update default AI provider
  if (defaultAIProvider !== undefined) {
    if (defaultAIProvider !== 'anthropic' && defaultAIProvider !== 'openai') {
      return NextResponse.json({ error: 'Invalid AI provider. Must be "anthropic" or "openai".' }, { status: 400 })
    }
    settingsUpdates.default_ai_provider = defaultAIProvider
  }

  if (Object.keys(settingsUpdates).length > 0) {
    const { error } = await admin
      .from('fund_settings')
      .update(settingsUpdates)
      .eq('fund_id', membership.fund_id)

    if (error) return dbError(error, 'settings')
  }

  return NextResponse.json({ ok: true })
}

// DELETE — delete all fund data
export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

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
