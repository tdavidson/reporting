import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { rateLimit } from '@/lib/rate-limit'
import { dbError } from '@/lib/api-error'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limited = await rateLimit({ key: `compliance-profile:${user.id}`, limit: 20, windowSeconds: 60 })
  if (limited) return limited

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  const { fundId } = writeCheck

  const body = await req.json()

  // Validate enum fields against allowed values
  const VALID = {
    registration_status: ['ria', 'era', 'not_registered', 'unsure'],
    aum_range: ['under_25m', '25m_100m', '100m_150m', '150m_500m', '500m_1.5b', 'over_1.5b', 'unsure'],
    fund_structure: ['lp', 'llc_partnership', 'llc_corp', 'other'],
    fundraising_status: ['actively_raising', 'closed_recent', 'closed_over_12m', 'evergreen'],
    reg_d_exemption: ['506b', '506c', 'no', 'unsure'],
    investor_state_count: ['single_state', '2_to_5', '6_to_15', '16_plus', 'unsure'],
    public_equity: ['yes_over_100m', 'yes_under_100m', 'yes_5pct_single', 'no', 'unsure'],
    cftc_activity: ['yes_with_exemption', 'yes_no_exemption', 'no', 'unsure'],
    access_person_count: ['1_to_3', '4_to_10', '11_plus'],
    has_foreign_entities: ['yes', 'no'],
    has_foreign_investors: ['yes', 'no', 'unsure'],
  } as const

  const VALID_CA_NEXUS = ['hq_ca', 'investors_ca', 'investments_ca', 'fundraising_ca', 'none']

  function validateEnum(value: unknown, allowed: readonly string[]): string | null {
    return typeof value === 'string' && allowed.includes(value) ? value : null
  }

  const california_nexus = Array.isArray(body.california_nexus)
    ? body.california_nexus.filter((v: unknown) => typeof v === 'string' && VALID_CA_NEXUS.includes(v as string)).slice(0, 10)
    : null

  const profile = {
    fund_id: fundId,
    registration_status: validateEnum(body.registration_status, VALID.registration_status),
    aum_range: validateEnum(body.aum_range, VALID.aum_range),
    fund_structure: validateEnum(body.fund_structure, VALID.fund_structure),
    fundraising_status: validateEnum(body.fundraising_status, VALID.fundraising_status),
    reg_d_exemption: validateEnum(body.reg_d_exemption, VALID.reg_d_exemption),
    investor_state_count: validateEnum(body.investor_state_count, VALID.investor_state_count),
    california_nexus,
    public_equity: validateEnum(body.public_equity, VALID.public_equity),
    cftc_activity: validateEnum(body.cftc_activity, VALID.cftc_activity),
    access_person_count: validateEnum(body.access_person_count, VALID.access_person_count),
    has_foreign_entities: validateEnum(body.has_foreign_entities, VALID.has_foreign_entities),
    has_foreign_investors: validateEnum(body.has_foreign_investors, VALID.has_foreign_investors),
    completed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }

  const { data, error } = await admin
    .from('fund_compliance_profile')
    .upsert(profile, { onConflict: 'fund_id' })
    .select()
    .single()

  if (error) return dbError(error, 'compliance-profile')
  return NextResponse.json(data)
}
