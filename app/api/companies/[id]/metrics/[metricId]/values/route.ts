import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string; metricId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('metric_values')
    .select('*, inbound_emails(id, subject, received_at)')
    .eq('metric_id', params.metricId)
    .eq('company_id', params.id)
    .order('period_year')
    .order('period_quarter', { nullsFirst: true })
    .order('period_month', { nullsFirst: true })

  if (error) return dbError(error, 'metric-values')

  // Deduplicate: keep the latest entry per period
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>
  const seen = new Map<string, Record<string, unknown>>()
  for (const row of rows) {
    const key = `${row.period_year}-${row.period_quarter ?? ''}-${row.period_month ?? ''}`
    const existing = seen.get(key)
    if (!existing || (row.created_at as string) > (existing.created_at as string)) {
      seen.set(key, row)
    }
  }

  return NextResponse.json(Array.from(seen.values()))
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; metricId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: metric } = await admin
    .from('metrics')
    .select('id, fund_id, value_type')
    .eq('id', params.metricId)
    .eq('company_id', params.id)
    .maybeSingle()

  if (!metric) return NextResponse.json({ error: 'Metric not found' }, { status: 404 })

  const { data: membership } = await admin
    .from('fund_members')
    .select('id')
    .eq('fund_id', metric.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await req.json()
  const { period_label, period_year, period_quarter, period_month, value, notes } = body

  if (!period_label || !period_year) {
    return NextResponse.json({ error: 'period_label and period_year are required' }, { status: 400 })
  }

  const valueFields: { value_number?: number; value_text?: string } =
    metric.value_type === 'text'
      ? { value_text: String(value) }
      : { value_number: typeof value === 'number' ? value : parseFloat(value) }

  // Check for existing value in the same period — update instead of creating duplicate
  let existingQuery = admin
    .from('metric_values')
    .select('id')
    .eq('metric_id', params.metricId)
    .eq('period_year', period_year)

  if (period_quarter != null) {
    existingQuery = existingQuery.eq('period_quarter', period_quarter)
  } else {
    existingQuery = existingQuery.is('period_quarter', null)
  }
  if (period_month != null) {
    existingQuery = existingQuery.eq('period_month', period_month)
  } else {
    existingQuery = existingQuery.is('period_month', null)
  }

  const { data: existing } = await existingQuery.maybeSingle()

  if (existing) {
    // Update the existing row
    const { data, error } = await admin
      .from('metric_values')
      .update({
        period_label,
        confidence: 'high',
        is_manually_entered: true,
        notes: notes ?? null,
        ...valueFields,
      })
      .eq('id', existing.id)
      .select()
      .single()

    if (error) return dbError(error, 'metric-values')
    return NextResponse.json(data)
  }

  const { data, error } = await admin
    .from('metric_values')
    .insert({
      metric_id: params.metricId,
      company_id: params.id,
      fund_id: metric.fund_id,
      period_label,
      period_year,
      period_quarter: period_quarter ?? null,
      period_month: period_month ?? null,
      confidence: 'high',
      is_manually_entered: true,
      notes: notes ?? null,
      ...valueFields,
    })
    .select()
    .single()

  if (error) return dbError(error, 'metric-values')

  return NextResponse.json(data, { status: 201 })
}
