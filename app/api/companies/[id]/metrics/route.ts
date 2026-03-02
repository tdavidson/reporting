import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import type { ReportingCadence, ValueType } from '@/lib/types/database'
import { dbError } from '@/lib/api-error'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS ensures this company belongs to the user's fund
  const { data: company } = await supabase
    .from('companies')
    .select('id, fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  type MetricRow = {
    id: string; company_id: string; fund_id: string; name: string; slug: string
    description: string | null; unit: string | null; unit_position: string
    value_type: string; reporting_cadence: string; display_order: number
    is_active: boolean; created_at: string
    metric_values: { value_number: number | null; value_text: string | null; period_label: string; created_at: string }[]
  }

  const { data, error } = await supabase
    .from('metrics')
    .select('*, metric_values(value_number, value_text, period_label, created_at)')
    .eq('company_id', params.id)
    .order('display_order') as { data: MetricRow[] | null; error: { message: string } | null }

  if (error) return dbError(error, 'companies-id-metrics')

  const metrics = (data ?? []).map(m => {
    const values = m.metric_values ?? []
    const sorted = [...values].sort((a, b) => b.created_at.localeCompare(a.created_at))
    const latest = sorted[0] ?? null

    const { metric_values: _, ...rest } = m
    return {
      ...rest,
      latestValue: latest ? {
        value_number: latest.value_number,
        value_text: latest.value_text,
        period_label: latest.period_label,
      } : null,
      _valueCount: values.length,
    }
  })

  return NextResponse.json(metrics)
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const body = await req.json()
  const { name, slug, description, unit, unit_position, value_type, reporting_cadence, display_order } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!slug?.trim()) return NextResponse.json({ error: 'Slug is required' }, { status: 400 })

  const admin = createAdminClient()

  const { data: company } = await admin
    .from('companies')
    .select('fund_id')
    .eq('id', params.id)
    .maybeSingle()

  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: membership } = await admin
    .from('fund_members')
    .select('id')
    .eq('fund_id', company.fund_id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Check slug uniqueness within this company
  const { data: existing } = await admin
    .from('metrics')
    .select('id')
    .eq('company_id', params.id)
    .eq('slug', slug.trim())
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'A metric with this slug already exists for this company' }, { status: 409 })
  }

  const { data, error } = await admin
    .from('metrics')
    .insert({
      company_id: params.id,
      fund_id: company.fund_id,
      name: name.trim(),
      slug: slug.trim(),
      description: description?.trim() || null,
      unit: unit?.trim() || null,
      unit_position: unit_position ?? 'suffix',
      value_type: (value_type ?? 'number') as ValueType,
      reporting_cadence: (reporting_cadence ?? 'quarterly') as ReportingCadence,
      display_order: display_order ?? 0,
      is_active: true,
    })
    .select()
    .single()

  if (error) return dbError(error, 'companies-id-metrics')

  return NextResponse.json(data, { status: 201 })
}
