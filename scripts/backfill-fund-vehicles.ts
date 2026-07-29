// One-time backfill for the fund_vehicles registry + portfolio_group cleanup.
//
//   npx tsx --env-file=.env.local scripts/backfill-fund-vehicles.ts          # dry run
//   npx tsx --env-file=.env.local scripts/backfill-fund-vehicles.ts --apply  # write
//
// For each fund: seed the canonical vehicles, re-tag legacy portfolio_group
// strings (aliases → canonical) across every vehicle-scoped table, drop strays,
// and upsert fund_vehicles. Idempotent — safe to re-run.

import { readFileSync } from 'node:fs'
import { createAdminClient } from '@/lib/supabase/admin'

const APPLY = process.argv.includes('--apply')
const admin: any = createAdminClient()

interface VehicleDef { name: string; kind: 'fund' | 'spv' | 'direct' | 'associate' | 'other'; aliases?: string[] }
interface FundPlan { vehicles: VehicleDef[]; strays?: { table: string; value: string }[] }

// Funds needing merges/renames are described in a LOCAL, git-ignored file — a real vehicle
// registry names the firm, its funds and every SPV it holds, which is not something to commit.
// Without the file every fund is auto-derived from its existing distinct portfolio_group
// strings (no aliasing, no stray-dropping), which is the correct default for a fresh install.
//
//   scripts/vehicle-registry.local.json
//   {
//     "<fund name as stored in funds.name>": {
//       "vehicles": [
//         { "name": "<canonical vehicle>", "kind": "fund", "aliases": ["<legacy group string>"] }
//       ],
//       "strays": [{ "table": "fund_group_config", "value": "<group string to delete>" }]
//     }
//   }
const REGISTRY_PATH = new URL('./vehicle-registry.local.json', import.meta.url)

function loadExplicit(): Record<string, FundPlan> {
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')) as Record<string, FundPlan>
  } catch (e: any) {
    if (e?.code === 'ENOENT') {
      console.log('No scripts/vehicle-registry.local.json — auto-deriving every fund from its existing groups.\n')
      return {}
    }
    throw new Error(`Could not read scripts/vehicle-registry.local.json: ${e?.message ?? e}`)
  }
}

const EXPLICIT = loadExplicit()

// Every table with a scalar portfolio_group column that keys to a vehicle.
const SCALAR_TABLES = [
  'lp_investments', 'fund_cash_flows', 'fund_group_config', 'investment_transactions',
  'lp_letters', 'chart_of_accounts', 'journal_entries', 'journal_postings',
  'bank_transactions', 'compliance_fund_settings',
]

async function distinctGroups(fundId: string): Promise<string[]> {
  const out = new Set<string>()
  for (const t of ['lp_investments', 'fund_group_config', 'fund_cash_flows']) {
    const { data } = await admin.from(t).select('portfolio_group').eq('fund_id', fundId)
    for (const r of (data ?? [])) if (r.portfolio_group) out.add(r.portfolio_group)
  }
  return Array.from(out)
}

async function main() {
  const { data: funds } = await admin.from('funds').select('id, name').order('name')
  for (const fund of (funds ?? [])) {
    const explicit = EXPLICIT[fund.name]
    let vehicles: VehicleDef[]
    if (explicit) {
      vehicles = explicit.vehicles
    } else {
      const names = await distinctGroups(fund.id)
      if (names.length === 0) continue
      vehicles = names.map(n => ({ name: n, kind: 'fund' as const }))
    }

    console.log(`\n=== ${fund.name} (${fund.id.slice(0, 8)}) — ${vehicles.length} vehicles ===`)

    // alias → canonical
    const aliasMap = new Map<string, string>()
    for (const v of vehicles) for (const a of (v.aliases ?? [])) aliasMap.set(a, v.name)

    // 1) Drop strays.
    for (const s of (explicit?.strays ?? [])) {
      console.log(`  DROP  ${s.table}.portfolio_group = "${s.value}"`)
      if (APPLY) await admin.from(s.table).delete().eq('fund_id', fund.id).eq('portfolio_group', s.value)
    }

    // 2) Re-tag legacy strings → canonical across scalar tables.
    for (const [alias, canonical] of Array.from(aliasMap.entries())) {
      for (const t of SCALAR_TABLES) {
        const { count } = await admin.from(t).select('id', { count: 'exact', head: true }).eq('fund_id', fund.id).eq('portfolio_group', alias)
        if ((count ?? 0) > 0) {
          console.log(`  RETAG ${t}: "${alias}" → "${canonical}" (${count} row(s))`)
          if (APPLY) await admin.from(t).update({ portfolio_group: canonical }).eq('fund_id', fund.id).eq('portfolio_group', alias)
        }
      }
    }

    // 3) companies.portfolio_group is a text[] — remap each element.
    if (aliasMap.size > 0) {
      const { data: cos } = await admin.from('companies').select('id, portfolio_group').eq('fund_id', fund.id)
      for (const c of (cos ?? [])) {
        const arr: string[] = Array.isArray(c.portfolio_group) ? c.portfolio_group : []
        const mapped = Array.from(new Set(arr.map(x => aliasMap.get(x) ?? x)))
        if (JSON.stringify(mapped) !== JSON.stringify(arr)) {
          console.log(`  RETAG companies[${c.id.slice(0, 8)}]: ${JSON.stringify(arr)} → ${JSON.stringify(mapped)}`)
          if (APPLY) await admin.from('companies').update({ portfolio_group: mapped }).eq('id', c.id)
        }
      }
    }

    // 4) Upsert the registry.
    for (const v of vehicles) {
      console.log(`  VEHICLE ${v.kind.padEnd(9)} ${v.name}${v.aliases?.length ? `  (aliases: ${v.aliases.join(', ')})` : ''}`)
      if (APPLY) {
        await admin.from('fund_vehicles').upsert(
          { fund_id: fund.id, name: v.name, kind: v.kind, aliases: v.aliases ?? [], active: true, updated_at: new Date().toISOString() },
          { onConflict: 'fund_id,name' },
        )
      }
    }
  }
  console.log(APPLY ? '\n✅ Applied.' : '\n(dry run — pass --apply to write)')
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
