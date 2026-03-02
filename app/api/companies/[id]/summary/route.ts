import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createFundAIProviderWithOverride } from '@/lib/ai'
import type { ContentBlock } from '@/lib/ai/types'
import {
  extractAttachmentText,
  type PostmarkPayload,
} from '@/lib/parsing/extractAttachmentText'
import { dbError } from '@/lib/api-error'
import { rateLimit } from '@/lib/rate-limit'

// Verify the company belongs to the user's fund
async function verifyCompanyAccess(supabase: ReturnType<typeof createClient>, admin: ReturnType<typeof createAdminClient>, userId: string, companyId: string) {
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 404 }) }

  const { data: company } = await admin
    .from('companies')
    .select('fund_id')
    .eq('id', companyId)
    .maybeSingle()

  if (!company) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (company.fund_id !== membership.fund_id) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }

  return { fundId: membership.fund_id }
}

// ---------------------------------------------------------------------------
// GET — return the most recent stored summary (if any)
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await verifyCompanyAccess(supabase, admin, user.id, params.id)
  if ('error' in access) return access.error

  const { data: latest } = await admin
    .from('company_summaries')
    .select('summary_text, period_label, created_at')
    .eq('company_id', params.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle() as { data: { summary_text: string; period_label: string | null; created_at: string } | null }

  if (!latest) {
    return NextResponse.json({ summary: null, generated_at: null })
  }

  return NextResponse.json({
    summary: latest.summary_text,
    period_label: latest.period_label,
    generated_at: latest.created_at,
  })
}

// ---------------------------------------------------------------------------
// DELETE — wipe all stored summaries so the next generate is fresh
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const access = await verifyCompanyAccess(supabase, admin, user.id, params.id)
  if ('error' in access) return access.error

  const { error } = await admin
    .from('company_summaries')
    .delete()
    .eq('company_id', params.id)

  if (error) return dbError(error, 'companies-id-summary')

  return NextResponse.json({ ok: true })
}

// ---------------------------------------------------------------------------
// POST — generate a new AI summary and persist it
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Rate limit AI summary generation: 10 per 5 minutes per user
  const limited = await rateLimit({ key: `ai-summary:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  // Read optional provider override from body
  let providerOverride: 'anthropic' | 'openai' | undefined
  try {
    const body = await req.json()
    if (body.provider === 'anthropic' || body.provider === 'openai') {
      providerOverride = body.provider
    }
  } catch {
    // No body or invalid JSON — use default provider
  }

  const admin = createAdminClient()

  // Verify fund access before proceeding
  const access = await verifyCompanyAccess(supabase, admin, user.id, params.id)
  if ('error' in access) return access.error

  // --- Company ---
  const { data: company } = await admin
    .from('companies')
    .select('id, name, fund_id, stage, industry, notes, overview, why_invested, current_update')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // --- AI provider + model + custom prompt ---
  let provider: Awaited<ReturnType<typeof createFundAIProviderWithOverride>>['provider']
  let aiModel: string
  try {
    const result = await createFundAIProviderWithOverride(admin, company.fund_id, providerOverride)
    provider = result.provider
    aiModel = result.model
  } catch {
    return NextResponse.json({
      error: 'AI API key not configured. Add one in Settings to enable AI summaries.',
    }, { status: 400 })
  }

  const { data: promptSettings } = await admin
    .from('fund_settings')
    .select('ai_summary_prompt')
    .eq('fund_id', company.fund_id)
    .maybeSingle()
  const customPrompt = (promptSettings as unknown as { ai_summary_prompt: string | null } | null)?.ai_summary_prompt ?? null

  // --- Metrics + values ---
  const { data: metrics } = await admin
    .from('metrics')
    .select('id, name, slug, unit, unit_position, value_type, reporting_cadence')
    .eq('company_id', params.id)
    .eq('is_active', true)
    .order('display_order')

  const { data: values } = await admin
    .from('metric_values')
    .select('metric_id, period_label, period_year, period_quarter, period_month, value_number, value_text')
    .eq('company_id', params.id)
    .order('period_year')
    .order('period_quarter', { nullsFirst: true })
    .order('period_month', { nullsFirst: true })

  // --- Latest email with report content ---
  const { data: latestEmail } = await admin
    .from('inbound_emails')
    .select('raw_payload, subject, received_at')
    .eq('company_id', params.id)
    .eq('processing_status', 'success')
    .order('received_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // --- Company documents (uploaded context) ---
  const { data: companyDocuments } = await admin
    .from('company_documents' as any)
    .select('filename, extracted_text, has_native_content, storage_path, file_type')
    .eq('company_id', params.id)
    .order('created_at', { ascending: false })
    .limit(5) as { data: { filename: string; extracted_text: string | null; has_native_content: boolean; storage_path: string; file_type: string }[] | null }

  // --- Previous summaries ---
  const { data: previousSummaries } = await admin
    .from('company_summaries')
    .select('summary_text, period_label, created_at')
    .eq('company_id', params.id)
    .order('created_at', { ascending: false })
    .limit(3) as { data: { summary_text: string; period_label: string | null; created_at: string }[] | null }

  // -----------------------------------------------------------------------
  // Build context blocks for the prompt
  // -----------------------------------------------------------------------

  // 1. Metric data table
  let metricsBlock = ''
  if (metrics && metrics.length > 0 && values && values.length > 0) {
    const lines: string[] = []
    for (const m of metrics) {
      const mValues = (values ?? []).filter(v => v.metric_id === m.id)
      if (mValues.length === 0) continue
      const unitStr = m.unit ? ` (${m.unit})` : ''
      lines.push(`\n${m.name}${unitStr}:`)
      for (const v of mValues) {
        const val = v.value_number !== null ? v.value_number : v.value_text
        lines.push(`  ${v.period_label}: ${val}`)
      }
    }
    metricsBlock = lines.join('\n')
  }

  // Determine most recent period label from the data
  let currentPeriodLabel: string | null = null
  if (values && values.length > 0) {
    currentPeriodLabel = values[values.length - 1].period_label
  }

  // 2. Email body + attachment text from the most recent report
  let reportContentBlock = ''
  const contentParts: ContentBlock[] = []

  if (latestEmail?.raw_payload) {
    const payload = latestEmail.raw_payload as unknown as PostmarkPayload
    const extracted = await extractAttachmentText(payload)

    // Email body
    if (extracted.emailBody) {
      reportContentBlock += `[EMAIL BODY]\n${extracted.emailBody.slice(0, 30_000)}\n\n`
    }

    // Text from office documents (DOCX, PPTX, XLSX, CSV)
    for (const att of extracted.attachments) {
      if (!att.skipped && att.extractedText) {
        reportContentBlock += `[ATTACHMENT: ${att.filename}]\n${att.extractedText.slice(0, 30_000)}\n\n`
      }
    }

    // PDFs — send as document blocks
    for (const att of extracted.attachments) {
      if (!att.skipped && att.base64Content && att.contentType === 'application/pdf') {
        contentParts.push({ type: 'document', mediaType: 'application/pdf', data: att.base64Content })
      }
    }

    // Images — send as image blocks
    for (const att of extracted.attachments) {
      if (!att.skipped && att.base64Content && att.contentType.startsWith('image/')) {
        contentParts.push({ type: 'image', mediaType: att.contentType, data: att.base64Content })
      }
    }
  }

  // 3. Previous summaries
  let previousSummariesBlock = ''
  if (previousSummaries && previousSummaries.length > 0) {
    const summaryLines = previousSummaries
      .reverse()
      .map(s => `[${s.period_label ?? 'Unknown period'} — ${new Date(s.created_at).toLocaleDateString()}]\n${s.summary_text}`)
      .join('\n\n')
    previousSummariesBlock = summaryLines
  }

  // 4. Supplementary documents
  let documentsBlock = ''
  if (companyDocuments && companyDocuments.length > 0) {
    for (const doc of companyDocuments) {
      if (doc.extracted_text) {
        documentsBlock += `[DOCUMENT: ${doc.filename}]\n${doc.extracted_text.slice(0, 30_000)}\n\n`
      }
      if (doc.has_native_content && doc.storage_path) {
        // Download PDF/image from Storage and add as native content block
        const { data: fileData } = await admin
          .storage
          .from('company-documents')
          .download(doc.storage_path)

        if (fileData) {
          const buffer = Buffer.from(await fileData.arrayBuffer())
          const base64 = buffer.toString('base64')

          if (doc.file_type === 'application/pdf') {
            contentParts.push({ type: 'document', mediaType: 'application/pdf', data: base64 })
          } else if (doc.file_type.startsWith('image/')) {
            contentParts.push({ type: 'image', mediaType: doc.file_type, data: base64 })
          }
        }
      }
    }
  }

  // -----------------------------------------------------------------------
  // Build prompt
  // -----------------------------------------------------------------------

  const hasData = metricsBlock || reportContentBlock || contentParts.length > 0 || documentsBlock
  if (!hasData) {
    return NextResponse.json({
      summary: 'No data available yet. The summary will be generated after the first report is processed.',
      generated_at: null,
    })
  }

  const DEFAULT_TASK_PROMPT = `Write a concise analyst summary covering:

1. **Current Status** — How is the company performing right now? Reference specific numbers.
2. **Trends** — What direction are the key metrics heading? Growth rates, acceleration or deceleration.
3. **Progress & Positives** — What's going well? Milestones, improvements, or strong execution.
4. **Challenges & Risks** — What concerns you? Declining metrics, missing data, red flags.
5. **Key Follow-ups** — What should the investment team ask about or monitor next?

Keep it to 2-4 short paragraphs. Be direct and analytical, not promotional. Use specific numbers. Do not use markdown formatting — write in plain prose paragraphs.`

  const taskPrompt = customPrompt ?? DEFAULT_TASK_PROMPT

  let promptText = `You are a senior venture capital analyst at a growth-stage fund preparing an internal portfolio review memo for the investment committee. You think in terms of unit economics, growth efficiency, cash runway, and milestone progress. Your job is to surface what matters for the next board conversation and flag anything that warrants immediate attention.

Company: ${company.name}
${company.stage ? `Stage: ${company.stage}` : ''}
${company.industry?.length ? `Industry: ${company.industry.join(', ')}` : ''}
${company.notes ? `Fund notes: ${company.notes}` : ''}
${company.overview ? `Overview: ${company.overview}` : ''}
${company.why_invested ? `Why We Invested: ${company.why_invested}` : ''}
${company.current_update ? `Current Business Update: ${company.current_update}` : ''}`

  if (metricsBlock) {
    promptText += `

=== QUANTITATIVE DATA ===
Tracked metrics over time:
${metricsBlock}`
  }

  if (reportContentBlock) {
    promptText += `

=== LATEST REPORT CONTENT ===
From the most recent email report (${latestEmail?.subject ?? 'no subject'}, received ${latestEmail?.received_at ? new Date(latestEmail.received_at).toLocaleDateString() : 'unknown date'}):

${reportContentBlock}`
  }

  if (previousSummariesBlock) {
    promptText += `

=== PREVIOUS ANALYSIS ===
Your prior analyst summaries for this company (oldest to newest):

${previousSummariesBlock}`
  }

  if (documentsBlock) {
    promptText += `

=== SUPPLEMENTARY DOCUMENTS ===
Additional context documents uploaded by the investment team (strategy decks, board materials, etc.):

${documentsBlock}`
  }

  promptText += `

=== YOUR TASK ===
${taskPrompt}

${previousSummariesBlock ? 'Build on your previous analysis — note what has changed since your last review. Avoid repeating the same observations unless they remain critical.' : 'This is the first analysis for this company, so base it entirely on the available data and report content.'}
${documentsBlock ? '\nYou also have access to supplementary documents (strategy decks, board materials, etc.) uploaded by the investment team. Reference these when relevant.' : ''}`

  // -----------------------------------------------------------------------
  // Call Claude
  // -----------------------------------------------------------------------

  const userContent: ContentBlock[] = [
    ...contentParts,
    { type: 'text', text: promptText },
  ]

  try {
    const summaryText = await provider.createMessage({
      model: aiModel,
      maxTokens: 1000,
      content: userContent,
    })

    // Persist the summary
    const { error: insertError } = await admin.from('company_summaries').insert({
      company_id: params.id,
      fund_id: company.fund_id,
      period_label: currentPeriodLabel,
      summary_text: summaryText,
    })

    if (insertError) {
      console.error('[company-summary] DB insert error:', insertError)
      // Still return the summary even if persist fails
    }

    return NextResponse.json({
      summary: summaryText,
      period_label: currentPeriodLabel,
      generated_at: new Date().toISOString(),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[company-summary] Claude error:', message, err)
    return NextResponse.json({
      error: `Summary generation failed: ${message}`,
    }, { status: 500 })
  }
}
