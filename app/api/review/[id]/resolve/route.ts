import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { parseValue } from '@/lib/pipeline/processEmail'
import type { ParsingReview, Metric } from '@/lib/types/database'
import type { ExtractMetricsResult } from '@/lib/claude/extractMetrics'

type ReviewRow = Pick<
  ParsingReview,
  | 'id'
  | 'fund_id'
  | 'email_id'
  | 'metric_id'
  | 'company_id'
  | 'issue_type'
  | 'extracted_value'
  | 'resolution'
>

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const body = await req.json()
  const { resolution, resolved_value } = body as {
    resolution: string
    resolved_value?: string
  }

  if (!['accepted', 'rejected', 'manually_corrected'].includes(resolution)) {
    return NextResponse.json({ error: 'Invalid resolution' }, { status: 400 })
  }
  if (resolution === 'manually_corrected' && !resolved_value?.trim()) {
    return NextResponse.json(
      { error: 'resolved_value is required for manually_corrected' },
      { status: 400 }
    )
  }

  // RLS ensures the review belongs to the user's fund
  const { data: reviewData, error: reviewError } = await supabase
    .from('parsing_reviews')
    .select('id, fund_id, email_id, metric_id, company_id, issue_type, extracted_value, resolution')
    .eq('id', params.id)
    .maybeSingle()

  if (reviewError) return NextResponse.json({ error: reviewError.message }, { status: 500 })
  if (!reviewData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const review = reviewData as unknown as ReviewRow
  if (review.resolution) return NextResponse.json({ error: 'Already resolved' }, { status: 409 })

  const admin = createAdminClient()

  // Write to metric_values for issue types where the pipeline skipped writing.
  // low_confidence: value was already written → only write if manually_corrected.
  // duplicate_period, ambiguous_period: nothing was written → write on accept/manually_corrected.
  const writableOnAccept = ['duplicate_period', 'ambiguous_period']
  const shouldWrite =
    (resolution === 'accepted' && writableOnAccept.includes(review.issue_type)) ||
    (resolution === 'manually_corrected' && !!review.metric_id && !!review.company_id)

  const valueToWrite =
    resolution === 'manually_corrected' ? resolved_value! : review.extracted_value

  if (shouldWrite && review.metric_id && review.company_id && valueToWrite) {
    // Get period info from the email's stored Claude response
    const { data: emailData } = await admin
      .from('inbound_emails')
      .select('claude_response')
      .eq('id', review.email_id)
      .single()

    const claudeResponse = (emailData as unknown as { claude_response: ExtractMetricsResult | null })?.claude_response
    const period = claudeResponse?.reporting_period

    if (period) {
      const { data: metricData } = await admin
        .from('metrics')
        .select('value_type')
        .eq('id', review.metric_id)
        .single()

      const valueType = (metricData as unknown as Pick<Metric, 'value_type'> | null)?.value_type ?? 'number'
      const valueFields = parseValue(valueToWrite, valueType)

      // Check for existing row (unique index uses coalesce, so we query manually)
      let existingQuery = admin
        .from('metric_values')
        .select('id')
        .eq('metric_id', review.metric_id)
        .eq('period_year', period.year)

      existingQuery =
        period.quarter != null
          ? existingQuery.eq('period_quarter', period.quarter)
          : existingQuery.is('period_quarter', null)

      existingQuery =
        period.month != null
          ? existingQuery.eq('period_month', period.month)
          : existingQuery.is('period_month', null)

      const { data: existing } = await existingQuery.maybeSingle()
      const existingRow = existing as unknown as { id: string } | null

      if (existingRow) {
        await admin
          .from('metric_values')
          .update({
            ...valueFields,
            confidence: 'high',
            is_manually_entered: resolution === 'manually_corrected',
            notes:
              resolution === 'manually_corrected'
                ? 'Manually corrected via review queue'
                : null,
          })
          .eq('id', existingRow.id)
      } else {
        await admin.from('metric_values').insert({
          metric_id: review.metric_id,
          company_id: review.company_id,
          fund_id: review.fund_id,
          period_label: period.label,
          period_year: period.year,
          period_quarter: period.quarter ?? null,
          period_month: period.month ?? null,
          confidence: 'high',
          source_email_id: review.email_id,
          is_manually_entered: resolution === 'manually_corrected',
          notes:
            resolution === 'manually_corrected'
              ? 'Manually corrected via review queue'
              : null,
          ...valueFields,
        })
      }
    }
  }

  // Mark the review resolved
  const validResolution = resolution as 'accepted' | 'rejected' | 'manually_corrected'
  await admin
    .from('parsing_reviews')
    .update({
      resolution: validResolution,
      resolved_value: resolved_value ?? null,
      resolved_at: new Date().toISOString(),
    })
    .eq('id', params.id)

  // If fund prefers not to retain resolved reviews, delete immediately
  const { data: settingsData } = await admin
    .from('fund_settings')
    .select('retain_resolved_reviews')
    .eq('fund_id', review.fund_id)
    .maybeSingle()

  const settings = settingsData as unknown as { retain_resolved_reviews: boolean } | null
  if (settings && !settings.retain_resolved_reviews) {
    await admin.from('parsing_reviews').delete().eq('id', params.id)
  }

  return NextResponse.json({ ok: true })
}
