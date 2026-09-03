// Repair a vehicle whose LP capital never reached per-LP capital accounts.
//
//   npx tsx --env-file=.env.local scripts/repair-pooled-lp-capital.ts "<vehicle name>"
//   npx tsx --env-file=.env.local scripts/repair-pooled-lp-capital.ts "<vehicle name>" --apply
//
// Three ordered steps. Each is idempotent, and the dry run prints exactly what --apply would do.
//
//   1. VOID phantom "commitment as receivable" entries. A commitment is not a receivable:
//      an opening_balance entry of the shape (Dr 1300 X / Cr pooled-LP-capital X) records a
//      commitment as if it had been called, double-crediting capital when the real call is
//      booked separately. Recognised structurally — exactly two postings, equal and opposite,
//      one on 1300 and one on the pooled LP capital account — never by memo text.
//   2. TAG pooled capital postings that carry no lp_entity_id, but ONLY where the assignment
//      is forced: the untagged amounts in an entry must be a perfect bijection with the
//      commitments of the LPs that have no tagged line in that same entry. Anything less
//      than a perfect match is refused and reported for manual handling.
//   3. ATTRIBUTE — create each partner's own capital account and re-point the pooled postings
//      onto it, via the app's own `attributeLpCapital`. Balance-sheet neutral.
//
// Steps 1 and 2 must precede 3: attributing a phantom would carve it into the per-LP accounts.

// `--reopen` additionally reopens any closed period covering the entries being repaired and
// re-closes it afterwards. Reopen goes NEWEST-FIRST (a later period's allocation was computed
// on top of the earlier one) and re-close OLDEST-FIRST, for the same reason in reverse.
// Without it, the database trigger added in 20260714000004 refuses every write below.

import { createAdminClient } from '@/lib/supabase/admin'
import { attributeLpCapital, previewAttributeLpCapital } from '@/lib/accounting/attribute-lp-capital'
import { lpCapitalSummary } from '@/lib/accounting/capital-calls'
import { closedPeriodRanges, dateInAnyClosedPeriod } from '@/lib/accounting/periods'
import { reopenPeriodWithReversal, closePeriodWithAllocation } from '@/lib/accounting/close'
import { RECEIVABLE_CODE } from '@/lib/accounting/chart'
import { ACTUAL_BOOK } from '@/lib/accounting/books'

const group = process.argv[2]
const APPLY = process.argv.includes('--apply')
const REOPEN = process.argv.includes('--reopen')
if (!group) { console.error('usage: repair-pooled-lp-capital.ts "<vehicle name>" [--apply] [--reopen]'); process.exit(1) }

const admin: any = createAdminClient()
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const CENT = 0.005

async function main() {
  const { data: veh } = await admin.from('fund_vehicles').select('id, fund_id, name').eq('name', group).maybeSingle()
  if (!veh) { console.error(`No vehicle named ${group}`); process.exit(1) }
  const { id: vehicleId, fund_id: fundId } = veh
  console.log(`${APPLY ? 'APPLY' : 'DRY RUN'} — ${veh.name}\n`)

  const { data: accounts } = await admin.from('chart_of_accounts')
    .select('id, code, name, subtype, lp_entity_id').eq('fund_id', fundId).eq('vehicle_id', vehicleId)
  const receivable = ((accounts as any[]) ?? []).find(a => a.code === RECEIVABLE_CODE)
  const pooledIds = new Set(((accounts as any[]) ?? []).filter(a => a.subtype === 'lp_capital' && !a.lp_entity_id).map(a => a.id))
  if (!pooledIds.size) { console.log('No pooled LP capital account — nothing to repair.'); return }

  const { data: entries } = await admin.from('journal_entries')
    .select('id, entry_date, memo, source_type, status, journal_postings(id, account_id, amount, lp_entity_id)')
    .eq('book', ACTUAL_BOOK)
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('status', 'posted')
    .order('entry_date', { ascending: true })
  const rows = (entries as any[]) ?? []

  // --- Step 0: reopen the closed periods that cover what we need to touch -------
  // Only the periods that actually overlap a posting we'd repair; an unrelated closed
  // period stays closed.
  const { data: closedRows } = await admin.from('fiscal_periods')
    .select('id, period_start, period_end, label, status')
    .eq('fund_id', fundId).eq('vehicle_id', vehicleId).eq('status', 'closed')
    .order('period_start', { ascending: true })
  const touchDates = new Set<string>()
  for (const e of ((entries as any[]) ?? [])) {
    const touchesPooled = (e.journal_postings ?? []).some((p: any) => pooledIds.has(p.account_id))
    if (touchesPooled) touchDates.add(e.entry_date)
  }
  const needed = ((closedRows as any[]) ?? []).filter(p =>
    Array.from(touchDates).some(d => d >= p.period_start && d <= p.period_end))
  // A period can only be reopened once every LATER one is open — a later allocation was
  // computed on top of this one (close.ts:1061-1089). So the set is "the earliest period we
  // must touch, and everything closed after it", not just the ones holding bad postings.
  const earliest = needed.map(p => p.period_start).sort()[0]
  const toReopen = earliest
    ? ((closedRows as any[]) ?? []).filter(p => p.period_start >= earliest)
    : []

  if (toReopen.length) {
    console.log('--- 0. Closed periods covering the repair ---')
    for (const p of toReopen) console.log(`  ${p.period_start} → ${p.period_end} (${p.label ?? 'unlabelled'})`)
    if (!REOPEN) {
      console.log('  These block every step below. Re-run with --reopen to reopen and re-close them.\n')
    } else if (APPLY) {
      // Newest-first: reopenPeriodWithReversal refuses out-of-order and says why.
      for (const p of [...toReopen].reverse()) {
        const res: any = await reopenPeriodWithReversal(admin, fundId, group, p.id)
        if ('error' in res) throw new Error(`Reopen ${p.period_start}: ${res.error}`)
        console.log(`  → reopened ${p.period_start} → ${p.period_end} (voided ${res.voided} close entries)`)
      }
      console.log()
    } else {
      console.log('  --reopen given; would reopen newest-first, then re-close oldest-first.\n')
    }
  }

  const closed = APPLY && REOPEN ? [] : await closedPeriodRanges(admin, fundId, group)
  const lpName = new Map<string, string>()
  for (let from = 0; ; from += 1000) {
    const { data: page } = await admin.from('lp_entities').select('id, entity_name').range(from, from + 999)
    for (const l of ((page as any[]) ?? [])) lpName.set(l.id, l.entity_name)
    if (((page as any[]) ?? []).length < 1000) break
  }
  const nameOf = (id: string) => lpName.get(id) ?? id.slice(0, 8)

  // --- Step 1: phantom commitment-as-receivable entries ------------------------
  console.log('--- 1. Phantom "commitment booked as receivable" entries ---')
  const phantoms = rows.filter(e => {
    if (e.source_type !== 'opening_balance' || !receivable) return false
    const ps = e.journal_postings ?? []
    if (ps.length !== 2) return false
    const dr = ps.find((p: any) => p.account_id === receivable.id && Number(p.amount) > 0)
    const cr = ps.find((p: any) => pooledIds.has(p.account_id) && Number(p.amount) < 0)
    return !!dr && !!cr && Math.abs(Number(dr.amount) + Number(cr.amount)) < CENT
  })
  let phantomTotal = 0
  let phantomBlocked = 0
  for (const e of phantoms) {
    const amt = Number((e.journal_postings ?? []).find((p: any) => p.account_id === receivable.id).amount)
    const blocked = dateInAnyClosedPeriod(closed, e.entry_date)
    if (blocked) phantomBlocked++; else phantomTotal += amt
    console.log(`  ${blocked ? 'BLOCKED (closed period)' : 'void'}  ${e.entry_date}  ${money(amt).padStart(12)}  ${e.memo}`)
  }
  console.log(`  ${phantoms.length} entries, ${money(phantomTotal)} of phantom receivable to remove` +
    (phantomBlocked ? `, ${phantomBlocked} blocked by a closed period` : ''))

  if (APPLY && phantoms.length) {
    const ids = phantoms.filter(e => !dateInAnyClosedPeriod(closed, e.entry_date)).map(e => e.id)
    if (ids.length) {
      const { error } = await admin.from('journal_entries')
        .update({ status: 'void', posted_at: null }).in('id', ids).eq('fund_id', fundId).eq('status', 'posted')
      if (error) throw error
      console.log(`  → voided ${ids.length} entries`)
    }
  }

  // --- Step 2: tag untagged pooled postings where the assignment is forced ------
  console.log('\n--- 2. Untagged pooled capital postings ---')
  const voidedIds = new Set(APPLY ? phantoms.map(e => e.id) : [])
  const live = rows.filter(e => !voidedIds.has(e.id))
  const summary = await lpCapitalSummary(admin, fundId, group)
  const commitmentOf = new Map<string, number>(summary.map((r: any) => [r.lpEntityId, Number(r.commitment)]))

  const tagPlan: { postingId: string; lpEntityId: string; amount: number }[] = []
  for (const e of live) {
    const ps = (e.journal_postings ?? []).filter((p: any) => pooledIds.has(p.account_id))
    const untagged = ps.filter((p: any) => !p.lp_entity_id)
    if (!untagged.length) continue
    const taggedHere = new Set(ps.filter((p: any) => p.lp_entity_id).map((p: any) => p.lp_entity_id))
    const candidates = Array.from(commitmentOf.entries()).filter(([id]) => !taggedHere.has(id))

    console.log(`  "${e.memo}" (${e.entry_date}): ${untagged.length} untagged, ${candidates.length} LPs without a line here`)
    // Forced assignment only: greedily match each untagged amount to a candidate with the
    // same commitment. Same-amount candidates are interchangeable, so any pairing is correct;
    // if the multisets don't line up exactly, refuse the whole entry.
    const pool = candidates.map(([id, c]) => ({ id, c }))
    const matched: { postingId: string; lpEntityId: string; amount: number }[] = []
    let failed = false
    for (const p of untagged) {
      const want = Math.abs(Number(p.amount))
      const i = pool.findIndex(x => Math.abs(x.c - want) < CENT)
      if (i < 0) { failed = true; break }
      matched.push({ postingId: p.id, lpEntityId: pool[i].id, amount: Number(p.amount) })
      pool.splice(i, 1)
    }
    // Every remaining candidate must be an LP genuinely absent from this entry, not one we
    // failed to place — so the untagged lines must have consumed a candidate each.
    if (failed || matched.length !== untagged.length) {
      console.log('    REFUSED — amounts do not map 1:1 onto un-lined LPs. Handle by hand.')
      continue
    }
    for (const m of matched) console.log(`    ${money(m.amount).padStart(12)}  → ${nameOf(m.lpEntityId)}`)
    tagPlan.push(...matched)
  }
  if (!tagPlan.length) console.log('  (nothing to tag)')

  if (APPLY && tagPlan.length) {
    for (const t of tagPlan) {
      const { error } = await admin.from('journal_postings')
        .update({ lp_entity_id: t.lpEntityId }).eq('id', t.postingId).eq('fund_id', fundId)
      if (error) throw error
    }
    console.log(`  → tagged ${tagPlan.length} postings`)
  }

  // --- Step 3: create per-LP accounts and re-point --------------------------------
  console.log('\n--- 3. Attribute pooled capital to per-LP accounts ---')
  if (!APPLY) {
    const pre = await previewAttributeLpCapital(admin, fundId, group)
    console.log(`  (preview reflects the CURRENT books, before steps 1-2 above)`)
    console.log(`  accounts to create: ${pre.accountsToCreate}, postings to move: ${pre.movable}, ` +
      `untagged: ${pre.untagged}, closed-skipped: ${pre.closedSkipped}`)
  } else {
    const res = await attributeLpCapital(admin, fundId, group)
    console.log(`  → created ${res.accountsCreated} accounts, moved ${res.moved} postings` +
      (res.untagged ? `, ${res.untagged} still untagged` : '') +
      (res.closedSkipped ? `, ${res.closedSkipped} skipped (closed period)` : ''))
  }

  // --- Step 4: re-close, oldest-first -------------------------------------------
  // The close re-runs allocation, which is the point: it now has per-LP capital accounts
  // to allocate INTO, which it didn't before. A period that refuses to close is left OPEN
  // and reported — the UI explains readiness blockers far better than this script can.
  if (APPLY && REOPEN && toReopen.length) {
    console.log('\n--- 4. Re-close ---')
    for (const p of toReopen) {
      const res: any = await closePeriodWithAllocation(admin, fundId, group, null, p.period_start, p.period_end, p.label ?? undefined)
      if ('error' in res) { console.log(`  LEFT OPEN  ${p.period_start} → ${p.period_end}: ${res.error}`); continue }
      console.log(`  → closed ${p.period_start} → ${p.period_end}  (net income ${money(res.netIncome)}, ${res.entryIds.length} allocation entries)`)
    }
  }

  console.log(APPLY ? '\nDone. Re-check the trial balance and capital accounts.' : '\nDry run only — nothing written. Re-run with --apply.')
}

main().catch(e => { console.error(e); process.exit(1) })
