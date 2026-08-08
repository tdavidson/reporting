import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { SupabaseClient } from '@supabase/supabase-js'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { buildSoiPositions, type SoiCompany } from '@/lib/accounting/soi'
import { fundEconomics } from '@/lib/accounting/fund-economics'
import {
  runForecast, forecastLedgerText, defaultAssumptions,
  type ForecastAssumptions, type ForecastFundBase, type ForecastPosition, type ForecastTier,
} from '@/lib/accounting/forecast'

// Monte Carlo forecast for a vehicle: existing positions + a forecast pipeline of new
// investments (plans/plan-accounting-forecasting.md).
//
//   GET    ?group=…                        → { positions, base, defaults, scenarios }
//   POST   { group, assumptions, seed?, iterations?, multipleSigma? }
//                                          → run the simulation, return distributions +
//                                            the expected path + a plain-text journal preview
//   POST   { group, action: 'save', name, assumptions, seed }
//                                          → save/update a named scenario (admin only)
//   DELETE ?group=…&id=…                   → remove a scenario (admin only)
//
// Positions and fund figures are ALWAYS loaded server-side from the caller's fund — the
// client sends assumptions, never data.

async function loadInputs(admin: SupabaseClient, fundId: string, group: string): Promise<{
  positions: ForecastPosition[]
  base: ForecastFundBase
}> {
  const [{ data: txns }, { data: companies }, vehicles] = await Promise.all([
    admin.from('investment_transactions' as any).select('*').eq('fund_id', fundId),
    admin.from('companies' as any).select('*').eq('fund_id', fundId),
    fundEconomics(admin, fundId),
  ])

  const soi = buildSoiPositions(
    ((txns as any[]) ?? []),
    ((companies as any[]) ?? []) as SoiCompany[],
    group,
  )
  const positions: ForecastPosition[] = soi.map(p => ({
    name: p.name, companyId: p.companyId, fairValue: p.fairValue, cost: p.cost,
  }))

  const econ = vehicles.find(v => v.vehicle === group)
  const base: ForecastFundBase = {
    committed: econ?.fund.committed ?? 0,
    paidIn: econ?.fund.paidIn ?? 0,
    distributions: econ?.fund.distributions ?? 0,
  }
  return { positions, base }
}

// ── Assumption parsing: everything clamped, nothing trusted ──────────────────

const num = (v: unknown, lo: number, hi: number, dflt: number): number => {
  const n = Number(v)
  if (!Number.isFinite(n)) return dflt
  return Math.min(hi, Math.max(lo, n))
}

function parseTiers(v: unknown, dflt: ForecastTier[]): ForecastTier[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 8) return dflt
  const tiers = v.map(t => ({
    label: String((t as any)?.label ?? '').slice(0, 40) || 'Tier',
    pct: num((t as any)?.pct, 0, 1, 0),
    multiple: num((t as any)?.multiple, 0, 1000, 0),
  }))
  return tiers.some(t => t.pct > 0) ? tiers : dflt
}

function parseAssumptions(body: any, today: string): ForecastAssumptions {
  const d = defaultAssumptions(today)
  const a = body?.assumptions ?? {}
  const hold = (v: any, dflt: { minYears: number; maxYears: number }) => {
    const minYears = num(v?.minYears, 0.25, 20, dflt.minYears)
    return { minYears, maxYears: Math.max(minYears, num(v?.maxYears, 0.25, 20, dflt.maxYears)) }
  }
  return {
    asOf: /^\d{4}-\d{2}-\d{2}$/.test(String(a.asOf ?? '')) ? String(a.asOf) : today,
    horizonYears: num(a.horizonYears, 1, 20, d.horizonYears),
    existing: {
      tiers: parseTiers(a.existing?.tiers, d.existing.tiers),
      hold: hold(a.existing?.hold, d.existing.hold),
    },
    newInvestments: {
      count: Math.round(num(a.newInvestments?.count, 0, 500, 0)),
      averageCheck: num(a.newInvestments?.averageCheck, 0, 1e12, 0),
      deploymentYears: num(a.newInvestments?.deploymentYears, 0.25, 20, d.newInvestments.deploymentYears),
      tiers: parseTiers(a.newInvestments?.tiers, d.newInvestments.tiers),
      hold: hold(a.newInvestments?.hold, d.newInvestments.hold),
    },
    annualFeesPct: num(a.annualFeesPct, 0, 0.2, 0),
    feeYears: num(a.feeYears, 0, 20, 0),
  }
}

async function loadScenarios(admin: SupabaseClient, fundId: string, group: string) {
  const { data } = await (admin as any)
    .from('forecast_scenarios')
    .select('id, name, assumptions, seed, updated_at')
    .eq('fund_id', fundId).eq('portfolio_group', group)
    .order('updated_at', { ascending: false })
  return (data as any[]) ?? []
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const today = new Date().toISOString().slice(0, 10)
  const [{ positions, base }, scenarios] = await Promise.all([
    loadInputs(admin, gate.fundId, group),
    loadScenarios(admin, gate.fundId, group),
  ])

  // Pre-fill the fee drag only when the vehicle has committed capital to charge it on.
  const defaults = defaultAssumptions(today)
  if (base.committed > 0) {
    defaults.annualFeesPct = 0.02
    defaults.feeYears = 5
  }

  return NextResponse.json({ vehicle: group, positions, base, defaults, scenarios })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const action = String(body?.action ?? 'run')
  const today = new Date().toISOString().slice(0, 10)

  if (action === 'save') {
    const gate = await assertWriteAccess(admin, user.id)
    if (gate instanceof NextResponse) return gate
    const group = await resolveGroupOr400(admin, gate.fundId, body?.group)
    if (group instanceof NextResponse) return group
    const name = String(body?.name ?? '').trim().slice(0, 80)
    if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const assumptions = parseAssumptions(body, today)
    const seed = Math.round(num(body?.seed, 1, Number.MAX_SAFE_INTEGER, Date.now()))
    const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
    const { data, error } = await (admin as any)
      .from('forecast_scenarios')
      .upsert({
        fund_id: gate.fundId,
        vehicle_id: vehicleId,
        portfolio_group: group,
        name,
        assumptions,
        seed,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'fund_id,portfolio_group,name' })
      .select('id')
      .single()
    if (error) return dbError(error, 'accounting-forecast')
    return NextResponse.json({ ok: true, id: (data as any)?.id })
  }

  if (action !== 'run') return NextResponse.json({ error: `Unknown action "${action}"` }, { status: 400 })

  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group)
  if (group instanceof NextResponse) return group

  const assumptions = parseAssumptions(body, today)
  const seed = Math.round(num(body?.seed, 1, Number.MAX_SAFE_INTEGER, Date.now()))
  const iterations = Math.round(num(body?.iterations, 100, 10000, 2000))
  const multipleSigma = num(body?.multipleSigma, 0, 3, 1)

  try {
    const { positions, base } = await loadInputs(admin, gate.fundId, group)
    const result = runForecast(positions, base, assumptions, { iterations, seed, multipleSigma })
    return NextResponse.json({
      vehicle: group,
      assumptions,
      result,
      ledgerText: forecastLedgerText(result.expected),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await (admin as any)
    .from('forecast_scenarios').delete()
    .eq('fund_id', gate.fundId).eq('portfolio_group', group).eq('id', id)
  if (error) return dbError(error, 'accounting-forecast')
  return NextResponse.json({ ok: true })
}
