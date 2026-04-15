/**
 * POST /api/companies/seed-default-metrics
 *
 * Backfill endpoint — adds the 4 default metrics (MRR, Cash, Burn Rate, Runway)
 * to every existing company in the caller's fund that is missing any of them.
 * Safe to call multiple times (idempotent).
 *
 * Response: { processed: number, totalInserted: number, errors: string[] }
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { seedDefaultMetrics } from '@/lib/default-metrics'

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck

  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  const { data: companies, error: compErr } = await admin
    .from('companies')
    .select('id, fund_id')
    .eq('fund_id', membership.fund_id)

  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 500 })

  let totalInserted = 0
  const errors: string[] = []

  for (const company of companies ?? []) {
    try {
      const { inserted } = await seedDefaultMetrics(admin, company.id, company.fund_id)
      totalInserted += inserted
    } catch (err) {
      errors.push(`company ${company.id}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return NextResponse.json({
    processed: companies?.length ?? 0,
    totalInserted,
    errors,
  })
}
