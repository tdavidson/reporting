// Remove fiscal-period rows that overlap another period but hold nothing.
//
//   npx tsx --env-file=.env.local scripts/cleanup-orphan-periods.ts            # dry run, all vehicles
//   npx tsx --env-file=.env.local scripts/cleanup-orphan-periods.ts --apply
//   npx tsx --env-file=.env.local scripts/cleanup-orphan-periods.ts "<vehicle name>" --apply
//
// These appear when a period with a non-standard range (a December ending on the 30th) is
// superseded by the calendar-month close: `closePeriodWithAllocation` reuses a row only on an
// EXACT range match, so the old row is orphaned rather than replaced, leaving an OPEN period
// overlapping a CLOSED one with the same label. The close now cleans up after itself
// (`removeSupersededPeriods`); this clears what was left before that.
//
// Same narrow rules as the close, because deleting a fiscal period is not reversible:
// overlapping, NOT closed, no journal entry pointing at it, and no `close:<id>` entries.

import { createAdminClient } from '@/lib/supabase/admin'
import { ACTUAL_BOOK } from '@/lib/accounting/books'

const APPLY = process.argv.includes('--apply')
const vehicleArg = process.argv.slice(2).find(a => !a.startsWith('--'))

const admin: any = createAdminClient()

async function main() {
  let q = admin.from('fund_vehicles').select('id, fund_id, name').order('name')
  if (vehicleArg) q = q.eq('name', vehicleArg)
  const { data: vehicles } = await q
  const rows = (vehicles as any[]) ?? []
  if (rows.length === 0) { console.error(vehicleArg ? `No vehicle named ${vehicleArg}` : 'No vehicles'); process.exit(1) }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} vehicle${rows.length === 1 ? '' : 's'}\n`)
  let removed = 0
  let kept = 0

  for (const v of rows) {
    const { data: periods } = await admin.from('fiscal_periods')
      .select('id, period_start, period_end, label, status')
      .eq('fund_id', v.fund_id).eq('vehicle_id', v.id)
      .order('period_start', { ascending: true })
    const all = (periods as any[]) ?? []

    for (const p of all) {
      const overlaps = all.filter(o =>
        o.id !== p.id && o.period_start <= p.period_end && p.period_start <= o.period_end)
      if (overlaps.length === 0) continue
      if (p.status === 'closed') continue // real history — a human decides

      const [{ count: entryCount }, { count: closeCount }] = await Promise.all([
        admin.from('journal_entries').select('id', { count: 'exact', head: true }).eq('book', ACTUAL_BOOK)
          .eq('fund_id', v.fund_id).eq('period_id', p.id),
        admin.from('journal_entries').select('id', { count: 'exact', head: true }).eq('book', ACTUAL_BOOK)
          .eq('fund_id', v.fund_id).eq('source_ref', `close:${p.id}`),
      ])
      const label = `${v.name}: ${p.period_start} → ${p.period_end} [${p.status}] ${p.label ?? ''}`
      const against = overlaps.map(o => `${o.period_start}→${o.period_end} [${o.status}]`).join(', ')

      if ((entryCount ?? 0) > 0 || (closeCount ?? 0) > 0) {
        kept++
        console.log(`  KEEP    ${label} — overlaps ${against}, but holds ${entryCount} entries / ${closeCount} close entries`)
        continue
      }
      removed++
      console.log(`  ${APPLY ? 'DELETE ' : 'would delete'} ${label} — superseded by ${against}, holds nothing`)
      if (APPLY) await admin.from('fiscal_periods').delete().eq('id', p.id).eq('fund_id', v.fund_id)
    }
  }

  console.log(`\n${removed} orphan${removed === 1 ? '' : 's'}${APPLY ? ' removed' : ' would be removed'}` +
    (kept ? `, ${kept} overlapping row${kept === 1 ? '' : 's'} left alone (they hold data — look at those by hand)` : ''))
  if (!APPLY) console.log('Dry run only — nothing written. Re-run with --apply.')
}

main().catch(e => { console.error(e); process.exit(1) })
