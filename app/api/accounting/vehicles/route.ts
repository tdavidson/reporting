import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { listVehicles } from '@/lib/accounting/load'

// GET — the fund's active vehicle names, for the Accounting picker. Vehicle
// creation/management lives at the fund level (/api/vehicles), since vehicles
// aren't accounting-specific.
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  return NextResponse.json(await listVehicles(admin, gate.fundId))
}
