import { createAdminClient } from '@/lib/supabase/admin'
import {
  extractAttachmentText,
  type ExtractionResult,
} from '@/lib/parsing/extractAttachmentText'
import { identifyCompany, type CompanyRef } from '@/lib/claude/identifyCompany'
import {
  extractMetrics,
  type MetricDef,
  type ExtractMetricsResult,
} from '@/lib/claude/extractMetrics'
import { createFundAIProvider } from '@/lib/ai'
import { decryptApiKey, decrypt } from '@/lib/crypto'
import { getAccessToken as getGoogleAccessToken, findOrCreateFolder as findOrCreateGoogleFolder, uploadFile as uploadGoogleFile } from '@/lib/google/drive'
import { getGoogleCredentials } from '@/lib/google/credentials'
import { getDropboxCredentials } from '@/lib/dropbox/credentials'
import { getAccessToken as getDropboxAccessToken, findOrCreateFolder as findOrCreateDropboxFolder, uploadFile as uploadDropboxFile } from '@/lib/dropbox/files'
import { extractInteraction } from '@/lib/claude/extractInteraction'
import { classifyEmail, detectForward, type SenderFlags, type AttachmentDescriptor } from '@/lib/pipeline/classifyEmail'
import { isAuthorizedSender } from '@/lib/pipeline/isAuthorizedSender'
import type { Json, IssueType, ProcessingStatus } from '@/lib/types/database'

type Supabase = ReturnType<typeof createAdminClient>

// ---------------------------------------------------------------------------
// Postmark inbound payload shape (fields we use)
// ---------------------------------------------------------------------------

export interface PostmarkPayload {
  From: string
  FromFull?: { Email: string; Name: string }
  To: string
  OriginalRecipient?: string
  Date?: string
  Subject?: string
  TextBody?: string
  HtmlBody?: string
  MessageID?: string
  Attachments?: Array<{
    Name: string
    ContentType: string
    Content?: string
    ContentLength: number
    StoragePath?: string
  }>
}

// ---------------------------------------------------------------------------
// Main pipeline — runs steps 4-8 for a given email record
// ---------------------------------------------------------------------------

export async function runPipeline(
  supabase: Supabase,
  emailId: string,
  fundId: string,
  payload: PostmarkPayload,
  fundMember?: { userId: string } | null
): Promise<void> {
  const warnings: string[] = []

  // Step 4: Extract text from email body and attachments
  const extracted = await extractAttachmentText(payload)

  // Fetch the fund's AI provider based on default_ai_provider setting
  const { provider, model, providerType } = await createFundAIProvider(supabase, fundId)

  // Step 4.5: Routing classifier. Settings determine whether the result is
  // acted on (active routing) or merely recorded (shadow mode — when
  // deal_intake_enabled is false). A classifier failure must never break the
  // existing reporting/interactions pipeline; on error we fall through.
  const dealsSettings = await loadDealsSettings(supabase, fundId)
  let routingDecision: RoutingDecision = 'shadow'
  let classification: ClassificationResultStored | null = null
  try {
    classification = await classifyAndStore(
      supabase, emailId, fundId, payload, extracted.emailBody, fundMember,
      provider, providerType, model, dealsSettings.routing_model
    )
    if (classification) {
      routingDecision = decideRoute(classification, dealsSettings)
    }
  } catch (err) {
    console.error('[pipeline] Classifier failed (non-blocking):', err)
  }

  // Branch on classifier decision when intake is enabled.
  if (routingDecision === 'deals') {
    try {
      const { processDeal } = await import('@/lib/pipeline/processDeal')
      await processDeal({ supabase, emailId, fundId, payload, extracted, provider, providerType, model })
      await supabase.from('inbound_emails').update({ routed_to: 'deals' }).eq('id', emailId)
      await finalizeEmail(supabase, emailId, { status: 'success' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[pipeline] processDeal failed:', err)
      await finalizeEmail(supabase, emailId, { status: 'failed', warnings: [msg] })
    }
    return
  }

  if (routingDecision === 'audit') {
    await supabase.from('inbound_emails').update({ routed_to: 'audit' }).eq('id', emailId)
    await finalizeEmail(supabase, emailId, { status: 'not_processed' })
    return
  }

  if (routingDecision === 'review') {
    await createReview(supabase, {
      fund_id: fundId,
      email_id: emailId,
      issue_type: 'routing_low_confidence',
      context_snippet: classification
        ? `Classifier: ${classification.label} @ ${classification.confidence.toFixed(2)} (secondary: ${classification.secondary_label ?? 'none'}). ${classification.reasoning}`
        : '',
    })
    await supabase.from('inbound_emails').update({ routed_to: 'review' }).eq('id', emailId)
    await finalizeEmail(supabase, emailId, { status: 'needs_review' })
    return
  }

  // Shadow mode OR explicit reporting/interactions decision → existing flow.
  // Persist routed_to so /emails UI can show the active destination.
  const fallbackRouted = routingDecision === 'shadow' ? 'reporting' : routingDecision
  await supabase.from('inbound_emails').update({ routed_to: fallbackRouted }).eq('id', emailId)

  // Step 5: Identify the company (skip if already assigned, e.g. from manual assignment)
  const { data: existingEmail } = await supabase
    .from('inbound_emails')
    .select('company_id')
    .eq('id', emailId)
    .single()

  const companies = await getCompanies(supabase, fundId)
  let companyId: string | null = (existingEmail as any)?.company_id ?? null
  let companyName = ''

  let companyIdentified = true

  if (companyId) {
    // Company already assigned — skip identification
    companyName = companies.find(c => c.id === companyId)?.name ?? ''
  } else {
    const identification = await identifyCompany(
      payload.Subject ?? '',
      extracted.emailBody,
      companies,
      provider,
      providerType,
      model,
      { admin: supabase, fundId }
    )

    if (identification.new_company_name) {
      await createReview(supabase, {
        fund_id: fundId,
        email_id: emailId,
        issue_type: 'new_company_detected',
        extracted_value: identification.new_company_name,
        context_snippet: identification.reasoning,
      })
      companyIdentified = false
    } else if (!identification.company_id) {
      await createReview(supabase, {
        fund_id: fundId,
        email_id: emailId,
        issue_type: 'company_not_identified',
        context_snippet: identification.reasoning,
      })
      companyIdentified = false
    } else {
      companyId = identification.company_id
      companyName = companies.find(c => c.id === companyId)?.name ?? ''

      await supabase
        .from('inbound_emails')
        .update({ company_id: companyId })
        .eq('id', emailId)
    }
  }

  // If company wasn't identified, finalize early but still try interaction extraction for fund members
  if (!companyIdentified) {
    await finalizeEmail(supabase, emailId, { status: 'needs_review' })
    if (fundMember) {
      try {
        await maybeExtractInteraction(supabase, fundId, emailId, companyId, fundMember.userId, payload, extracted.emailBody, provider, providerType, model)
      } catch (err) {
        console.error('[pipeline] Interaction extraction failed (non-blocking):', err)
      }
    }
    return
  }

  // Step 6: Extract metrics
  const metrics = await getMetrics(supabase, companyId!)

  if (metrics.length === 0) {
    // Still save to file storage even when no metrics are defined
    try {
      await Promise.race([
        saveToFileStorage(supabase, fundId, companyName, payload),
        new Promise((_, reject) => setTimeout(() => reject(new Error('File storage save timed out after 15s')), 15_000)),
      ])
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      console.error('[pipeline] File storage save failed (non-blocking):', msg)
      warnings.push(describeStorageError(msg))
    }
    await finalizeEmail(supabase, emailId, { status: 'not_processed', metricsExtracted: 0, warnings })
    if (fundMember) {
      try {
        await maybeExtractInteraction(supabase, fundId, emailId, companyId, fundMember.userId, payload, extracted.emailBody, provider, providerType, model)
      } catch (err) {
        console.error('[pipeline] Interaction extraction failed (non-blocking):', err)
      }
    }
    return
  }

  const combinedText = buildCombinedText(extracted, payload)

  const pdfBase64s = extracted.attachments
    .filter(a => !a.skipped && a.base64Content && isPdf(a.contentType))
    .map(a => a.base64Content!)

  const images = extracted.attachments
    .filter(a => !a.skipped && a.base64Content && isImage(a.contentType))
    .map(a => ({ data: a.base64Content!, mediaType: a.contentType }))

  const metricsResult = await extractMetrics(
    companyName,
    combinedText,
    metrics,
    pdfBase64s,
    images,
    provider,
    providerType,
    model,
    { admin: supabase, fundId }
  )

  // Store the raw Claude response
  await supabase
    .from('inbound_emails')
    .update({ claude_response: metricsResult as unknown as Json })
    .eq('id', emailId)

  // Step 7: Write results
  const { reviewCount, writtenCount } = await writeResults(
    supabase,
    emailId,
    fundId,
    companyId!,
    metricsResult,
    metrics
  )

  // Step 8-9: Save to file storage then finalize
  try {
    await Promise.race([
      saveToFileStorage(supabase, fundId, companyName, payload),
      new Promise((_, reject) => setTimeout(() => reject(new Error('File storage save timed out after 15s')), 15_000)),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    console.error('[pipeline] File storage save failed (non-blocking):', msg)
    warnings.push(describeStorageError(msg))
  }

  const status: ProcessingStatus = reviewCount > 0 ? 'needs_review' : writtenCount > 0 ? 'success' : 'not_processed'
  await finalizeEmail(supabase, emailId, { status, metricsExtracted: writtenCount, warnings })

  // Step 10: Extract interaction (fund member emails only)
  if (fundMember) {
    try {
      await maybeExtractInteraction(supabase, fundId, emailId, companyId, fundMember.userId, payload, extracted.emailBody, provider, providerType, model)
    } catch (err) {
      console.error('[pipeline] Interaction extraction failed (non-blocking):', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Result writer (Step 7)
// ---------------------------------------------------------------------------

export async function writeResults(
  supabase: Supabase,
  emailId: string,
  fundId: string,
  companyId: string,
  result: ExtractMetricsResult,
  metricDefs: MetricDef[]
): Promise<{ reviewCount: number; writtenCount: number }> {
  let reviewCount = 0
  let writtenCount = 0

  const { reporting_period, metrics, unextracted_metrics } = result

  // If the period itself is low-confidence, flag everything and write nothing
  if (reporting_period.confidence === 'low') {
    for (const m of metrics) {
      await createReview(supabase, {
        fund_id: fundId,
        email_id: emailId,
        metric_id: m.metric_id,
        company_id: companyId,
        issue_type: 'ambiguous_period',
        extracted_value: String(m.value),
        context_snippet: `Period label: "${reporting_period.label}" (low confidence)`,
      })
      reviewCount++
    }
    for (const m of unextracted_metrics) {
      await createReview(supabase, {
        fund_id: fundId,
        email_id: emailId,
        metric_id: m.metric_id,
        company_id: companyId,
        issue_type: 'metric_not_found',
        context_snippet: m.reason,
      })
      reviewCount++
    }
    return { reviewCount, writtenCount }
  }

  // Write extracted metrics
  for (const m of metrics) {
    const def = metricDefs.find(d => d.id === m.metric_id)
    if (!def) continue

    const isDuplicate = await checkDuplicatePeriod(supabase, m.metric_id, reporting_period)
    if (isDuplicate) {
      await createReview(supabase, {
        fund_id: fundId,
        email_id: emailId,
        metric_id: m.metric_id,
        company_id: companyId,
        issue_type: 'duplicate_period',
        extracted_value: String(m.value),
        context_snippet: `Period: ${reporting_period.label}`,
      })
      reviewCount++
      continue
    }

    const valueFields = parseValue(m.value, def.value_type)

    const { error } = await supabase.from('metric_values').insert({
      metric_id: m.metric_id,
      company_id: companyId,
      fund_id: fundId,
      period_label: reporting_period.label,
      period_year: reporting_period.year,
      period_quarter: reporting_period.quarter ?? null,
      period_month: reporting_period.month ?? null,
      confidence: m.confidence,
      source_email_id: emailId,
      notes: m.notes,
      is_manually_entered: false,
      ...valueFields,
    })

    if (error) {
      // Unique constraint violation = duplicate period, skip silently
      if (error.code === '23505') {
        console.log(`[pipeline] Skipped duplicate metric_value for ${m.metric_id} period ${reporting_period.label}`)
        continue
      }
      console.error(`[pipeline] Failed to insert metric_value for ${m.metric_id}:`, error)
      continue
    }

    writtenCount++

    if (m.confidence === 'low') {
      await createReview(supabase, {
        fund_id: fundId,
        email_id: emailId,
        metric_id: m.metric_id,
        company_id: companyId,
        issue_type: 'low_confidence',
        extracted_value: String(m.value),
        context_snippet: m.notes,
      })
      reviewCount++
    }
  }

  // Flag unextracted metrics
  for (const m of unextracted_metrics) {
    await createReview(supabase, {
      fund_id: fundId,
      email_id: emailId,
      metric_id: m.metric_id,
      company_id: companyId,
      issue_type: 'metric_not_found',
      context_snippet: m.reason,
    })
    reviewCount++
  }

  return { reviewCount, writtenCount }
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

export async function getClaudeApiKey(supabase: Supabase, fundId: string): Promise<string> {
  const { data, error } = await supabase
    .from('fund_settings')
    .select('claude_api_key_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (error || !data?.claude_api_key_encrypted || !data?.encryption_key_encrypted) {
    throw new Error(`Claude API key not configured for fund ${fundId}`)
  }

  return decryptApiKey(data.claude_api_key_encrypted, data.encryption_key_encrypted)
}

export async function getClaudeModel(supabase: Supabase, fundId: string): Promise<string> {
  const { data } = await supabase
    .from('fund_settings')
    .select('claude_model')
    .eq('fund_id', fundId)
    .single()

  return data?.claude_model || 'claude-sonnet-4-5'
}

export async function getOpenAIApiKey(supabase: Supabase, fundId: string): Promise<string> {
  const { data, error } = await supabase
    .from('fund_settings')
    .select('openai_api_key_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (error || !data?.openai_api_key_encrypted || !data?.encryption_key_encrypted) {
    throw new Error(`OpenAI API key not configured for fund ${fundId}`)
  }

  return decryptApiKey(data.openai_api_key_encrypted, data.encryption_key_encrypted)
}

export async function getOpenAIModel(supabase: Supabase, fundId: string): Promise<string> {
  const { data } = await supabase
    .from('fund_settings')
    .select('openai_model')
    .eq('fund_id', fundId)
    .single()

  return data?.openai_model || 'gpt-4o'
}

export async function getDefaultAIProvider(supabase: Supabase, fundId: string): Promise<'anthropic' | 'openai' | 'gemini' | 'ollama'> {
  const { data } = await supabase
    .from('fund_settings')
    .select('default_ai_provider')
    .eq('fund_id', fundId)
    .single()

  const provider = data?.default_ai_provider
  if (provider === 'openai' || provider === 'gemini' || provider === 'ollama') return provider
  return 'anthropic'
}

export async function getGeminiApiKey(supabase: Supabase, fundId: string): Promise<string> {
  const { data, error } = await supabase
    .from('fund_settings')
    .select('gemini_api_key_encrypted, encryption_key_encrypted')
    .eq('fund_id', fundId)
    .single()

  if (error || !data?.gemini_api_key_encrypted || !data?.encryption_key_encrypted) {
    throw new Error(`Gemini API key not configured for fund ${fundId}`)
  }

  return decryptApiKey(data.gemini_api_key_encrypted, data.encryption_key_encrypted)
}

export async function getGeminiModel(supabase: Supabase, fundId: string): Promise<string> {
  const { data } = await supabase
    .from('fund_settings')
    .select('gemini_model')
    .eq('fund_id', fundId)
    .single()

  return data?.gemini_model || 'gemini-2.0-flash'
}

export async function getOllamaConfig(supabase: Supabase, fundId: string): Promise<{ baseUrl: string; model: string }> {
  const { data } = await supabase
    .from('fund_settings')
    .select('ollama_base_url, ollama_model')
    .eq('fund_id', fundId)
    .single()

  return {
    baseUrl: data?.ollama_base_url || 'http://localhost:11434/v1',
    model: data?.ollama_model || 'llama3.2',
  }
}

export async function getCompanies(supabase: Supabase, fundId: string): Promise<CompanyRef[]> {
  const { data } = await supabase
    .from('companies')
    .select('id, name, aliases')
    .eq('fund_id', fundId)
    .eq('status', 'active')

  return data ?? []
}

export async function getMetrics(supabase: Supabase, companyId: string): Promise<MetricDef[]> {
  const { data } = await supabase
    .from('metrics')
    .select('id, name, slug, description, unit, value_type')
    .eq('company_id', companyId)
    .eq('is_active', true)
    .order('display_order')

  return (data ?? []) as MetricDef[]
}

async function checkDuplicatePeriod(
  supabase: Supabase,
  metricId: string,
  period: ExtractMetricsResult['reporting_period']
): Promise<boolean> {
  let query = supabase
    .from('metric_values')
    .select('id')
    .eq('metric_id', metricId)
    .eq('period_year', period.year)

  if (period.quarter !== null && period.quarter !== undefined) {
    query = query.eq('period_quarter', period.quarter)
  } else {
    query = query.is('period_quarter', null)
  }

  if (period.month !== null && period.month !== undefined) {
    query = query.eq('period_month', period.month)
  } else {
    query = query.is('period_month', null)
  }

  const { data } = await query.maybeSingle()
  return !!data
}

export async function createReview(
  supabase: Supabase,
  review: {
    fund_id: string
    email_id: string
    metric_id?: string
    company_id?: string
    issue_type: IssueType
    extracted_value?: string
    context_snippet?: string
  }
) {
  const { error } = await supabase.from('parsing_reviews').insert(review)
  if (error) console.error('[pipeline] Failed to create review:', error)
}

export async function finalizeEmail(
  supabase: Supabase,
  emailId: string,
  opts: { status: ProcessingStatus; metricsExtracted?: number; warnings?: string[] }
) {
  const update: Record<string, unknown> = {
    processing_status: opts.status,
    processing_error: opts.warnings?.length ? opts.warnings.join('; ') : null,
    metrics_extracted: opts.metricsExtracted ?? 0,
  }
  await supabase
    .from('inbound_emails')
    .update(update)
    .eq('id', emailId)
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function buildCombinedText(extracted: ExtractionResult, payload?: PostmarkPayload): string {
  const parts: string[] = []

  // Include email metadata so the AI has subject/sender/date context
  if (payload) {
    const metaParts: string[] = []
    if (payload.Subject) metaParts.push(`Subject: ${payload.Subject}`)
    if (payload.FromFull?.Name) metaParts.push(`From: ${payload.FromFull.Name} <${payload.FromFull.Email}>`)
    else if (payload.From) metaParts.push(`From: ${payload.From}`)
    if (payload.Date) metaParts.push(`Date: ${payload.Date}`)
    if (metaParts.length) parts.push(`[EMAIL METADATA]\n${metaParts.join('\n')}`)
  }

  parts.push(`[EMAIL BODY]\n${extracted.emailBody}`)
  for (const att of extracted.attachments) {
    if (!att.skipped && att.extractedText) {
      parts.push(`[ATTACHMENT: ${att.filename}]\n${att.extractedText}`)
    }
  }
  return parts.join('\n\n')
}

function describeStorageError(msg: string): string {
  if (msg.includes('Failed to refresh Google token') || msg.includes('invalid_grant')) {
    return 'File storage skipped: Google Drive connection expired. Reconnect in Settings > Google credentials.'
  }
  if (msg.includes('timed out')) {
    return 'File storage skipped: connection timed out. Check your storage provider in Settings.'
  }
  if (msg.includes('Dropbox')) {
    return 'File storage skipped: Dropbox connection failed. Reconnect in Settings.'
  }
  return `File storage skipped: ${msg}`
}

export function parseValue(
  value: number | string,
  valueType: string
): { value_number?: number; value_text?: string } {
  if (valueType === 'text') return { value_text: String(value) }
  const num =
    typeof value === 'number'
      ? value
      : parseFloat(String(value).replace(/[^0-9.-]/g, ''))
  if (isNaN(num)) return { value_text: String(value) }
  return { value_number: num }
}

function isPdf(contentType: string): boolean {
  return contentType === 'application/pdf'
}

function isImage(contentType: string): boolean {
  return contentType.startsWith('image/')
}

// ---------------------------------------------------------------------------
// Interaction extraction (Step 10 — fund member emails only)
// ---------------------------------------------------------------------------

async function maybeExtractInteraction(
  supabase: Supabase,
  fundId: string,
  emailId: string,
  companyId: string | null,
  userId: string,
  payload: PostmarkPayload,
  bodyText: string,
  provider: import('@/lib/ai/types').AIProvider,
  providerType: string,
  model: string
): Promise<void> {
  // Check feature visibility
  const { data: fSettings } = await supabase
    .from('fund_settings')
    .select('feature_visibility')
    .eq('fund_id', fundId)
    .maybeSingle()
  const fv = fSettings?.feature_visibility as Record<string, string> | null
  if (fv?.interactions === 'off') return

  const senderName = payload.FromFull?.Name || payload.From || ''
  const interaction = await extractInteraction(
    payload.Subject ?? '',
    bodyText,
    senderName,
    provider,
    providerType,
    model,
    { admin: supabase, fundId }
  )

  // Skip interaction creation for reporting emails — metrics already handled above
  if (interaction.is_reporting) return

  await supabase.from('interactions').insert({
    fund_id: fundId,
    company_id: companyId,
    email_id: emailId,
    user_id: userId,
    tags: interaction.tags,
    subject: payload.Subject ?? null,
    summary: interaction.summary,
    intro_contacts: interaction.intro_contacts as unknown as Json,
    body_preview: bodyText.slice(0, 500),
    interaction_date: new Date().toISOString(),
  })
}

// ---------------------------------------------------------------------------
// File storage integration (Step 9)
// ---------------------------------------------------------------------------

async function saveToFileStorage(
  supabase: Supabase,
  fundId: string,
  companyName: string,
  payload: PostmarkPayload
): Promise<void> {
  const { data: settings } = await supabase
    .from('fund_settings')
    .select('file_storage_provider, google_refresh_token_encrypted, encryption_key_encrypted, google_drive_folder_id, dropbox_refresh_token_encrypted, dropbox_folder_path')
    .eq('fund_id', fundId)
    .single()

  if (!settings?.file_storage_provider) return

  if (settings.file_storage_provider === 'google_drive') {
    await saveToGoogleDrive(supabase, fundId, companyName, payload, settings)
  } else if (settings.file_storage_provider === 'dropbox') {
    await saveToDropbox(supabase, fundId, companyName, payload, settings)
  }
}

async function saveToGoogleDrive(
  supabase: Supabase,
  fundId: string,
  companyName: string,
  payload: PostmarkPayload,
  settings: { google_refresh_token_encrypted: string | null; encryption_key_encrypted: string | null; google_drive_folder_id: string | null }
): Promise<void> {
  if (
    !settings.google_refresh_token_encrypted ||
    !settings.encryption_key_encrypted ||
    !settings.google_drive_folder_id
  ) {
    return
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return

  const dek = decrypt(settings.encryption_key_encrypted, kek)
  const refreshToken = decrypt(settings.google_refresh_token_encrypted, dek)

  const creds = await getGoogleCredentials(supabase, fundId)
  if (!creds?.clientId || !creds?.clientSecret) return
  const accessToken = await getGoogleAccessToken(refreshToken, creds.clientId, creds.clientSecret)
  const rootFolderId = settings.google_drive_folder_id

  const companyFolderId = await findOrCreateGoogleFolder(accessToken, rootFolderId, companyName)

  const dateStr = new Date().toISOString().slice(0, 10)
  const subject = payload.Subject?.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 60) || 'Report'
  const emailFilename = `${dateStr}_${subject}.txt`

  const emailBody = payload.TextBody || payload.HtmlBody || '(no body)'
  await uploadGoogleFile(accessToken, companyFolderId, emailFilename, emailBody, 'text/plain')

  if (payload.Attachments?.length) {
    for (const att of payload.Attachments) {
      if (!att.Content) continue
      const safeName = att.Name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_')
      const content = Buffer.from(att.Content, 'base64')
      await uploadGoogleFile(accessToken, companyFolderId, safeName, content, att.ContentType)
    }
  }
}

async function saveToDropbox(
  supabase: Supabase,
  fundId: string,
  companyName: string,
  payload: PostmarkPayload,
  settings: { dropbox_refresh_token_encrypted: string | null; encryption_key_encrypted: string | null; dropbox_folder_path: string | null }
): Promise<void> {
  if (
    !settings.dropbox_refresh_token_encrypted ||
    !settings.encryption_key_encrypted ||
    !settings.dropbox_folder_path
  ) {
    return
  }

  const kek = process.env.ENCRYPTION_KEY
  if (!kek) return

  const dek = decrypt(settings.encryption_key_encrypted, kek)
  const refreshToken = decrypt(settings.dropbox_refresh_token_encrypted, dek)

  const creds = await getDropboxCredentials(supabase, fundId)
  if (!creds) return

  const accessToken = await getDropboxAccessToken(refreshToken, creds.appKey, creds.appSecret)
  const rootPath = settings.dropbox_folder_path

  // Create company subfolder (sanitize name to prevent path traversal)
  const safeCompanyName = companyName.replace(/[\/\\:*?"<>|.]/g, '_').replace(/^_+/, '').slice(0, 100) || 'Unknown'
  const companyPath = `${rootPath}/${safeCompanyName}`
  await findOrCreateDropboxFolder(accessToken, companyPath)

  const dateStr = new Date().toISOString().slice(0, 10)
  const subject = payload.Subject?.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 60) || 'Report'
  const emailFilename = `${dateStr}_${subject}.txt`

  const emailBody = payload.TextBody || payload.HtmlBody || '(no body)'
  await uploadDropboxFile(accessToken, companyPath, emailFilename, emailBody)

  if (payload.Attachments?.length) {
    for (const att of payload.Attachments) {
      if (!att.Content) continue
      const safeName = att.Name.replace(/[\/\\:*?"<>|]/g, '_').replace(/\.\./g, '_')
      const content = Buffer.from(att.Content, 'base64')
      await uploadDropboxFile(accessToken, companyPath, safeName, content)
    }
  }
}

// ---------------------------------------------------------------------------
// Routing classifier (Step 4.5)
// ---------------------------------------------------------------------------

export type RoutingDecision = 'deals' | 'audit' | 'review' | 'reporting' | 'interactions' | 'shadow'

export interface ClassificationResultStored {
  label: 'reporting' | 'interactions' | 'deals' | 'other'
  confidence: number
  reasoning: string
  secondary_label: 'reporting' | 'interactions' | 'deals' | 'other' | null
}

interface DealsSettings {
  deal_intake_enabled: boolean
  routing_confidence_threshold: number | null
  routing_model: string | null
}

async function loadDealsSettings(supabase: Supabase, fundId: string): Promise<DealsSettings> {
  const { data } = await supabase
    .from('fund_settings')
    .select('deal_intake_enabled, routing_confidence_threshold, routing_model')
    .eq('fund_id', fundId)
    .maybeSingle()
  const row = data as { deal_intake_enabled: boolean | null; routing_confidence_threshold: number | null; routing_model: string | null } | null
  return {
    deal_intake_enabled: row?.deal_intake_enabled ?? false,
    routing_confidence_threshold: row?.routing_confidence_threshold ?? null,
    routing_model: row?.routing_model ?? null,
  }
}

/**
 * Translate a classifier result + settings into a routing decision.
 *   shadow       → intake disabled; existing pipeline runs unchanged
 *   review       → confidence below threshold; queue for human resolution
 *   audit        → label 'other'; recorded but no pipeline runs
 *   deals        → run processDeal
 *   reporting    → existing flow runs (label confirms reporting)
 *   interactions → existing flow runs (label is interactions)
 */
function decideRoute(c: ClassificationResultStored, s: DealsSettings): RoutingDecision {
  if (!s.deal_intake_enabled) return 'shadow'

  const threshold = s.routing_confidence_threshold ?? 0
  if (c.confidence < threshold) return 'review'

  if (c.label === 'other') return 'audit'
  if (c.label === 'deals') return 'deals'
  return c.label // 'reporting' | 'interactions'
}

async function classifyAndStore(
  supabase: Supabase,
  emailId: string,
  fundId: string,
  payload: PostmarkPayload,
  emailBody: string,
  fundMember: { userId: string } | null | undefined,
  provider: import('@/lib/ai/types').AIProvider,
  providerType: string,
  defaultModel: string,
  routingModelOverride: string | null
): Promise<ClassificationResultStored | null> {
  const senderEmail = (payload.FromFull?.Email ?? payload.From ?? '').trim().toLowerCase()
  if (!senderEmail) return null

  const fwd = detectForward(emailBody || '')

  const [authorizedSender, knownReferrer, fwdAuthorized] = await Promise.all([
    fundMember ? Promise.resolve(false) : isAuthorizedSender(supabase, fundId, senderEmail),
    isKnownReferrer(supabase, fundId, senderEmail),
    fwd.forwarded_from_email
      ? isAuthorizedSender(supabase, fundId, fwd.forwarded_from_email)
      : Promise.resolve(false),
  ])

  const flags: SenderFlags = {
    is_fund_member: !!fundMember,
    is_authorized_sender: authorizedSender,
    is_known_referrer: knownReferrer,
    is_forward: fwd.is_forward,
    forwarded_from_email: fwd.forwarded_from_email,
    forwarded_from_is_authorized_sender: fwdAuthorized,
  }

  const attachments: AttachmentDescriptor[] = (payload.Attachments ?? []).map(a => ({
    name: a.Name,
    contentType: a.ContentType,
    sizeBytes: a.ContentLength ?? 0,
  }))

  const result = await classifyEmail(
    {
      subject: payload.Subject ?? '',
      body: emailBody || '',
      attachments,
      flags,
    },
    provider,
    providerType,
    routingModelOverride ?? defaultModel,
    { admin: supabase, fundId }
  )

  await supabase
    .from('inbound_emails')
    .update({
      routing_label: result.label,
      routing_confidence: result.confidence,
      routing_reasoning: result.reasoning,
      routing_secondary_label: result.secondary_label,
    })
    .eq('id', emailId)

  return result
}

async function isKnownReferrer(supabase: Supabase, fundId: string, email: string): Promise<boolean> {
  const { data } = await supabase
    .from('known_referrers')
    .select('id')
    .eq('fund_id', fundId)
    .eq('email', email)
    .maybeSingle()
  return !!data
}
