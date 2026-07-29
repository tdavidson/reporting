// Read-only diagnostic for a vehicle whose LP capital never reached per-LP accounts.
//
//   npx tsx --env-file=.env.local scripts/diagnose-pooled-lp-capital.ts "Ocrolus SPV LP"
//
// Writes nothing. Answers the questions that decide how a repair has to work:
//   1. Do per-LP capital accounts (3100-<lp>) exist at all?
//   2. Of the postings sitting on the POOLED 3100, how many carry an lp_entity_id?
//      Tagged ones can be re-pointed automatically; untagged ones cannot.
//   3. Which entries debit 1300 without ever relieving it (the phantom receivable)?
//   4. What would the trial balance look like once the phantoms are gone?

import { createAdminClient } from '@/lib/supabase/admin'

const group = process.argv[2]
if (!group) { console.error('usage: diagnose-pooled-lp-capital.ts "<vehicle name>"'); process.exit(1) }

const admin: any = createAdminClient()
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

async function main() {
  const { data: veh } = await admin.from('fund_vehicles').select('id, fund_id, name').eq('name', group).maybeSingle()
  if (!veh) { console.error(`No vehicle named ${group}`); process.exit(1) }
  const { id: vehicleId, fund_id: fundId } = veh
  console.log(`Vehicle ${veh.name}  vehicle_id=${vehicleId}  fund_id=${fundId}\n`)

  const { data: settings } = await admin.from('vehicle_accounting_settings')
    .select('capital_source, history_mode').eq('vehicle_id', vehicleId).maybeSingle()
  console.log(`capital_source = ${settings?.capital_source ?? '(no row → defaults to "events")'}`)
  console.log(`history_mode   = ${settings?.history_mode ?? '(none)'}\n`)

  // --- 1. The chart -----------------------------------------------------------
  const { data: accounts } = await admin.from('chart_of_accounts')
    .select('id, code, name, type, subtype, lp_entity_id')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  const acctById = new Map<string, any>(((accounts as any[]) ?? []).map(a => [a.id, a]))
  const perLp = ((accounts as any[]) ?? []).filter(a => a.lp_entity_id)
  const pooled = ((accounts as any[]) ?? []).filter(a => a.subtype === 'lp_capital' && !a.lp_entity_id)
  const receivable = ((accounts as any[]) ?? []).find(a => a.code === '1300')
  console.log(`Per-LP capital accounts: ${perLp.length}`)
  console.log(`Pooled LP capital accounts: ${pooled.map(a => `${a.code} ${a.name}`).join(', ') || '(none)'}\n`)

  // --- 2. Postings on the pooled account --------------------------------------
  const { data: entries } = await admin.from('journal_entries')
    .select('id, entry_date, memo, source_type, status, journal_postings(id, account_id, amount, lp_entity_id)')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('status', 'posted')
    .order('entry_date', { ascending: true })

  // The name column is `entity_name`, and lp_entities isn't fund-scoped in the app's own
  // reads (load.ts:182) — it resolves by id. Paginate: PostgREST caps a select at 1000 rows.
  const lpName = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data: page } = await admin.from('lp_entities').select('id, entity_name').range(from, from + 999)
    for (const l of ((page as any[]) ?? [])) lpName.set(l.id, l.entity_name)
    if (((page as any[]) ?? []).length < 1000) break
  }

  const pooledIds = new Set(pooled.map(a => a.id))
  let tagged = 0, untagged = 0, taggedAmt = 0, untaggedAmt = 0
  const untaggedDetail: { date: string; memo: string; amount: number }[] = []

  for (const e of ((entries as any[]) ?? [])) {
    for (const p of (e.journal_postings ?? [])) {
      if (!pooledIds.has(p.account_id)) continue
      if (p.lp_entity_id) { tagged++; taggedAmt += Number(p.amount) }
      else { untagged++; untaggedAmt += Number(p.amount); untaggedDetail.push({ date: e.entry_date, memo: e.memo, amount: Number(p.amount) }) }
    }
  }
  console.log('--- Pooled LP capital postings -------------------------------------')
  console.log(`Tagged with lp_entity_id : ${tagged}  (${money(taggedAmt)})   ← auto-attributable`)
  console.log(`Untagged                 : ${untagged}  (${money(untaggedAmt)})   ← need manual split`)
  if (untaggedDetail.length) {
    console.log('\nUntagged postings, grouped by entry:')
    const byMemo = new Map<string, { n: number; amt: number; date: string }>()
    for (const u of untaggedDetail) {
      const k = `${u.date} ${u.memo}`
      const cur = byMemo.get(k) ?? { n: 0, amt: 0, date: u.date }
      byMemo.set(k, { n: cur.n + 1, amt: cur.amt + u.amount, date: u.date })
    }
    for (const [k, v] of Array.from(byMemo.entries())) console.log(`  ${v.n.toString().padStart(3)} lines  ${money(v.amt).padStart(14)}  ${k}`)
  }

  // --- 2b. Full line-by-line dump of any entry holding untagged pooled postings.
  // Whether the untagged lines can be assigned automatically depends on who is ALREADY
  // tagged in the same entry — the remainder is what's left to hand out.
  const dirtyEntryIds = new Set(((entries as any[]) ?? []).filter(e =>
    (e.journal_postings ?? []).some((p: any) => pooledIds.has(p.account_id) && !p.lp_entity_id)).map(e => e.id))
  for (const e of ((entries as any[]) ?? [])) {
    if (!dirtyEntryIds.has(e.id)) continue
    console.log(`\n--- Every line of "${e.memo}" (${e.entry_date}) ---`)
    for (const p of (e.journal_postings ?? [])) {
      const a = acctById.get(p.account_id)
      const who = p.lp_entity_id ? (lpName.get(p.lp_entity_id) ?? `?${p.lp_entity_id.slice(0, 8)}`) : '*** UNTAGGED ***'
      console.log(`  ${money(Number(p.amount)).padStart(14)}  ${(a?.code ?? '?').padEnd(6)} ${who}`)
    }
    // Which committed LPs are NOT accounted for by the tagged lines?
    const taggedHere = new Set((e.journal_postings ?? []).filter((p: any) => pooledIds.has(p.account_id) && p.lp_entity_id).map((p: any) => p.lp_entity_id))
    const { data: inv } = await admin.from('lp_investments').select('entity_id, commitment').eq('fund_id', fundId).eq('portfolio_group', group)
    const missing = ((inv as any[]) ?? []).filter(r => Number(r.commitment) > 0 && !taggedHere.has(r.entity_id))
    console.log('  LPs with a commitment but NO tagged line in this entry:')
    for (const m of missing) console.log(`    ${money(Number(m.commitment)).padStart(12)}  ${lpName.get(m.entity_id) ?? m.entity_id}`)
  }

  // --- 3. The 1300 receivable -------------------------------------------------
  if (receivable) {
    console.log('\n--- Due from LPs (1300) --------------------------------------------')
    let bal = 0
    const rows: { date: string; memo: string; source: string; amount: number; lp: string }[] = []
    for (const e of ((entries as any[]) ?? [])) {
      for (const p of (e.journal_postings ?? [])) {
        if (p.account_id !== receivable.id) continue
        bal += Number(p.amount)
        rows.push({ date: e.entry_date, memo: e.memo, source: e.source_type, amount: Number(p.amount), lp: p.lp_entity_id ? (lpName.get(p.lp_entity_id) ?? p.lp_entity_id) : '(untagged)' })
      }
    }
    for (const r of rows) console.log(`  ${r.date}  ${money(r.amount).padStart(12)}  [${r.source}]  ${r.lp}  — ${r.memo}`)
    console.log(`  ${''.padStart(12)}  ${money(bal).padStart(12)}  BALANCE`)
  }

  // --- 4. The phantom opening-balance entries ---------------------------------
  console.log('\n--- opening_balance entries that debit 1300 (phantom receivables) ---')
  let phantom = 0
  for (const e of ((entries as any[]) ?? [])) {
    if (e.source_type !== 'opening_balance') continue
    const hitsReceivable = (e.journal_postings ?? []).some((p: any) => p.account_id === receivable?.id && Number(p.amount) > 0)
    if (!hitsReceivable) continue
    const amt = (e.journal_postings ?? []).filter((p: any) => p.account_id === receivable?.id).reduce((s: number, p: any) => s + Number(p.amount), 0)
    phantom += amt
    const tags = (e.journal_postings ?? []).map((p: any) => p.lp_entity_id ? (lpName.get(p.lp_entity_id) ?? 'tagged') : 'untagged').join('/')
    console.log(`  ${e.id}  ${e.entry_date}  ${money(amt).padStart(12)}  [${tags}]  ${e.memo}`)
  }
  console.log(`  TOTAL PHANTOM RECEIVABLE: ${money(phantom)}`)
  console.log(`\nVoiding those would take 1300 to ${money((await receivableBalance(entries, receivable)) - phantom)} and reduce partners' capital by ${money(phantom)}.`)
}

async function receivableBalance(entries: any, receivable: any): Promise<number> {
  let bal = 0
  for (const e of ((entries as any[]) ?? [])) {
    for (const p of (e.journal_postings ?? [])) if (p.account_id === receivable?.id) bal += Number(p.amount)
  }
  return bal
}

main().catch(e => { console.error(e); process.exit(1) })
