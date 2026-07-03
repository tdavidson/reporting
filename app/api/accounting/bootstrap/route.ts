import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { loadOwnership } from '@/lib/accounting/load'
import { accountIdByCode, ensureCapitalAccounts, persistEntry } from '@/lib/accounting/persist'
import { DEFAULT_CHART } from '@/lib/accounting/chart'
import { roundCents } from '@/lib/accounting/ledger'
import type { Posting, JournalEntry } from '@/lib/accounting/types'

// POST — cutover bootstrap: generate the opening position for a vehicle from the
// LP data already in the platform (paid-in − distributions per LP), as of a date.
// Seeds the chart first if empty. Body: { entryDate, group? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const entryDate: string = body?.entryDate
  if (!entryDate) return NextResponse.json({ error: 'entryDate is required' }, { status: 400 })

  // Seed the default chart for this vehicle if it has none.
  let codes = await accountIdByCode(admin, gate.fundId, group)
  if (codes.size === 0) {
    const rows = DEFAULT_CHART.map(a => ({ fund_id: gate.fundId, portfolio_group: group, code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null }))
    await admin.from('chart_of_accounts' as any).insert(rows)
    codes = await accountIdByCode(admin, gate.fundId, group)
  }

  const ownership = await loadOwnership(admin, gate.fundId, group)
  const balances = ownership
    .map(o => ({ lpEntityId: o.lpEntityId, amount: roundCents(o.paidIn - o.distributions) }))
    .filter(b => b.amount !== 0)
  if (balances.length === 0) {
    return NextResponse.json({ error: 'No LP paid-in capital found for this vehicle — nothing to bootstrap' }, { status: 400 })
  }

  const offsetId = codes.get('1100') // investments at cost, the opening asset placeholder
  if (!offsetId) return NextResponse.json({ error: 'Chart missing account 1100' }, { status: 400 })
  const capMap = await ensureCapitalAccounts(admin, gate.fundId, group, balances.map(b => b.lpEntityId))

  let total = 0
  const postings: Posting[] = []
  for (const b of balances) {
    total = roundCents(total + b.amount)
    postings.push({ accountId: capMap.get(b.lpEntityId)!, amount: -b.amount, currency: 'USD', lpEntityId: b.lpEntityId })
  }
  postings.push({ accountId: offsetId, amount: total, currency: 'USD', lpEntityId: null })

  const entry: JournalEntry = { fundId: gate.fundId, entryDate, memo: 'Opening balances bootstrapped from LP data', sourceType: 'opening_balance', postings }
  const result = await persistEntry(admin, gate.fundId, group, user.id, entry, 'posted')
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  return NextResponse.json({ ok: true, entryId: result.entryId, lpCount: balances.length, total })
}
