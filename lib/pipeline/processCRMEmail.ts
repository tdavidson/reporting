import { createAdminClient } from '@/lib/supabase/admin'
import { extractAttachmentText } from '@/lib/parsing/extractAttachmentText'
import { identifyCompany } from '@/lib/claude/identifyCompany'
import { extractInteraction } from '@/lib/claude/extractInteraction'
import { extractMetrics } from '@/lib/claude/extractMetrics'
import { createFundAIProvider } from '@/lib/ai'
import {
  getCompanies,
  getMetrics,
  buildCombinedText,
  parseValue,
  createReview,
  finalizeEmail,
  type PostmarkPayload,
} from '@/lib/pipeline/processEmail'
import type { Json, ProcessingStatus } from '@/lib/types/database'

type Supabase = ReturnType<typeof createAdminClient>

export async function runCRMPipeline(
  supabase: Supabase,
  emailId: string,
  fundId: string,
  userId: string,
  payload: PostmarkPayload
): Promise<void> {
  // Check if interactions feature is turned off
  const { data: fSettings } = await supabase
    .from('fund_settings')
    .select('feature_visibility')
    .eq('fund_id', fundId)
    .maybeSingle()
  const fv = fSettings?.feature_visibility as Record<string, string> | null
  if (fv?.interactions === 'off') {
    await finalizeEmail(supabase, emailId, { status: 'not_processed', metricsExtracted: 0 })
    return
  }

  // Step 1: Extract text from email body
  const extracted = await extractAttachmentText(payload)
  const bodyText = extracted.emailBody

  // Step 2: Get AI provider based on default setting
  const { provider, model, providerType } = await createFundAIProvider(supabase, fundId)
  const logParams = { admin: supabase, fundId }

  // Step 3: Identify company
  const companies = await getCompanies(supabase, fundId)
  let companyId: string | null = null

  if (companies.length > 0) {
    try {
      const identification = await identifyCompany(
        payload.Subject ?? '',
        bodyText,
        companies,
        provider,
        providerType,
        model,
        logParams
      )

      if (identification.company_id) {
        companyId = identification.company_id
        await supabase
          .from('inbound_emails')
          .update({ company_id: companyId })
          .eq('id', emailId)
      }
    } catch (err) {
      console.error('[crm-pipeline] Company identification failed (non-blocking):', err)
    }
  }

  // Step 4: Extract interaction details via AI
  const senderName = payload.FromFull?.Name || payload.From || ''
  const interaction = await extractInteraction(
    payload.Subject ?? '',
    bodyText,
    senderName,
    provider,
    providerType,
    model,
    logParams
  )

  // Step 5: Insert interaction record
  const REPORTING_TOPICS = new Set(['reporting', 'financials', 'metrics', 'quarterly report', 'monthly report', 'performance', 'kpis', 'revenue update'])
  const topics = interaction.topics ?? []
  const isReporting = topics.length > 0 && topics.every(t => REPORTING_TOPICS.has(t.toLowerCase()))
  const interactionType = interaction.is_intro ? 'intro' : isReporting ? 'reporting' : 'email'

  await supabase.from('interactions').insert({
    fund_id: fundId,
    company_id: companyId,
    email_id: emailId,
    user_id: userId,
    type: interactionType,
    subject: payload.Subject ?? null,
    summary: interaction.summary,
    intro_contacts: interaction.intro_contacts as unknown as Json,
    topics,
    body_preview: bodyText.slice(0, 500),
    interaction_date: new Date().toISOString(),
  })

  // Step 6: Extract metrics if the company has defined metrics
  let metricsExtracted = 0
  let status: ProcessingStatus = 'not_processed'

  if (companyId) {
    const metrics = await getMetrics(supabase, companyId)

    if (metrics.length > 0) {
      const companyName = companies.find(c => c.id === companyId)?.name ?? ''
      const combinedText = buildCombinedText(extracted)

      const pdfBase64s = extracted.attachments
        .filter(a => !a.skipped && a.base64Content && a.contentType === 'application/pdf')
        .map(a => a.base64Content!)

      const images = extracted.attachments
        .filter(a => !a.skipped && a.base64Content && a.contentType.startsWith('image/'))
        .map(a => ({ data: a.base64Content!, mediaType: a.contentType }))

      try {
        const metricsResult = await extractMetrics(
          companyName,
          combinedText,
          metrics,
          pdfBase64s,
          images,
          provider,
          providerType,
          model,
          logParams
        )

        // Store the raw AI response
        await supabase
          .from('inbound_emails')
          .update({ claude_response: metricsResult as unknown as Json })
          .eq('id', emailId)

        // Write extracted metric values
        const { reporting_period, metrics: extractedMetrics, unextracted_metrics } = metricsResult
        let reviewCount = 0

        if (reporting_period.confidence !== 'low') {
          for (const m of extractedMetrics) {
            const def = metrics.find(d => d.id === m.metric_id)
            if (!def) continue

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
              if (error.code === '23505') continue // duplicate period
              console.error(`[crm-pipeline] Failed to insert metric_value for ${m.metric_id}:`, error)
              continue
            }

            metricsExtracted++

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
        } else {
          // Low-confidence period — flag all metrics for review
          for (const m of extractedMetrics) {
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
        }

        if (reviewCount > 0) status = 'needs_review'
        else if (metricsExtracted > 0) status = 'success'
      } catch (err) {
        console.error('[crm-pipeline] Metrics extraction failed (non-blocking):', err)
      }
    }
  }

  // Step 7: Finalize email
  await finalizeEmail(supabase, emailId, { status, metricsExtracted })
}
