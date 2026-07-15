import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { rateLimit } from '@/lib/rate-limit'
import {
  parseLpData, resolveOrCreateEntity, loadEntityCaches, toSafeNumber, MAX_LP_IMPORT_SIZE,
} from '@/lib/lp-import/parse'

// Paste a spreadsheet of LP positions into a vehicle, as of a date.
//
// This is the capital-tracking import: it writes dated cumulative positions (lp_positions),
// which is what the vehicle's capital accounts derive from when there is no ledger. The
// pasted figures are stored verbatim — commitment, called/paid-in, distributions, NAV — for
// (vehicle, as_of_date); re-pasting a date replaces it. Movements are derived at read time by
// diffing dates, so nothing here needs decomposing.
//
// It also refreshes `commitment_events` from the pasted commitments, so the commitment shown
// on the ledger side and in reports stays consistent with the latest paste.
//
// POST { group, asOfDate, data }  — `data` is the pasted text; the AI maps the columns.

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group)
  if (group instanceof NextResponse) return group

  const asOfDate = String(body?.asOfDate ?? '')
  if (!ISO.test(asOfDate)) return NextResponse.json({ error: 'asOfDate (YYYY-MM-DD) is required' }, { status: 400 })

  const rawData = body?.data
  if (!rawData || typeof rawData !== 'string') return NextResponse.json({ error: 'data is required (paste spreadsheet content)' }, { status: 400 })
  if (rawData.length > MAX_LP_IMPORT_SIZE) return NextResponse.json({ error: 'Input too large. Maximum 500KB.' }, { status: 400 })

  const limited = await rateLimit({ key: `lp-positions-import:${user.id}`, limit: 10, windowSeconds: 300 })
  if (limited) return limited

  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)
  if (!vehicleId) return NextResponse.json({ error: 'Unknown vehicle' }, { status: 400 })

  // Parse.
  let rows
  try {
    rows = await parseLpData(admin, gate.fundId, user.id, rawData)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Parse failed' }, { status: 500 })
  }

  const caches = await loadEntityCaches(admin, gate.fundId)
  const errors: string[] = []
  const positionRows: any[] = []
  const commitmentByEntity = new Map<string, number>()

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.investor_name?.trim()) { errors.push(`Row ${i + 1}: missing investor name`); continue }
    const investorName = r.investor_name.trim().slice(0, 500)
    const entityName = (r.entity_name?.trim() || investorName).slice(0, 500)

    const entityId = await resolveOrCreateEntity(admin, gate.fundId, investorName, entityName, caches)
    if (!entityId) { errors.push(`Row ${i + 1}: could not resolve entity "${entityName}"`); continue }

    const called = toSafeNumber(r.paid_in_capital ?? r.called_capital)
    const commitment = toSafeNumber(r.commitment)
    positionRows.push({
      fund_id: gate.fundId,
      vehicle_id: vehicleId,
      lp_entity_id: entityId,
      as_of_date: asOfDate,
      commitment,
      called_capital: called,
      distributions: toSafeNumber(r.distributions),
      // NAV is the reliable primitive; total_value is not stored. Only derive NAV from
      // total_value when NAV itself wasn't given.
      nav: r.nav != null ? toSafeNumber(r.nav)
        : (r.total_value != null ? toSafeNumber(Number(r.total_value) - (Number(r.distributions) || 0)) : null),
      irr: toSafeNumber(r.irr),
      source: 'paste',
      imported_by: user.id,
      imported_at: new Date().toISOString(),
    })
    if (commitment != null && commitment > 0) commitmentByEntity.set(entityId, commitment)
  }

  if (positionRows.length === 0) {
    return NextResponse.json({ error: 'No valid rows parsed.', errors }, { status: 400 })
  }

  // Replace this date's positions for the vehicle (clean upsert by the unique key).
  const entityIds = positionRows.map(r => r.lp_entity_id)
  await (admin as any).from('lp_positions')
    .delete().eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId).eq('as_of_date', asOfDate)
    .in('lp_entity_id', entityIds)
  const { error: insErr } = await (admin as any).from('lp_positions').insert(positionRows)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  // Keep commitment_events in step with the pasted commitments, so the ledger side and the
  // reports don't lag a paste. Only creates an `initial` delta where none exists — commitment
  // history/transfers are managed elsewhere and not clobbered here.
  const { data: existingCommit } = await (admin as any)
    .from('commitment_events').select('lp_entity_id').eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
  const haveCommit = new Set(((existingCommit as any[]) ?? []).map(e => e.lp_entity_id as string))
  const newCommitRows = Array.from(commitmentByEntity.entries())
    .filter(([id]) => !haveCommit.has(id))
    .map(([id, amount]) => ({
      fund_id: gate.fundId, vehicle_id: vehicleId, lp_entity_id: id,
      effective_date: asOfDate, amount, kind: 'initial', memo: 'From pasted positions',
    }))
  if (newCommitRows.length > 0) {
    await (admin as any).from('commitment_events').insert(newCommitRows)
  }

  return NextResponse.json({
    ok: true,
    asOfDate,
    vehicle: group,
    written: positionRows.length,
    commitmentsCreated: newCommitRows.length,
    errors,
  })
}
