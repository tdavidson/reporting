import { describe, it, expect, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { createClient } from '@supabase/supabase-js'
import { confirmFundCapitalEvent } from '@/lib/portfolio/fof-register'
import { loadFofData, ledgerCarryingByHolding } from '@/lib/portfolio/fof-load'
import { periodEndMarks } from '@/lib/portfolio/fof-valuation'
import { commitmentSchedule, performanceTable } from '@/lib/portfolio/fof-exhibits'
import { ensureInvestmentAccounts } from '@/lib/accounting/investments'
import { loadPostedLedger } from '@/lib/accounting/load'

/**
 * END-TO-END smoke test against the LIVE database.
 *
 * NOT part of `npm test`: the filename ends in `.live-test.ts`, outside vitest's
 * `*.{test,spec}.ts` include glob, because it needs .env.local credentials and writes to a
 * real fund. Run it deliberately:
 *
 *     npx vitest run --config vitest.live.config.ts
 *
 * It found the bug it was written to find: confirmFundCapitalEvent wrote an
 * investment_transaction with no portfolio_group, so draftEntryForTransaction skipped it and
 * the position never reached the ledger — while the call still reported success. Everything it creates is named with the
 * SMOKE prefix and removed in afterAll, which then asserts zero residue.
 */
const SMOKE = 'ZZ SMOKE TEST FUND — safe to delete'

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.trim().startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')] }),
)
const admin: any = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let fundId = ''
let group = ''
let vehicleId: string | null = null
let companyId = ''
let eventId = ''
let txnId: string | null = null
let entryIds: string[] = []
let callDate = ''
let navDate = ''
let reportDate = ''

afterAll(async () => {
  // Order matters: postings and entries first, then the transaction they came from, then the
  // register, then the holding's accounts, then the holding.
  if (entryIds.length) {
    await admin.from('journal_postings').delete().in('journal_entry_id', entryIds)
    await admin.from('journal_entries').delete().in('id', entryIds)
  }
  if (companyId) {
    await admin.from('fund_capital_events').delete().eq('company_id', companyId)
    await admin.from('fund_nav_statements').delete().eq('company_id', companyId)
    await admin.from('fund_holding_terms').delete().eq('company_id', companyId)
  }
  if (txnId) await admin.from('investment_transactions').delete().eq('id', txnId)
  if (companyId) {
    await admin.from('chart_of_accounts').delete().eq('company_id', companyId)
    await admin.from('companies').delete().eq('id', companyId)
  }

  const { count } = await admin.from('companies')
    .select('id', { count: 'exact', head: true }).eq('name', SMOKE)
  console.log(`\n[cleanup] smoke holdings remaining: ${count}`)
  expect(count).toBe(0)
})

describe('FoF register — live database', { timeout: 30_000 }, () => {
  it('finds a fund and a ledger vehicle to test against', async () => {
    // Target the DEMO fund explicitly. These tests write (and remove) real rows, and
    // `limit(1)` picking whichever fund sorts first is luck, not a safety property — this
    // installation has two funds and only one of them is disposable.
    const { data: funds } = await admin.from('funds').select('id, name')
    const demo = (funds ?? []).find((f: any) => /hemrock/i.test(f.name)) ?? (funds ?? [])[0]
    expect(demo, 'no fund found to test against').toBeTruthy()
    fundId = demo.id
    console.log(`[safety] running against fund "${demo.name}"`)
    const { data: veh } = await admin.from('fund_vehicles')
      .select('id, name').eq('fund_id', fundId).eq('kind', 'fund').limit(1)
    expect((veh ?? []).length).toBeGreaterThan(0)
    group = veh[0].name
    vehicleId = veh[0].id

    // Post AFTER the last closed period: persistEntry refuses to write into a closed one,
    // which is correct behaviour and would otherwise look like a bug in the register.
    const { data: periods } = await admin.from('fiscal_periods')
      .select('period_end').eq('fund_id', fundId).eq('vehicle_id', vehicleId)
      .order('period_end', { ascending: false }).limit(1)
    const lastClose = (periods ?? [])[0]?.period_end ?? null
    const base = lastClose ? new Date(`${lastClose}T00:00:00Z`) : new Date(Date.UTC(2025, 0, 1))
    const plus = (d: number) => {
      const x = new Date(base); x.setUTCDate(x.getUTCDate() + d)
      return x.toISOString().slice(0, 10)
    }
    callDate = plus(1)
    navDate = plus(2)
    reportDate = plus(94)
    console.log(`[setup] fund=${fundId.slice(0, 8)} vehicle="${group}" lastClose=${lastClose} call=${callDate}`)
  })

  it('creates a fund holding with its terms and account triplet', async () => {
    const { data: c, error } = await admin.from('companies')
      .insert({ fund_id: fundId, name: SMOKE, holding_type: 'fund', status: 'active', portfolio_group: [group] })
      .select('id').single()
    expect(error).toBeNull()
    companyId = c.id

    const { error: te } = await admin.from('fund_holding_terms')
      .insert({ fund_id: fundId, company_id: companyId, commitment: 5_000_000, vintage_year: 2021, manager_name: 'Smoke Capital' })
    expect(te).toBeNull()

    const accts = await ensureInvestmentAccounts(admin, fundId, group, [{ id: companyId, name: SMOKE }])
    expect(accts.get(companyId)).toBeTruthy()
  })

  it('records a capital call as a draft', async () => {
    const { data, error } = await admin.from('fund_capital_events').insert({
      fund_id: fundId, vehicle_id: vehicleId, company_id: companyId,
      kind: 'call', event_date: callDate, amount: 1_000_000,
      purpose_investments: 900_000, purpose_fees: 80_000, purpose_expenses: 20_000,
      status: 'draft', source: 'manual',
    }).select('id').single()
    expect(error).toBeNull()
    eventId = data.id
  })

  it('confirms it — producing a transaction AND a draft journal entry', async () => {
    const result = await confirmFundCapitalEvent(admin, fundId, '00000000-0000-0000-0000-000000000000', eventId)
    console.log('[confirm]', JSON.stringify(result))
    expect(result.ok).toBe(true)
    expect(result.transactionId).toBeTruthy()
    txnId = result.transactionId!

    const { data: txn } = await admin.from('investment_transactions')
      .select('transaction_type, investment_cost, company_id').eq('id', txnId).single()
    expect(txn.transaction_type).toBe('investment')
    // The WHOLE call capitalizes — fees included.
    expect(Number(txn.investment_cost)).toBe(1_000_000)

    const { data: entries } = await admin.from('journal_entries')
      .select('id, status, memo').eq('fund_id', fundId).eq('source_ref', `txn:${txnId}`)
    entryIds = (entries ?? []).map((e: any) => e.id)
    console.log('[ledger] entries drafted:', entryIds.length, (entries ?? [])[0]?.status, (entries ?? [])[0]?.memo)
    expect(entryIds.length).toBeGreaterThan(0)

    const { data: postings } = await admin.from('journal_postings')
      .select('amount').in('journal_entry_id', entryIds)
    const net = (postings ?? []).reduce((a: number, p: any) => a + Number(p.amount), 0)
    expect(Math.abs(net)).toBeLessThan(0.005)   // balanced
  })

  it('records a manager NAV and derives the position', async () => {
    const { error } = await admin.from('fund_nav_statements').upsert({
      fund_id: fundId, vehicle_id: vehicleId, company_id: companyId,
      as_of_date: navDate, reported_nav: 1_100_000, basis: 'final',
      reported_contributions: 1_000_000, reported_distributions: 0, reported_unfunded: 4_000_000,
    }, { onConflict: 'company_id,as_of_date' })
    expect(error).toBeNull()

    const fof = await loadFofData(admin, fundId, reportDate)
    const p = fof.positions.find(x => x.companyId === companyId)!
    console.log('[position]', JSON.stringify({
      contributed: p.contributed, unfunded: p.unfunded, carrying: p.carryingValue,
      navAsOf: p.navAsOf, stale: p.stalenessDays, tvpi: p.tvpi,
    }))
    expect(p.contributed).toBe(1_000_000)
    expect(p.unfunded).toBe(4_000_000)
    expect(p.carryingValue).toBe(1_100_000)
    expect(p.stalenessDays).toBe(92)   // reportDate is navDate + 92
    expect(fof.managerFigures.find(m => m.companyId === companyId)?.reportedUnfunded).toBe(4_000_000)
  })

  it('computes a period-end mark against what the ledger actually carries', async () => {
    const fof = await loadFofData(admin, fundId, reportDate)
    const ledger = await loadPostedLedger(admin, fundId, group, reportDate)
    const carrying = ledgerCarryingByHolding(ledger.accounts, ledger.postings)
    const marks = periodEndMarks(fof.positions.filter(p => p.companyId === companyId), carrying, reportDate)
    // The entry is a DRAFT, so the posted ledger carries 0 — the mark is the full 1.1m.
    console.log('[mark]', JSON.stringify(marks[0]))
    expect(marks[0].derivedCarrying).toBe(1_100_000)
    expect(marks[0].ledgerCarrying).toBe(0)
  })

  it('produces the exhibits from the same positions', async () => {
    const fof = await loadFofData(admin, fundId, reportDate)
    const mine = fof.positions.filter(p => p.companyId === companyId)
    const cs = commitmentSchedule(mine, 250_000)
    const pt = performanceTable(mine)
    console.log('[exhibits]', JSON.stringify({
      commitment: cs.totals.commitment, unfunded: cs.totals.unfunded,
      pctCalled: cs.totals.pctCalled, coverage: cs.coverage, tvpi: pt.totals.tvpi,
    }))
    expect(cs.totals.unfunded).toBe(4_000_000)
    expect(cs.totals.pctCalled).toBeCloseTo(0.2, 10)
    expect(cs.coverage).toBeCloseTo(250_000 / 4_000_000, 10)
    expect(pt.totals.tvpi).toBeCloseTo(1.1, 10)
  })
})
