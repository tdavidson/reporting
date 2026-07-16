import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { dbError } from '@/lib/api-error'
// lp_capital domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; this resolves identity and keeps the demo out of writes.
import { assertWriteAccess } from '@/lib/api-helpers'
import { generateLiveReport } from '@/lib/accounting/live-report'

// Freeze the LIVE LP report into a snapshot, so it can be SHARED with LPs.
//
// The portal is document-based: an LP is shown a fixed statement, not a moving target. So to
// "share the live report" you first freeze it — this creates an `lp_snapshots` row and writes
// the current live figures into `lp_investments` for it. The caller then shares that snapshot
// through the normal snapshot share/send flow. Nothing about the live data changes.
//
// POST { name?, asOfDate? } → { snapshotId, name }

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const asOf = (typeof body?.asOfDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.asOfDate)) ? body.asOfDate : undefined

  const report = await generateLiveReport(admin, gate.fundId, asOf)
  const asOfDate = report.asOf ?? new Date().toISOString().slice(0, 10)
  const name = String(body?.name ?? '').trim() || `Live report — ${asOfDate}`

  // Carry the fund-level live report header/footer onto the frozen snapshot.
  const { data: fs } = await (admin as any)
    .from('fund_settings').select('lp_report_description, lp_report_footer').eq('fund_id', gate.fundId).maybeSingle()

  // Reuse a single snapshot per name rather than minting a new one on every click. Freezing is a
  // side effect of opening the Share dialog, so a GP who clicks Share (or cancels and re-clicks)
  // must not litter the archive with duplicate "Live report — <date>" snapshots. lp_snapshots is
  // UNIQUE (fund_id, name), so we upsert by name: refresh the existing one (keeping its id, and
  // therefore its existing LP shares) and replace its rows, or insert if it's the first time.
  const snapPayload = {
    fund_id: gate.fundId, name, as_of_date: asOfDate,
    description: (fs as any)?.lp_report_description ?? null,
    footer_note: (fs as any)?.lp_report_footer ?? null,
  }
  const { data: existing } = await (admin as any)
    .from('lp_snapshots').select('id').eq('fund_id', gate.fundId).eq('name', name).maybeSingle()

  let snap: { id: string; name: string } | null = null
  if (existing?.id) {
    await (admin as any).from('lp_snapshots').update(snapPayload).eq('id', existing.id).eq('fund_id', gate.fundId)
    await (admin as any).from('lp_investments').delete().eq('fund_id', gate.fundId).eq('snapshot_id', existing.id)
    snap = { id: existing.id, name }
  } else {
    const { data: inserted, error: snapErr } = await (admin as any)
      .from('lp_snapshots').insert(snapPayload).select('id, name').single()
    if (snapErr || !inserted) return snapErr ? dbError(snapErr, 'from-live') : NextResponse.json({ error: 'Could not create snapshot' }, { status: 500 })
    snap = inserted
  }
  if (!snap) return NextResponse.json({ error: 'Could not create snapshot' }, { status: 500 })

  // Write the live figures into the snapshot. Look-through member rows carry a synthetic
  // portfolio_group tag; store them as-is so the snapshot matches what the live report showed.
  const rows = report.rows.map(r => ({
    fund_id: gate.fundId,
    snapshot_id: snap.id,
    entity_id: r.entity_id,
    portfolio_group: r.portfolio_group,
    commitment: r.commitment,
    called_capital: r.called_capital,
    paid_in_capital: r.paid_in_capital,
    distributions: r.distributions,
    nav: r.nav,
    total_value: r.total_value,
    outstanding_balance: r.outstanding_balance,
    dpi: r.dpi, rvpi: r.rvpi, tvpi: r.tvpi, irr: r.irr,
  }))
  if (rows.length > 0) {
    const { error: invErr } = await (admin as any).from('lp_investments').insert(rows)
    if (invErr) { console.error('[from-live] rows insert', invErr.message); return NextResponse.json({ error: 'Could not write the report rows.', snapshotId: snap.id }, { status: 500 }) }
  }

  return NextResponse.json({ snapshotId: snap.id, name: snap.name })
}
