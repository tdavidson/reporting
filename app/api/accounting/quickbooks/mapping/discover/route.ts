import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts).
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { ensureInvestmentAccounts } from '@/lib/accounting/investments'

/**
 * Holding discovery: create a fund holding for each underlying fund found in the QuickBooks
 * chart, and give it the per-holding account triplet the ledger posts against.
 *
 * A fund of funds keeps a QuickBooks sub-account per underlying fund
 * ("Investments:Acme Ventures III"), so the mapping screen is where the twenty-odd holdings
 * get created. Re-runnable: a name that already exists is reported as existing, never
 * duplicated — discovery runs again on every re-import pass.
 *
 * POST — { group?, holdings: string[] }
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const names: string[] = Array.isArray(body?.holdings)
    ? body.holdings.filter((n: unknown): n is string => typeof n === 'string' && n.trim().length > 0)
        .map((n: string) => n.trim())
    : []
  if (names.length === 0) return NextResponse.json({ error: 'holdings[] is required' }, { status: 400 })

  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? null)
  if (group instanceof NextResponse) return group

  // Match case-insensitively against EVERY holding, not just fund ones: if the name already
  // exists as a company, creating a second row with the same name would split its history.
  const { data: existingRows } = await admin
    .from('companies').select('id, name, holding_type').eq('fund_id', gate.fundId)
  const byName = new Map(
    ((existingRows as any[]) ?? []).map(r => [String(r.name).trim().toLowerCase(), r]),
  )

  const created: { id: string; name: string }[] = []
  const existing: { name: string; holdingType: string }[] = []
  const errors: string[] = []

  for (const name of names) {
    const hit = byName.get(name.toLowerCase())
    if (hit) { existing.push({ name: hit.name, holdingType: hit.holding_type }); continue }

    const { data: holding, error } = await admin
      .from('companies')
      .insert({
        fund_id: gate.fundId, name, holding_type: 'fund', status: 'active',
        portfolio_group: [group],
      })
      .select('id, name').single()
    if (error || !holding) { errors.push(`${name}: ${error?.message ?? 'insert failed'}`); continue }

    const { error: termErr } = await (admin as any).from('fund_holding_terms').insert({
      fund_id: gate.fundId, company_id: holding.id, commitment: 0,
    })
    if (termErr) errors.push(`${name}: terms — ${termErr.message}`)

    created.push({ id: holding.id, name: holding.name })
  }

  // Give every newly created holding its 1100/1200 account pair, so the imported entries have
  // somewhere to land and the period-end mark has a balance to compare against.
  if (created.length > 0) {
    try {
      await ensureInvestmentAccounts(admin, gate.fundId, group, created)
    } catch (e) {
      errors.push(`Could not create investment accounts: ${(e as Error).message}`)
    }
  }

  return NextResponse.json({ created, existing, errors })
}
