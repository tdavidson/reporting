import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { loadEntityNames, loadOwnership } from '@/lib/accounting/load'

// GET — LP entities with committed capital, for opening-balance entry and
// reconciliation (the LP list is known before any postings exist).
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const [names, ownership] = await Promise.all([
    loadEntityNames(admin, gate.fundId),
    loadOwnership(admin, gate.fundId),
  ])

  const commitment = new Map(ownership.map(o => [o.lpEntityId, o.commitment]))
  const rows = Array.from(names.entries())
    .map(([lpEntityId, name]) => ({ lpEntityId, name, commitment: commitment.get(lpEntityId) ?? 0 }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json(rows)
}
