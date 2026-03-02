import type { SupabaseClient } from '@supabase/supabase-js'

export interface EmailParams {
  to: string
  from?: string
  subject: string
  html: string
  cc?: string
}

export interface OutboundConfig {
  provider: 'resend' | 'postmark' | 'gmail' | 'mailgun'
  apiKey?: string       // resend or mailgun
  serverToken?: string  // postmark
  mailgunDomain?: string // mailgun sending domain
  // gmail uses admin + fundId
  admin?: SupabaseClient
  fundId?: string
}

async function sendViaResend(apiKey: string, params: EmailParams) {
  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  const result = await resend.emails.send({
    from: params.from || process.env.EMAIL_FROM || 'onboarding@resend.dev',
    to: params.to,
    cc: params.cc || undefined,
    subject: params.subject,
    html: params.html,
  })
  return { id: result.data?.id }
}

async function sendViaPostmark(serverToken: string, params: EmailParams) {
  const postmark = await import('postmark')
  const client = new postmark.ServerClient(serverToken)
  const result = await client.sendEmail({
    From: params.from || process.env.EMAIL_FROM || 'noreply@example.com',
    To: params.to,
    Cc: params.cc || undefined,
    Subject: params.subject,
    HtmlBody: params.html,
  })
  return { id: result.MessageID }
}

async function sendViaMailgun(apiKey: string, domain: string, params: EmailParams) {
  const FormData = (await import('form-data')).default
  const Mailgun = (await import('mailgun.js')).default
  const mailgun = new Mailgun(FormData)
  const mg = mailgun.client({ username: 'api', key: apiKey })
  const result = await mg.messages.create(domain, {
    from: params.from || process.env.EMAIL_FROM || `noreply@${domain}`,
    to: [params.to],
    cc: params.cc || undefined,
    subject: params.subject,
    html: params.html,
  })
  return { id: result.id }
}

async function sendViaGmail(admin: SupabaseClient, fundId: string, params: EmailParams) {
  const { decrypt } = await import('@/lib/crypto')
  const { getGoogleCredentials } = await import('@/lib/google/credentials')
  const { getAccessToken } = await import('@/lib/google/drive')
  const { sendEmail, getGmailProfile } = await import('@/lib/google/gmail')

  const { data: settings } = await admin
    .from('fund_settings')
    .select('google_refresh_token_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (!settings?.google_refresh_token_encrypted || !settings?.encryption_key_encrypted) {
    throw new Error('Google not connected')
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) throw new Error('ENCRYPTION_KEY not set')

  const dek = decrypt(settings.encryption_key_encrypted, kek)
  const refreshToken = decrypt(settings.google_refresh_token_encrypted, dek)
  const creds = await getGoogleCredentials(admin, fundId)
  if (!creds?.clientId || !creds?.clientSecret) {
    throw new Error('Google OAuth credentials not configured')
  }
  const accessToken = await getAccessToken(refreshToken, creds.clientId, creds.clientSecret)
  const senderEmail = await getGmailProfile(accessToken)

  const result = await sendEmail(accessToken, params.to, senderEmail, params.subject, params.html, params.cc)
  return { id: result.id }
}

/**
 * Send a single email using the given outbound config.
 * Throws on failure — callers decide how to handle errors.
 */
export async function sendOutboundEmail(config: OutboundConfig, params: EmailParams): Promise<{ id?: string }> {
  console.log(`[outbound-email] Sending via ${config.provider} to=${params.to} subject="${params.subject}"`)
  let result: { id?: string }

  if (config.provider === 'resend') {
    if (!config.apiKey) throw new Error('Resend API key not configured')
    result = await sendViaResend(config.apiKey, params)
  } else if (config.provider === 'postmark') {
    if (!config.serverToken) throw new Error('Postmark server token not configured')
    result = await sendViaPostmark(config.serverToken, params)
  } else if (config.provider === 'mailgun') {
    if (!config.apiKey) throw new Error('Mailgun API key not configured')
    if (!config.mailgunDomain) throw new Error('Mailgun sending domain not configured')
    result = await sendViaMailgun(config.apiKey, config.mailgunDomain, params)
  } else if (config.provider === 'gmail') {
    if (!config.admin || !config.fundId) throw new Error('Gmail requires admin client and fundId')
    result = await sendViaGmail(config.admin, config.fundId, params)
  } else {
    throw new Error(`Unknown provider: ${config.provider}`)
  }

  console.log(`[outbound-email] Sent successfully via ${config.provider} messageId=${result.id}`)
  return result
}

/**
 * Build an OutboundConfig from a fund's settings.
 * Returns null if no provider is configured.
 */
export async function getOutboundConfig(
  admin: SupabaseClient,
  fundId: string,
  purpose: 'system' | 'asks' = 'system',
): Promise<OutboundConfig | null> {
  const { data: settings, error: settingsError } = await admin
    .from('fund_settings')
    .select('outbound_email_provider, asks_email_provider, resend_api_key_encrypted, postmark_server_token_encrypted, mailgun_api_key_encrypted, mailgun_sending_domain, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (settingsError || !settings) {
    console.warn(`[outbound-email] No fund_settings found for fund ${fundId}`, settingsError?.message)
    return null
  }

  const selectedProvider = purpose === 'asks'
    ? settings.asks_email_provider
    : settings.outbound_email_provider

  if (!selectedProvider) {
    console.warn(`[outbound-email] No ${purpose} email provider set for fund ${fundId} (outbound_email_provider=${settings.outbound_email_provider}, asks_email_provider=${settings.asks_email_provider})`)
    return null
  }

  const provider = selectedProvider as 'resend' | 'postmark' | 'gmail' | 'mailgun'
  console.log(`[outbound-email] Using provider "${provider}" for purpose "${purpose}" (fund ${fundId})`)

  if (provider === 'gmail') {
    return { provider, admin, fundId }
  }

  // Decrypt the relevant secret
  if (!settings.encryption_key_encrypted) {
    console.warn(`[outbound-email] No encryption key for fund ${fundId}`)
    return null
  }
  const kek = process.env.ENCRYPTION_KEY
  if (!kek) {
    console.warn('[outbound-email] ENCRYPTION_KEY env var not set')
    return null
  }

  const { decrypt } = await import('@/lib/crypto')
  const dek = decrypt(settings.encryption_key_encrypted, kek)

  if (provider === 'resend') {
    if (!settings.resend_api_key_encrypted) {
      console.warn(`[outbound-email] Resend selected but no API key stored for fund ${fundId}`)
      return null
    }
    return { provider, apiKey: decrypt(settings.resend_api_key_encrypted, dek) }
  }

  if (provider === 'postmark') {
    if (!settings.postmark_server_token_encrypted) {
      console.warn(`[outbound-email] Postmark selected but no server token stored for fund ${fundId}`)
      return null
    }
    return { provider, serverToken: decrypt(settings.postmark_server_token_encrypted, dek) }
  }

  if (provider === 'mailgun') {
    if (!settings.mailgun_api_key_encrypted || !settings.mailgun_sending_domain) {
      console.warn(`[outbound-email] Mailgun selected but missing API key or domain for fund ${fundId}`)
      return null
    }
    return {
      provider,
      apiKey: decrypt(settings.mailgun_api_key_encrypted, dek),
      mailgunDomain: settings.mailgun_sending_domain,
    }
  }

  return null
}

/**
 * Send the approval notification email using the fund's configured outbound provider.
 * Fails silently — never throws.
 */
export const DEFAULT_APPROVAL_SUBJECT = "You've been approved to join {{fundName}}"
export const DEFAULT_APPROVAL_BODY = `<h2>Congrats!</h2>
<p>You've been approved to join <strong>{{fundName}}</strong>.</p>
<p><a href="{{siteUrl}}/auth">Sign in to get started</a></p>`

export async function sendApprovalEmail(
  admin: SupabaseClient,
  fundId: string,
  to: string,
  fundName: string,
) {
  try {
    const config = await getOutboundConfig(admin, fundId)
    if (!config) {
      console.warn('[approval-email] No system email provider configured for fund', fundId)
      return
    }

    const { data: settings } = await admin
      .from('fund_settings')
      .select('approval_email_subject, approval_email_body, system_email_from_name, system_email_from_address')
      .eq('fund_id', fundId)
      .single()

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const vars: Record<string, string> = { fundName, siteUrl }
    const interpolate = (template: string) =>
      template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '')

    const subject = interpolate(settings?.approval_email_subject || DEFAULT_APPROVAL_SUBJECT)
    const html = interpolate(settings?.approval_email_body || DEFAULT_APPROVAL_BODY)

    let from: string | undefined
    if (settings?.system_email_from_address) {
      from = settings.system_email_from_name
        ? `${settings.system_email_from_name} <${settings.system_email_from_address}>`
        : settings.system_email_from_address
    }

    console.log(`[approval-email] Sending to ${to} for fund "${fundName}" via ${config.provider}`)
    await sendOutboundEmail(config, { to, from, subject, html })
    console.log(`[approval-email] Sent successfully to ${to}`)
  } catch (error) {
    console.error(`[approval-email] Failed to send to ${to}:`, error)
  }
}
