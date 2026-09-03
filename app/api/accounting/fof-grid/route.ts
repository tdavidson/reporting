import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the grant.
import { assertReadAccess, assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { loadFofData } from '@/lib/portfolio/fof-load'
import { managerTieOut } from '@/lib/portfolio/fof-valuation'
import { parseFofPaste, matchHoldings } from '@/lib/portfolio/fof-paste'

// The quarterly grid: one row per fund holding, prefilled from the register.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const asOf = req.nextUrl.searchParams.get('asOf') ?? new Date().toISOString().slice(0, 10)
  const fof = await loadFofData(admin, gate.fundId, asOf)

  return NextResponse.json({
    asOf,
    positions: fof.positions,
    tieOut: managerTieOut(fof.positions, fof.managerFigures),
  })
}

/**
 * POST — the paste path, in two steps.
 *
 * Without `apply`, this is a PREVIEW: it parses, matches, and returns what it found without
 * writing anything. Unmatched fund names come back by name so the user can see them; matching
 * is exact-or-alias only, so an unrecognised manager is a review item rather than a wrong
 * position silently credited.
 *
 * With `apply: true`, the matched rows are written as DRAFT register rows. Nothing posts to
 * the ledger until they are confirmed (POST /confirm).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  // Two ways in, ONE write path. `text` is the paste grid; `rows` is a set already matched
  // upstream — today that is the statement extractor, which proposes but never writes. Both
  // land in the same insert block below, so there is no second route into the register.
  const preMatched = Array.isArray(body?.rows) ? body.rows : null
  if (!preMatched && (typeof body?.text !== 'string' || !body.text.trim())) {
    return NextResponse.json({ error: 'Paste something first.' }, { status: 400 })
  }
  const periodEnd = typeof body?.periodEnd === 'string'
    ? body.periodEnd
    : new Date().toISOString().slice(0, 10)

  const { data: holdings } = await admin
    .from('companies').select('id, name, aliases')
    .eq('fund_id', gate.fundId).eq('holding_type', 'fund')

  const { rows, errors } = preMatched
    ? { rows: [], errors: [] as string[] }
    : parseFofPaste(body.text)
  const matched = preMatched
    // Re-match by name rather than trusting a companyId the caller supplied: the row came
    // from outside, and an id is not something to take on faith just because it parsed.
    ? matchHoldings(
        preMatched.map((r: any) => ({
          fundName: String(r.fundName ?? r.matchedName ?? ''),
          navAsOf: r.navAsOf ?? null,
          reportedNav: r.reportedNav ?? null,
          calls: Number(r.calls ?? 0),
          distributions: Number(r.distributions ?? 0),
        })),
        ((holdings as any[]) ?? []).map(h => ({ id: h.id, name: h.name, aliases: h.aliases })),
      )
    : matchHoldings(rows, ((holdings as any[]) ?? []).map(h => ({
        id: h.id, name: h.name, aliases: h.aliases,
      })))

  const unmatched = matched.filter(m => !m.companyId).map(m => m.row.fundName)
  const hits = matched.filter(m => m.companyId)

  if (!body?.apply) {
    return NextResponse.json({
      preview: true,
      matched: hits.map(m => ({ companyId: m.companyId, matchedName: m.matchedName, ...m.row })),
      unmatched,
      errors,
    })
  }

  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? null)
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const eventRows: any[] = []
  const navRows: any[] = []
  for (const m of hits) {
    const base = {
      fund_id: gate.fundId, vehicle_id: vehicleId, company_id: m.companyId,
      event_date: periodEnd, status: 'draft',
      source: preMatched ? 'extracted' : 'grid', created_by: user.id,
    }
    // A pasted call carries no purpose breakdown, so the whole amount is investments —
    // transactionForEvent requires the split to reconcile to the amount, and defaulting to
    // zero would make every pasted row fail at confirm time.
    if (m.row.calls > 0) {
      eventRows.push({
        ...base, kind: 'call', amount: m.row.calls,
        purpose_investments: m.row.calls, purpose_fees: 0, purpose_expenses: 0,
      })
    }
    // Likewise a pasted distribution defaults to pure return of capital. That UNDERSTATES
    // realized gain until someone sets the character split — the UI says so.
    if (m.row.distributions > 0) {
      eventRows.push({
        ...base, kind: 'distribution', amount: m.row.distributions,
        char_return_of_capital: m.row.distributions, char_realized_gain: 0, char_income: 0,
      })
    }
    if (m.row.reportedNav !== null && m.row.navAsOf) {
      navRows.push({
        fund_id: gate.fundId, vehicle_id: vehicleId, company_id: m.companyId,
        as_of_date: m.row.navAsOf, reported_nav: m.row.reportedNav,
        basis: 'final', source: preMatched ? 'extracted' : 'grid', created_by: user.id,
      })
    }
  }

  const writeErrors: string[] = []
  if (eventRows.length > 0) {
    const { error } = await (admin as any).from('fund_capital_events').insert(eventRows)
    if (error) writeErrors.push(error.message)
  }
  if (navRows.length > 0) {
    const { error } = await (admin as any)
      .from('fund_nav_statements').upsert(navRows, { onConflict: 'company_id,as_of_date' })
    if (error) writeErrors.push(error.message)
  }

  return NextResponse.json({
    applied: true,
    eventsCreated: writeErrors.length ? 0 : eventRows.length,
    navStatements: writeErrors.length ? 0 : navRows.length,
    unmatched,
    errors: [...errors, ...writeErrors],
  })
}
