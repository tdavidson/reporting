import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { applyDefaultsToAllCompanies } from '@/lib/metrics/seed-default-metrics'

// The fund-wide default metric profile. Admin-only: it writes into every company, so the
// question is "may this person configure the fund?", not a per-domain grant.

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { data, error } = await (admin as any)
    .from('default_metrics')
    .select('*')
    .eq('fund_id', gate.fundId)
    .order('display_order')

  if (error) return dbError(error, 'default-metrics')
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json()
  const { name, slug, description, unit, unit_position, value_type, reporting_cadence, display_order, currency } = body

  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  if (!slug?.trim()) return NextResponse.json({ error: 'Slug is required' }, { status: 400 })

  // Dedup within the profile itself (unique(fund_id, slug) is the DB backstop).
  const { data: existing } = await (admin as any)
    .from('default_metrics')
    .select('id')
    .eq('fund_id', gate.fundId)
    .eq('slug', slug.trim())
    .maybeSingle()

  if (existing) {
    return NextResponse.json({ error: 'A default metric with this slug already exists' }, { status: 409 })
  }

  const { data, error } = await (admin as any)
    .from('default_metrics')
    .insert({
      fund_id: gate.fundId,
      name: name.trim(),
      slug: slug.trim(),
      description: description?.trim() || null,
      unit: unit?.trim() || null,
      unit_position: unit_position ?? 'suffix',
      value_type: value_type ?? 'number',
      reporting_cadence: reporting_cadence ?? 'quarterly',
      display_order: display_order ?? 0,
      currency: currency?.trim() || null,
      is_active: true,
    })
    .select()
    .single()

  if (error) return dbError(error, 'default-metrics')

  // Apply to every existing company now (new companies get seeded at creation).
  const { inserted, companies } = await applyDefaultsToAllCompanies(admin, gate.fundId)

  return NextResponse.json({ metric: data, applied: { inserted, companies } }, { status: 201 })
}
