// GET /api/lps/live-report
//
// Derives the LP capital report from the books (ledger vehicles) and lp_capital_events
// (unbooked vehicles), and — when given a snapshotId — diffs it against that stored
// snapshot's rows.
//
// This WRITES NOTHING. The stored snapshot is the baseline being checked, so touching it
// would destroy the thing we're measuring against. Where live and stored disagree, either
// the books are incomplete for that vehicle or the snapshot has drifted; the variance tells
// you which rows to look at, not which side is right.
//
//   ?snapshotId=<uuid>  compare against this snapshot (uses its as_of_date as the live date)
//   ?asOf=YYYY-MM-DD    live report as of this date (ignored when snapshotId is given)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'
import { generateLiveReport, type LiveInvestmentRow } from '@/lib/accounting/live-report'

/** The metric columns we can meaningfully compare. `irr` is excluded — the live path does
 *  not compute it yet, and a null-vs-imported diff would be noise, not signal. */
const COMPARED = [
  'commitment',
  'called_capital',
  'paid_in_capital',
  'distributions',
  'nav',
  'total_value',
] as const

type Compared = (typeof COMPARED)[number]

export interface CompareRow {
  entity_id: string
  entity_name: string
  portfolio_group: string
  source: 'ledger' | 'events' | null
  /** 'both' | 'live_only' (books have an LP the snapshot doesn't) | 'stored_only' (vice versa) */
  presence: 'both' | 'live_only' | 'stored_only'
  live: Partial<Record<Compared, number | null>>
  stored: Partial<Record<Compared, number | null>>
  /** live - stored, per column. Null when either side is absent. */
  delta: Partial<Record<Compared, number | null>>
  /** True when any compared column differs by more than a cent. */
  differs: boolean
}

const key = (entityId: string, group: string) => `${entityId}::${group.trim().toLowerCase()}`
const num = (v: any): number | null => (v == null ? null : Number(v))

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ADMIN (or the read-only demo viewer), same as every accounting route.
  //
  // This gate used to be membership-only. That let a plain `member` — who is 403'd from
  // /api/accounting/capital-accounts and /api/accounting/lp-statement — call this instead and
  // receive every LP's name, commitment, paid-in, distributions, NAV, DPI/TVPI and IRR, computed
  // live from the very ledger they are denied. It also reaches through the associates
  // look-through, exposing each GP/associate member's individual share.
  //
  // This route pipes LEDGER data, so it takes the ledger's posture.
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const fundId = gate.fundId

  const snapshotId = req.nextUrl.searchParams.get('snapshotId')
  let asOf = req.nextUrl.searchParams.get('asOf') || undefined
  let snapshotName: string | null = null

  // A snapshot pins the date: comparing a snapshot dated 2026-03-31 against a live report
  // dated today would show every subsequent transaction as a "variance", which is worse than
  // useless — it would bury the real breaks.
  if (snapshotId) {
    const { data: snap, error } = await admin
      .from('lp_snapshots' as any)
      .select('id, name, as_of_date')
      .eq('id', snapshotId)
      .eq('fund_id', fundId)
      .maybeSingle() as { data: any; error: any }
    if (error) return dbError(error, 'live-report-snapshot')
    if (!snap) return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 })
    snapshotName = snap.name
    asOf = snap.as_of_date || undefined
  }

  // An `asOf` that isn't a date reaches Postgres and comes back as raw error text. Reject it here.
  if (asOf && !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return NextResponse.json({ error: 'asOf must be YYYY-MM-DD.' }, { status: 400 })
  }

  let live
  try {
    live = await generateLiveReport(admin, fundId, asOf)
  } catch (e) {
    // Log the detail; don't hand internals (or Postgres error text) to the client.
    console.error('[live-report]', e)
    return NextResponse.json({ error: 'Could not build the report.' }, { status: 500 })
  }

  // No snapshot to compare against — just hand back the live report.
  //
  // Rows carry their investor as well as their entity: an LP report is aggregated per
  // INVESTOR (who may hold through several entities, across several vehicles), so the client
  // needs the mapping to roll up. Ratios are always computed AFTER the sum, never averaged
  // from per-row ratios — that's the convention every existing read path uses.
  if (!snapshotId) {
    const { data: entRows } = await admin
      .from('lp_entities' as any)
      .select('id, entity_name, investor_id, lp_investors!inner(id, name)')
      .eq('fund_id', fundId) as { data: any[] | null }

    const investorByEntity = new Map<string, { id: string; name: string }>()
    for (const e of (entRows ?? [])) {
      if (e.lp_investors) investorByEntity.set(e.id, { id: e.lp_investors.id, name: e.lp_investors.name })
    }

    return NextResponse.json({
      asOf: live.asOf,
      vehicles: live.vehicles,
      rows: live.rows.map(r => {
        const inv = investorByEntity.get(r.entity_id)
        return {
          ...r,
          entity_name: live.entityNames.get(r.entity_id) ?? r.entity_id,
          investor_id: inv?.id ?? r.entity_id,
          investor_name: inv?.name ?? live.entityNames.get(r.entity_id) ?? r.entity_id,
        }
      }),
    })
  }

  const { data: storedRows, error: storedErr } = await admin
    .from('lp_investments' as any)
    .select('entity_id, portfolio_group, commitment, called_capital, paid_in_capital, distributions, nav, total_value, calc_generated, lp_entities!inner(entity_name)')
    .eq('fund_id', fundId)
    .eq('snapshot_id', snapshotId) as { data: any[] | null; error: any }
  if (storedErr) return dbError(storedErr, 'live-report-stored')

  const liveByKey = new Map<string, LiveInvestmentRow>()
  for (const r of live.rows) liveByKey.set(key(r.entity_id, r.portfolio_group), r)

  const storedByKey = new Map<string, any>()
  for (const r of (storedRows ?? [])) storedByKey.set(key(r.entity_id, r.portfolio_group), r)

  const nameOf = (entityId: string, stored: any): string =>
    live.entityNames.get(entityId) ?? stored?.lp_entities?.entity_name ?? entityId

  const rows: CompareRow[] = []
  for (const k of Array.from(new Set([...Array.from(liveByKey.keys()), ...Array.from(storedByKey.keys())]))) {
    const l = liveByKey.get(k)
    const s = storedByKey.get(k)
    const entityId = (l?.entity_id ?? s?.entity_id) as string
    const group = (l?.portfolio_group ?? s?.portfolio_group) as string

    const liveVals: CompareRow['live'] = {}
    const storedVals: CompareRow['stored'] = {}
    const delta: CompareRow['delta'] = {}
    let differs = false

    for (const c of COMPARED) {
      const lv = l ? num((l as any)[c]) : null
      const sv = s ? num(s[c]) : null
      liveVals[c] = lv
      storedVals[c] = sv
      if (lv != null && sv != null) {
        const d = Math.round((lv - sv) * 100) / 100
        delta[c] = d
        if (Math.abs(d) > 0.01) differs = true
      } else {
        delta[c] = null
      }
    }

    const presence: CompareRow['presence'] = l && s ? 'both' : l ? 'live_only' : 'stored_only'
    if (presence !== 'both') differs = true

    rows.push({
      entity_id: entityId,
      entity_name: nameOf(entityId, s),
      portfolio_group: group,
      source: l?.source ?? null,
      presence,
      live: liveVals,
      stored: storedVals,
      delta,
      differs,
    })
  }

  rows.sort((a, b) =>
    a.portfolio_group.localeCompare(b.portfolio_group) || a.entity_name.localeCompare(b.entity_name)
  )

  return NextResponse.json({
    snapshotId,
    snapshotName,
    asOf: live.asOf,
    vehicles: live.vehicles,
    compared: COMPARED,
    summary: {
      total: rows.length,
      differing: rows.filter(r => r.differs).length,
      liveOnly: rows.filter(r => r.presence === 'live_only').length,
      storedOnly: rows.filter(r => r.presence === 'stored_only').length,
    },
    rows,
  })
}
