import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import {
  previewBootstrapInvestments, bootstrapInvestments, markInvestment, ledgerByCompany,
  previewInvestmentHistory, replayInvestmentHistory, revalueInvestmentFx,
} from '@/lib/accounting/investments'
import { buildSoiPositions, type SoiCompany } from '@/lib/accounting/soi'

// GET — each tracked position for the vehicle, alongside what the LEDGER carries for
// it. The gap between the two is what needs booking.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const [{ data: txns }, { data: companies }, ledger] = await Promise.all([
    admin.from('investment_transactions' as any).select('*').eq('fund_id', gate.fundId),
    admin.from('companies' as any).select('*').eq('fund_id', gate.fundId),
    ledgerByCompany(admin, gate.fundId, group),
  ])

  const positions = buildSoiPositions(
    ((txns as any[]) ?? []),
    ((companies as any[]) ?? []) as SoiCompany[],
    group,
  )

  const rows = positions.map(p => {
    const l = ledger.get(p.companyId)
    return {
      ...p,
      ledgerCost: l?.cost ?? 0,
      ledgerUnrealized: l?.unrealized ?? 0,
      ledgerFairValue: l?.carrying ?? 0,
      onLedger: !!l,
      tiesOut: !!l && Math.abs(l.cost - p.cost) < 0.005 && Math.abs(l.carrying - p.fairValue) < 0.005,
    }
  })

  return NextResponse.json({
    positions: rows,
    trackerCost: rows.reduce((s, r) => s + r.cost, 0),
    trackerFairValue: rows.reduce((s, r) => s + r.fairValue, 0),
    ledgerCost: rows.reduce((s, r) => s + r.ledgerCost, 0),
    ledgerFairValue: rows.reduce((s, r) => s + r.ledgerFairValue, 0),
  })
}

// POST
//   { action: 'preview',   offset }                          → what bootstrapping would book
//   { action: 'bootstrap', entryDate, offset, force? }       → book it
//   { action: 'mark', companyId, companyName, fairValue, entryDate, memo? }
//                                                            → mark ONE company (0 = write-off)
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

  const offset: 'cash' | 'capital' = body?.offset === 'capital' ? 'capital' : 'cash'

  if (body?.action === 'preview') {
    const result = await previewBootstrapInvestments(admin, gate.fundId, group, offset)
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  // Replay the tracker's DATED history — each purchase and each mark on the date it
  // actually happened, so the close allocates every gain to the period it belongs to.
  if (body?.action === 'previewHistory') {
    const result = await previewInvestmentHistory(admin, gate.fundId, group, { from: body?.from ?? null })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json(result)
  }

  if (body?.action === 'replayHistory') {
    const result = await replayInvestmentHistory(admin, gate.fundId, group, user.id, {
      from: body?.from ?? null,
      force: !!body?.force,
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...result })
  }

  // A rate move, not a mark. Books to 1250-<company> / 4300 so a currency swing is never
  // reported as investment performance.
  if (body?.action === 'fx') {
    const result = await revalueInvestmentFx(admin, gate.fundId, group, user.id, {
      companyId: body?.companyId,
      companyName: body?.companyName ?? 'Investment',
      delta: Number(body?.delta),
      entryDate: body?.entryDate,
      currency: body?.currency ?? null,
      priorRate: body?.priorRate ?? null,
      newRate: body?.newRate ?? null,
      memo: body?.memo ?? null,
      status: body?.status === 'draft' ? 'draft' : 'posted',
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...result })
  }

  if (body?.action === 'mark') {
    const result = await markInvestment(admin, gate.fundId, group, user.id, {
      companyId: body?.companyId,
      companyName: body?.companyName ?? 'Investment',
      fairValue: Number(body?.fairValue),
      entryDate: body?.entryDate,
      memo: body?.memo ?? null,
    })
    if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
    return NextResponse.json({ ok: true, ...result })
  }

  const result = await bootstrapInvestments(admin, gate.fundId, group, user.id, {
    entryDate: body?.entryDate,
    offset,
    force: !!body?.force,
  })
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })
  return NextResponse.json({ ok: true, ...result })
}
