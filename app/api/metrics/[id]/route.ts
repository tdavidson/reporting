import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

const VALID_VALUE_TYPES = ['number', 'currency', 'percentage', 'text']
const VALID_UNIT_POSITIONS = ['prefix', 'suffix']
const VALID_REPORTING_CADENCES = ['quarterly', 'monthly', 'annual']

async function verifyOwnership(admin: ReturnType<typeof createAdminClient>, metricId: string, userId: string) {
  const { data: metric } = await admin
    .from('metrics')
    .select('id, company_id, fund_id')
    .eq('id', metricId)
    .maybeSingle()

  if (!metric) return null

  const { data: membership } = await admin
    .from('fund_members')
    .select('id')
    .eq('fund_id', metric.fund_id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership) return null

  return metric
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const admin = createAdminClient()
  const metric = await verifyOwnership(admin, params.id, user.id)
  if (!metric) return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })

  const body = await req.json()
  const { name, slug, description, unit, unit_position, value_type, reporting_cadence, display_order, is_active } = body

  if (value_type !== undefined && !VALID_VALUE_TYPES.includes(value_type)) {
    return NextResponse.json({ error: `Invalid value_type. Must be one of: ${VALID_VALUE_TYPES.join(', ')}` }, { status: 400 })
  }
  if (unit_position !== undefined && unit_position !== null && !VALID_UNIT_POSITIONS.includes(unit_position)) {
    return NextResponse.json({ error: `Invalid unit_position. Must be one of: ${VALID_UNIT_POSITIONS.join(', ')}` }, { status: 400 })
  }
  if (reporting_cadence !== undefined && !VALID_REPORTING_CADENCES.includes(reporting_cadence)) {
    return NextResponse.json({ error: `Invalid reporting_cadence. Must be one of: ${VALID_REPORTING_CADENCES.join(', ')}` }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (slug !== undefined) updates.slug = slug
  if (description !== undefined) updates.description = description?.trim() || null
  if (unit !== undefined) updates.unit = unit?.trim() || null
  if (unit_position !== undefined) updates.unit_position = unit_position
  if (value_type !== undefined) updates.value_type = value_type
  if (reporting_cadence !== undefined) updates.reporting_cadence = reporting_cadence
  if (display_order !== undefined) updates.display_order = display_order
  if (is_active !== undefined) updates.is_active = is_active

  const { data, error } = await admin
    .from('metrics')
    .update(updates)
    .eq('id', params.id)
    .select()
    .single()

  if (error) return dbError(error, 'metrics-id')

  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(createAdminClient(), user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const admin = createAdminClient()
  const metric = await verifyOwnership(admin, params.id, user.id)
  if (!metric) return NextResponse.json({ error: 'Not found or forbidden' }, { status: 404 })

  const force = req.nextUrl.searchParams.get('force') === 'true'

  // Check for existing values
  const { count } = await admin
    .from('metric_values')
    .select('id', { count: 'exact', head: true })
    .eq('metric_id', params.id)

  if ((count ?? 0) > 0 && !force) {
    return NextResponse.json({ error: 'Has values', valueCount: count }, { status: 409 })
  }

  if ((count ?? 0) > 0) {
    await admin.from('metric_values').delete().eq('metric_id', params.id)
  }

  const { error } = await admin.from('metrics').delete().eq('id', params.id)
  if (error) return dbError(error, 'metrics-id')

  return NextResponse.json({ ok: true })
}
