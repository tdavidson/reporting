import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger, loadEntityNames } from '@/lib/accounting/load'
import { computeCapitalAccounts, totalNav } from '@/lib/accounting/capital-account'

// GET — per-LP capital-account roll-forward for a vehicle, derived from posted entries.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const asOf = req.nextUrl.searchParams.get('asOf') || undefined

  const [{ capitalPostings }, names] = await Promise.all([
    loadPostedLedger(admin, gate.fundId, group, asOf),
    loadEntityNames(admin, gate.fundId, group),
  ])

  const accounts = computeCapitalAccounts(capitalPostings)
  const rows = Array.from(accounts.entries())
    .map(([lpEntityId, account]) => ({ lpEntityId, name: names.get(lpEntityId) ?? lpEntityId, ...account }))
    .sort((a, b) => a.name.localeCompare(b.name))

  return NextResponse.json({ rows, nav: totalNav(accounts) })
}
