import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts). The middleware has already checked the caller's
// grant for this route + method; these resolve identity and keep the demo out of writes.
import { assertWriteAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { dbError } from '@/lib/api-error'
import { persistEntry } from '@/lib/accounting/persist'
import { assertBalanced } from '@/lib/accounting/ledger'
import { closedPeriodRanges, dateInAnyClosedPeriod } from '@/lib/accounting/periods'
import { fundCurrency } from '@/lib/accounting/currency'
import { resolvePeriod, customPeriod, type PeriodPreset } from '@/lib/accounting/statement-period'
import type { JournalEntry, Posting } from '@/lib/accounting/types'
import { ACTUAL_BOOK } from '@/lib/accounting/books'

// GET — the vehicle's journal entries with postings, or a single entry via ?id=.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const base = admin
    .from('journal_entries' as any)
    .select('*, journal_postings(*)')
    .eq('book', ACTUAL_BOOK)
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)

  const id = req.nextUrl.searchParams.get('id')
  if (id) {
    const { data, error } = await base.eq('id', id).maybeSingle()
    if (error) return dbError(error, 'accounting-journal')
    return NextResponse.json(data ?? null)
  }

  // List path: resolve the period window (default YTD), then hand filtering + pagination
  // to the RPC so search spans account names/amounts across all pages.
  const sp = req.nextUrl.searchParams
  const preset = (sp.get('preset') as PeriodPreset | null) ?? 'ytd'
  const period = preset === 'custom'
    ? customPeriod(sp.get('start'), sp.get('end'))
    : resolvePeriod(preset)
  const limit = Math.min(Math.max(parseInt(sp.get('limit') ?? '50', 10) || 50, 1), 200)
  const offset = Math.max(parseInt(sp.get('offset') ?? '0', 10) || 0, 0)
  // Status filter: draft | posted | void picks exactly that one. Anything else — including
  // 'all' and an omitted param — means draft + posted: a voided entry has been discarded, and
  // leaving it in the default list is the opposite of discarding it. Ask for 'void' to see them.
  const statusParam = sp.get('status')
  const statuses = ['draft', 'posted', 'void'].includes(statusParam ?? '')
    ? [statusParam as string]
    : ['draft', 'posted']

  const { data, error } = await admin.rpc('journal_search' as any, {
    p_fund_id: gate.fundId,
    p_vehicle_id: vehicleId,
    p_start: period.start,
    p_end: period.end,
    p_query: sp.get('q'),
    p_statuses: statuses,
    p_limit: limit,
    p_offset: offset,
  })
  if (error) return dbError(error, 'accounting-journal')
  return NextResponse.json(data ?? { entries: [], total: 0 })
}

// PUT — replace a DRAFT entry's postings (and date/memo). Posted entries are
// immutable; reverse or void them instead.
export async function PUT(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { id, entryDate, memo, postings } = body
  if (!id || !Array.isArray(postings) || postings.length === 0) {
    return NextResponse.json({ error: 'id and at least one posting are required' }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('journal_entries' as any)
    .select('id, status, entry_date')
    .eq('book', ACTUAL_BOOK)
    .eq('id', id).eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })
  if ((existing as any).status !== 'draft') return NextResponse.json({ error: 'Only draft entries can be edited — reverse or void a posted entry.' }, { status: 400 })

  // The fund's currency, never a client-supplied one. The ledger is denominated in a single
  // currency by design (see lib/accounting/currency.ts); accepting `p.currency` from the body
  // would let a posting balance against the wrong denomination.
  const currency = await fundCurrency(admin, gate.fundId)
  const normalized: Posting[] = postings.map((p: any) => ({ accountId: p.accountId, amount: Number(p.amount), currency, lpEntityId: p.lpEntityId ?? null }))
  if (normalized.some(p => !p.accountId || !Number.isFinite(p.amount))) {
    return NextResponse.json({ error: 'Each posting needs an accountId and a numeric amount' }, { status: 400 })
  }
  const newDate = entryDate || (existing as any).entry_date
  const entry: JournalEntry = { fundId: gate.fundId, entryDate: newDate, memo: memo ?? null, sourceType: 'manual', postings: normalized }
  try { assertBalanced(entry) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }) }

  const closed = await closedPeriodRanges(admin, gate.fundId, group)
  if (dateInAnyClosedPeriod(closed, newDate) || dateInAnyClosedPeriod(closed, (existing as any).entry_date)) {
    return NextResponse.json({ error: 'That date falls in a closed period — reopen it to edit.' }, { status: 400 })
  }

  // Insert the new postings first, then drop the old ones — so a failure never
  // leaves the entry without lines.
  const { data: oldRows } = await admin.from('journal_postings' as any).select('id').eq('book', ACTUAL_BOOK).eq('journal_entry_id', id)
  const oldIds = ((oldRows as any[]) ?? []).map(r => r.id)
  const { error: insErr } = await admin.from('journal_postings' as any).insert(
    normalized.map(p => ({ fund_id: gate.fundId, portfolio_group: group, vehicle_id: vehicleId, journal_entry_id: id, account_id: p.accountId, amount: p.amount, currency: p.currency, lp_entity_id: p.lpEntityId ?? null }))
  )
  if (insErr) return dbError(insErr, 'accounting-journal-update')
  if (oldIds.length) await admin.from('journal_postings' as any).delete().in('id', oldIds)
  await admin.from('journal_entries' as any).update({ entry_date: newDate, memo: memo ?? null }).eq('id', id).eq('fund_id', gate.fundId)

  const { data: full } = await admin.from('journal_entries' as any).select('*, journal_postings(*)').eq('id', id).eq('book', ACTUAL_BOOK).single()
  return NextResponse.json(full ?? { id })
}

// POST — create a balanced journal entry with its postings.
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json()
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group

  const { entryDate, memo, sourceType, sourceRef, status, postings } = body
  if (!entryDate || !Array.isArray(postings) || postings.length === 0) {
    return NextResponse.json({ error: 'entryDate and at least one posting are required' }, { status: 400 })
  }
  // The fund's currency, never a client-supplied one. The ledger is denominated in a single
  // currency by design (see lib/accounting/currency.ts); accepting `p.currency` from the body
  // would let a posting balance against the wrong denomination.
  const currency = await fundCurrency(admin, gate.fundId)
  const normalized: Posting[] = postings.map((p: any) => ({ accountId: p.accountId, amount: Number(p.amount), currency, lpEntityId: p.lpEntityId ?? null }))
  if (normalized.some(p => !p.accountId || !Number.isFinite(p.amount))) {
    return NextResponse.json({ error: 'Each posting needs an accountId and a numeric amount' }, { status: 400 })
  }

  const entry: JournalEntry = { fundId: gate.fundId, entryDate, memo: memo ?? null, sourceType: sourceType ?? 'manual', sourceRef: sourceRef ?? null, postings: normalized }
  const result = await persistEntry(admin, gate.fundId, group, user.id, entry, status === 'posted' ? 'posted' : 'draft')
  if ('error' in result) return NextResponse.json({ error: result.error }, { status: 400 })

  const { data: full } = await admin.from('journal_entries' as any).select('*, journal_postings(*)').eq('book', ACTUAL_BOOK).eq('id', result.entryId).single()
  return NextResponse.json(full ?? { id: result.entryId })
}

// PATCH — change an entry's state:
//   post   → a draft becomes posted (it hits the ledger)
//   unpost → back to draft so it can be edited and re-posted
//   void   → from POSTED, reverse its effect on the ledger (audit-safe correction);
//            from DRAFT, discard it — the only way to get rid of a draft, which until now
//            was a one-way door you could only edit or post. The bank page has always done
//            this to drafts via its Ignore action; the journal simply couldn't reach it.
// All are refused if the entry falls in a closed period (reopen it first).
export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { id, action } = body
  if (!id || !['post', 'unpost', 'void'].includes(action)) {
    return NextResponse.json({ error: "id and action ('post'|'unpost'|'void') are required" }, { status: 400 })
  }

  const { data: existing } = await admin
    .from('journal_entries' as any)
    .select('id, status, entry_date')
    .eq('book', ACTUAL_BOOK)
    .eq('id', id).eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
    .maybeSingle()
  if (!existing) return NextResponse.json({ error: 'Entry not found' }, { status: 404 })

  const status = (existing as any).status
  if (action === 'post' && status !== 'draft') {
    return NextResponse.json({ error: 'Only a draft entry can be posted' }, { status: 400 })
  }
  if (action === 'unpost' && status !== 'posted') {
    return NextResponse.json({ error: 'Only a posted entry can be unposted' }, { status: 400 })
  }
  // Void takes a draft (discard) or a posted entry (reverse). Only an already-void entry
  // has nothing left to do.
  if (action === 'void' && status !== 'draft' && status !== 'posted') {
    return NextResponse.json({ error: 'That entry is already void' }, { status: 400 })
  }

  const closed = await closedPeriodRanges(admin, gate.fundId, group)
  if (dateInAnyClosedPeriod(closed, (existing as any).entry_date)) {
    return NextResponse.json({ error: 'That entry is in a closed period — reopen it first.' }, { status: 400 })
  }

  if (action === 'post') {
    const { error } = await admin
      .from('journal_entries' as any)
      .update({ status: 'posted', posted_at: new Date().toISOString() })
      .eq('id', id).eq('fund_id', gate.fundId)
    if (error) return dbError(error, 'journal-post')
    // Keep any bank transaction that points at this entry in step.
    await admin.from('bank_transactions' as any).update({ status: 'reconciled' }).eq('journal_entry_id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, status: 'posted' })
  }

  if (action === 'unpost') {
    const { error } = await admin.from('journal_entries' as any).update({ status: 'draft', posted_at: null }).eq('id', id).eq('fund_id', gate.fundId)
    if (error) return dbError(error, 'journal-unpost')
    // Keep any bank transaction that points at this entry in step.
    await admin.from('bank_transactions' as any).update({ status: 'drafted' }).eq('journal_entry_id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, status: 'draft' })
  }

  // `posted_at: null` matches what the bank page's Ignore writes, so an entry voided from
  // either surface looks identical afterwards.
  const { error } = await admin.from('journal_entries' as any).update({ status: 'void', posted_at: null }).eq('id', id).eq('fund_id', gate.fundId)
  if (error) return dbError(error, 'journal-void')
  await admin.from('bank_transactions' as any).update({ status: 'ignored' }).eq('journal_entry_id', id).eq('fund_id', gate.fundId)
  return NextResponse.json({ ok: true, status: 'void' })
}
