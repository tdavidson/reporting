import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { seedCompanyFromDefaults } from '@/lib/metrics/seed-default-metrics'

// The fund's default metric profile, seen from ONE company: which defaults it already tracks,
// which it has opted out of, and which are still available to seed. Powers the company page's
// "Fund defaults" panel (seed-on-demand + per-company opt-out).

async function resolveCompanyFund(admin: ReturnType<typeof createAdminClient>, companyId: string, fundId: string) {
  const { data: company } = await admin.from('companies').select('fund_id').eq('id', companyId).maybeSingle()
  if (!company) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (company.fund_id !== fundId) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { ok: true as const }
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const check = await resolveCompanyFund(admin, params.id, gate.fundId)
  if (check.error) return check.error

  const [{ data: defaults, error }, { data: metrics }, { data: exclusions }] = await Promise.all([
    (admin as any).from('default_metrics').select('*').eq('fund_id', gate.fundId).eq('is_active', true).order('display_order'),
    admin.from('metrics').select('slug').eq('company_id', params.id),
    (admin as any).from('default_metric_exclusions').select('default_metric_id').eq('company_id', params.id),
  ])

  if (error) return dbError(error, 'company-default-metrics')

  const trackedSlugs = new Set(((metrics ?? []) as { slug: string }[]).map(m => m.slug))
  const excludedIds = new Set(((exclusions ?? []) as { default_metric_id: string }[]).map(e => e.default_metric_id))

  const list = ((defaults ?? []) as any[]).map(d => ({
    id: d.id,
    name: d.name,
    slug: d.slug,
    description: d.description,
    unit: d.unit,
    value_type: d.value_type,
    status: trackedSlugs.has(d.slug) ? 'tracked' : excludedIds.has(d.id) ? 'excluded' : 'available',
  }))

  return NextResponse.json(list)
}

// Seed every currently-available default (not already tracked, not opted out) into this company.
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const check = await resolveCompanyFund(admin, params.id, gate.fundId)
  if (check.error) return check.error

  const inserted = await seedCompanyFromDefaults(admin, gate.fundId, params.id)
  return NextResponse.json({ inserted })
}
