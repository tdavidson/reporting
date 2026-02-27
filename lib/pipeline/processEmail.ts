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
import { decryptApiKey } from '@/lib/crypto'
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
  Subject?: string
  TextBody?: string
  HtmlBody?: string
  Attachments?: Array<{
    Name: string
    ContentType: string
    Content: string
    ContentLength: number
  }>
}

// ---------------------------------------------------------------------------
// Main pipeline — runs steps 4-8 for a given email record
// ---------------------------------------------------------------------------

export async function runPipeline(
  supabase: Supabase,
  emailId: string,
  fundId: string,
  payload: PostmarkPayload
): Promise<void> {
  // Step 4: Extract text from email body and attachments
  const extracted = await extractAttachmentText(payload)

  // Fetch the fund's (decrypted) Claude API key
  const claudeApiKey = await getClaudeApiKey(supabase, fundId)

  // Step 5: Identify the company
  const companies = await getCompanies(supabase, fundId)

  const identification = await identifyCompany(
    payload.Subject ?? '',
    extracted.emailBody,
    companies,
    claudeApiKey
  )

  if (identification.new_company_name) {
    await createReview(supabase, {
      fund_id: fundId,
      email_id: emailId,
      issue_type: 'new_company_detected',
      extracted_value: identification.new_company_name,
      context_snippet: identification.reasoning,
    })
    await finalizeEmail(supabase, emailId, { status: 'needs_review' })
    return
  }

  if (!identification.company_id) {
    await createReview(supabase, {
      fund_id: fundId,
      email_id: emailId,
      issue_type: 'company_not_identified',
      context_snippet: identification.reasoning,
    })
    await finalizeEmail(supabase, emailId, { status: 'needs_review' })
    return
  }

  const companyId = identification.company_id
  const companyName = companies.find(c => c.id === companyId)?.name ?? ''

  await supabase
    .from('inbound_emails')
    .update({ company_id: companyId })
    .eq('id', emailId)

  // Step 6: Extract metrics
  const metrics = await getMetrics(supabase, companyId)

  if (metrics.length === 0) {
    await finalizeEmail(supabase, emailId, { status: 'success', metricsExtracted: 0 })
    return
  }

  const combinedText = buildCombinedText(extracted)

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
    claudeApiKey
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
    companyId,
    metricsResult,
    metrics
  )

  // Step 8: Finalize
  const status: ProcessingStatus = reviewCount > 0 ? 'needs_review' : 'success'
  await finalizeEmail(supabase, emailId, { status, metricsExtracted: writtenCount })
}

// ---------------------------------------------------------------------------
// Result writer (Step 7)
// ---------------------------------------------------------------------------

async function writeResults(
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
  opts: { status: ProcessingStatus; metricsExtracted?: number }
) {
  await supabase
    .from('inbound_emails')
    .update({
      processing_status: opts.status,
      metrics_extracted: opts.metricsExtracted ?? 0,
    })
    .eq('id', emailId)
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

export function buildCombinedText(extracted: ExtractionResult): string {
  const parts: string[] = [`[EMAIL BODY]\n${extracted.emailBody}`]
  for (const att of extracted.attachments) {
    if (!att.skipped && att.extractedText) {
      parts.push(`[ATTACHMENT: ${att.filename}]\n${att.extractedText}`)
    }
  }
  return parts.join('\n\n')
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
