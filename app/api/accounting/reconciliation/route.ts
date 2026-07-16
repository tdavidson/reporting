import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// lp_capital domain (lib/access/route-domains.ts) — it returns per-LP capital with names. The
// middleware has already checked the caller's grant for this route + method.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadPostedLedger, loadEntityNames, loadOwnership } from '@/lib/accounting/load'
import { computeCapitalAccounts } from '@/lib/accounting/capital-account'
import { reconcileCapital, type AdminCapitalAccount } from '@/lib/accounting/reconcile'

// GET — the LP snapshot figures already in the platform, shaped as admin capital
// accounts (contributions = paid-in, distributions) to prefill the reconcile.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const [ownership, names] = await Promise.all([loadOwnership(admin, gate.fundId, group), loadEntityNames(admin, gate.fundId, group)])
  const snapshot: Record<string, AdminCapitalAccount> = {}
  for (const o of ownership) {
    snapshot[o.lpEntityId] = { contributions: o.paidIn, distributions: -Math.abs(o.distributions) }
  }
  return NextResponse.json({ snapshot, names: Object.fromEntries(names) })
}

// POST — reconcile the vehicle's capital accounts against admin figures.
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const adminInput = (body?.admin ?? {}) as Record<string, AdminCapitalAccount>
  const tolerance = typeof body?.tolerance === 'number' ? body.tolerance : 0.01
  const adminMap = new Map<string, AdminCapitalAccount>(Object.entries(adminInput))

  const [{ capitalPostings }, names] = await Promise.all([
    loadPostedLedger(admin, gate.fundId, group),
    loadEntityNames(admin, gate.fundId, group),
  ])
  const ledger = computeCapitalAccounts(capitalPostings)
  const result = reconcileCapital(ledger, adminMap, tolerance)
  return NextResponse.json({ ...result, names: Object.fromEntries(names) })
}
