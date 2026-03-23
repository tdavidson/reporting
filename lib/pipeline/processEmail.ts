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
import type { Json, IssueType, ProcessingStatus } from '@/lib/types/database'

type Supabase = ReturnType<typeof createAdminClient>

export interface PostmarkPayload {
  From: string
  FromFull?: { Email: string; Name: string }
  To: string
  OriginalRecipient?: string
  Date?: string
  Subject?: string
  TextBody?: string
  HtmlBody?: string
  Attachments?: Array<{
    Name: string
    ContentType: string
    Content?: string
    ContentLength: number
    StoragePath?: string
  }>
}

// ---------------------------------------------------------------------------
// Main pipeline
// ---------------------------------------------------------------------------

export async function runPipeline(
  supabase: Supabase,
  emailId: string,
  fundId: string,
  payload: PostmarkPayload,
  fundMember?: { userId: string } | null
): Promise<void> {
  const extracted = await extractAttachmentText(payload)
  const { provider, model, providerType } = await createFundAIProvider(supabase, fundId)

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

  const metrics = await getMetrics(supabase, companyId!)

  if (metrics.length === 0) {
    await finalizeEmail(supabase, emailId, { status: 'not_processed', metricsExtracted: 0 })
    try {
      await saveToFileStorage(supabase, fundId, companyName, payload)
    } catch (err) {
      console.error('[pipeline] File storage save failed (non-blocking):', err)
    }
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

  // Buscar períodos já existentes antes de chamar a AI
  const existingPeriodLabels = await getExistingPeriodLabels(supabase, metrics.map(m => m.id))

  const metricsResult = await extractMetrics(
    companyName,
    combinedText,
    metrics,
    pdfBase64s,
    images,
    provider,
    providerType,
    model,
    existingPeriodLabels,
    { admin: supabase, fundId }
  )

  await supabase
    .from('inbound_emails')
    .update({ claude_response: metricsResult as unknown as Json })
    .eq('id', emailId)

  const { reviewCount, writtenCount } = await writeResults(
    supabase,
    emailId,
    fundId,
    companyId!,
    metricsResult,
    metrics
  )

  const status: ProcessingStatus = reviewCount > 0 ? 'needs_review' : writtenCount > 0 ? 'success' : 'not_processed'
  await finalizeEmail(supabase, emailId, { status, metricsExtracted: writtenCount })

  try {
    await saveToFileStorage(supabase, fundId, companyName, payload)
  } catch (err) {
    console.error('[pipeline] File storage save failed (non-blocking):', err)
  }

  if (fundMember) {
    try {
      await maybeExtractInteraction(supabase, fundId, emailId, companyId, fundMember.userId, payload, extracted.emailBody, provider, providerType, model)
    } catch (err) {
      console.error('[pipeline] Interaction extraction failed (non-blocking):', err)
    }
  }
}

// ---------------------------------------------------------------------------
// Result writer
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

  for (const periodData of result.periods) {
    const { reporting_period, metrics, unextracted_metrics } = periodData

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
      continue
    }

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

export async function getDef
