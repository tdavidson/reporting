import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadEntityNames, loadOwnership } from '@/lib/accounting/load'

// GET — a vehicle's LP entities with committed capital.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const [names, ownership] = await Promise.all([
    loadEntityNames(admin, gate.fundId, group),
    loadOwnership(admin, gate.fundId, group),
  ])
  const own = new Map(ownership.map(o => [o.lpEntityId, o]))
  const rows = Array.from(names.entries())
    .map(([lpEntityId, name]) => ({ lpEntityId, name, commitment: own.get(lpEntityId)?.commitment ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json(rows)
}
