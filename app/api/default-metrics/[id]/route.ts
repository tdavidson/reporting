import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

// Editing / deleting a default metric touches the PROFILE only. Metrics already copied into
// companies are their own rows now and are deliberately left alone (seed-only model).

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  for (const key of ['name', 'slug', 'description', 'unit', 'unit_position', 'value_type', 'reporting_cadence', 'display_order', 'currency', 'is_active']) {
    if (key in body) updates[key] = body[key]
  }
  if ('name' in updates && !String(updates.name ?? '').trim()) {
    return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 })
  }
  if ('slug' in updates && !String(updates.slug ?? '').trim()) {
    return NextResponse.json({ error: 'Slug cannot be empty' }, { status: 400 })
  }

  const { data, error } = await (admin as any)
    .from('default_metrics')
    .update(updates)
    .eq('id', params.id)
    .eq('fund_id', gate.fundId)
    .select()
    .single()

  if (error) return dbError(error, 'default-metrics-id')
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { error } = await (admin as any)
    .from('default_metrics')
    .delete()
    .eq('id', params.id)
    .eq('fund_id', gate.fundId)

  if (error) return dbError(error, 'default-metrics-id')
  return NextResponse.json({ ok: true })
}
