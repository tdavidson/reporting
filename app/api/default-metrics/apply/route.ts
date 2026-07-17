import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { applyDefaultsToAllCompanies } from '@/lib/metrics/seed-default-metrics'

// Re-apply the whole profile across every company. Idempotent (insert-if-not-exists by
// (company_id, slug)) — safe to run repeatedly; a "Sync to all companies" button.

export async function POST() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { inserted, companies } = await applyDefaultsToAllCompanies(admin, gate.fundId)
  return NextResponse.json({ inserted, companies })
}
