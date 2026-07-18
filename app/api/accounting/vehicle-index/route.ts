import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { listVehiclesWithId } from '@/lib/accounting/load'

// GET — the fund's active vehicles as { name, id }, for the fund switcher and the sidebar's
// fund-first links. Distinct from /api/accounting/vehicles (names only), which external API
// keys and MCP configs already depend on and must keep its string[] shape.
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  return NextResponse.json(await listVehiclesWithId(admin, gate.fundId))
}
