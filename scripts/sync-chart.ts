// Backfill the standard chart of accounts onto existing vehicles.
//
//   npx tsx --env-file=.env.local scripts/sync-chart.ts                       # dry run, all vehicles
//   npx tsx --env-file=.env.local scripts/sync-chart.ts --apply
//   npx tsx --env-file=.env.local scripts/sync-chart.ts "<vehicle name>" --apply
//
// The same additive logic as POST /api/accounting/chart, runnable without the UI — the Setup
// page hides its tools once a vehicle counts as onboarded, which is exactly when a NEW standard
// account (2300 Distributions payable, say) needs backfilling onto an old vehicle.
//
// Only ever inserts accounts the vehicle is missing. Existing and custom accounts are untouched.

import { createAdminClient } from '@/lib/supabase/admin'
import { DEFAULT_CHART, GP_ENTITY_CHART } from '@/lib/accounting/chart'

const APPLY = process.argv.includes('--apply')
const vehicleArg = process.argv.slice(2).find(a => !a.startsWith('--'))

const admin: any = createAdminClient()

async function main() {
  let q = admin.from('fund_vehicles').select('id, fund_id, name, kind').order('name')
  if (vehicleArg) q = q.eq('name', vehicleArg)
  const { data: vehicles } = await q
  const rows = (vehicles as any[]) ?? []
  if (rows.length === 0) { console.error(vehicleArg ? `No vehicle named ${vehicleArg}` : 'No vehicles'); process.exit(1) }

  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${rows.length} vehicle${rows.length === 1 ? '' : 's'}\n`)
  let added = 0

  for (const v of rows) {
    // A vehicle with NO chart has never been onboarded; seeding it here would quietly turn on
    // accounting for it. Skip — that is what the Setup flow is for.
    const { data: existing } = await admin.from('chart_of_accounts')
      .select('code').eq('fund_id', v.fund_id).eq('vehicle_id', v.id)
    const have = new Set(((existing as any[]) ?? []).map((r: any) => r.code as string))
    if (have.size === 0) continue

    const chart = v.kind === 'associate' ? GP_ENTITY_CHART : DEFAULT_CHART
    const missing = chart.filter(a => !have.has(a.code))
    if (missing.length === 0) continue

    console.log(`  ${v.name}: ${missing.map(m => `${m.code} ${m.name}`).join(', ')}`)
    added += missing.length
    if (APPLY) {
      const insert = missing.map(a => ({
        fund_id: v.fund_id, portfolio_group: v.name, vehicle_id: v.id,
        code: a.code, name: a.name, type: a.type, subtype: a.subtype ?? null,
      }))
      const { error } = await admin.from('chart_of_accounts').insert(insert)
      if (error) { console.error(`    FAILED: ${error.message}`); process.exit(1) }
    }
  }

  console.log(`\n${added} account${added === 1 ? '' : 's'}${APPLY ? ' added' : ' would be added'}`)
  if (!APPLY) console.log('Dry run only — nothing written. Re-run with --apply.')
}

main().catch(e => { console.error(e); process.exit(1) })
