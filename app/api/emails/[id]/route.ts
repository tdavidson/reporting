import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { InboundEmail, Metric, MetricValue, ParsingReview } from '@/lib/types/database'

type MetricValueRow = Pick<
  MetricValue,
  'id' | 'period_label' | 'value_number' | 'value_text' | 'confidence' | 'metric_id'
>

type ReviewRow = Pick<ParsingReview, 'id' | 'issue_type' | 'resolution' | 'resolved_at' | 'extracted_value'>

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: emailData, error } = await supabase
    .from('inbound_emails')
    .select(
      'id, from_address, subject, received_at, processing_status, processing_error, claude_response, metrics_extracted, attachments_count, raw_payload, company_id, fund_id'
    )
    .eq('id', params.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!emailData) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const email = emailData as unknown as InboundEmail

  // Parallel fetches
  const [companyResult, mvResult, reviewResult] = await Promise.all([
    email.company_id
      ? supabase.from('companies').select('id, name').eq('id', email.company_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('metric_values')
      .select('id, period_label, value_number, value_text, confidence, metric_id')
      .eq('source_email_id', params.id)
      .order('created_at'),
    supabase
      .from('parsing_reviews')
      .select('id, issue_type, resolution, resolved_at, extracted_value')
      .eq('email_id', params.id)
      .order('created_at'),
  ])

  const company = companyResult.data as { id: string; name: string } | null
  const metricValues = (mvResult.data ?? []) as unknown as MetricValueRow[]
  const reviews = (reviewResult.data ?? []) as unknown as ReviewRow[]

  // Fetch metric names for the written values
  const metricIds = Array.from(new Set(metricValues.map(mv => mv.metric_id)))
  const { data: metricsData } = metricIds.length
    ? await supabase.from('metrics').select('id, name, unit, unit_position').in('id', metricIds)
    : { data: [] }

  const metricsById = Object.fromEntries(
    ((metricsData ?? []) as unknown as Pick<Metric, 'id' | 'name' | 'unit' | 'unit_position'>[]).map(
      m => [m.id, m]
    )
  )

  return NextResponse.json({
    id: email.id,
    from_address: email.from_address,
    subject: email.subject,
    received_at: email.received_at,
    processing_status: email.processing_status,
    processing_error: email.processing_error,
    claude_response: email.claude_response,
    metrics_extracted: email.metrics_extracted,
    attachments_count: email.attachments_count,
    raw_payload: email.raw_payload,
    company,
    metric_values: metricValues.map(mv => ({
      id: mv.id,
      period_label: mv.period_label,
      value_number: mv.value_number,
      value_text: mv.value_text,
      confidence: mv.confidence,
      metric: metricsById[mv.metric_id] ?? null,
    })),
    reviews,
  })
}
