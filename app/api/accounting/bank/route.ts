import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertAdminAccess, assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { accountIdByCode } from '@/lib/accounting/persist'
import { closedPeriodRanges, dateInAnyClosedPeriod } from '@/lib/accounting/periods'
import { dbError } from '@/lib/api-error'

// GET — list a vehicle's staged bank transactions.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { data, error } = await admin
    .from('bank_transactions' as any)
    .select('id, txn_date, amount, description, counterparty, status, suggested_account_code, journal_entry_id')
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)
    .order('txn_date', { ascending: false })
    .limit(1000)
  if (error) return dbError(error, 'bank-transactions')
  return NextResponse.json(data ?? [])
}

// POST — act on a staged transaction.
// { action: 'post' | 'ignore' | 'setAccount' | 'unpost', id, accountCode?, group? }
// or bulk: { action: 'postMany', ids: string[], group? }
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertAdminAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const { action, id, ids, accountCode, group: bodyGroup } = await req.json().catch(() => ({}))
  const group = await resolveGroupOr400(admin, gate.fundId, bodyGroup ?? req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  /**
   * The entry-state guard the bank routes used to be missing.
   *
   * `unpost` and `restore` checked the closed period; `post`, `postMany` and `ignore` did
   * not, and none of them checked the entry's STATUS. So bank-posting a draft dated inside a
   * closed month injected P&L into locked books, and posting a transaction whose entry had
   * been voided (by `ignore`) resurrected that entry straight to `posted` — a transition the
   * journal route explicitly forbids.
   *
   * Returns an error string, or null when the transition is allowed.
   */
  const guardEntry = async (
    entryIds: string[],
    allowed: ('draft' | 'posted')[]
  ): Promise<string | null> => {
    if (entryIds.length === 0) return null
    const { data: entries } = await admin
      .from('journal_entries' as any)
      .select('id, status, entry_date')
      .eq('fund_id', gate.fundId)
      .in('id', entryIds)

    const closed = await closedPeriodRanges(admin, gate.fundId, group as string)
    for (const e of ((entries as any[]) ?? [])) {
      if (!allowed.includes(e.status)) {
        return e.status === 'void'
          ? 'That entry was voided. Restore the transaction to draft it again.'
          : `That entry is already ${e.status}.`
      }
      if (e.entry_date && dateInAnyClosedPeriod(closed, e.entry_date)) {
        return `That entry is dated ${e.entry_date}, inside a closed period — reopen it first.`
      }
    }
    return null
  }

  // Bulk post: flip a set of drafted transactions (and their draft entries) to
  // posted in one call.
  if (action === 'postMany') {
    const list = (Array.isArray(ids) ? ids : []).filter(Boolean)
    if (list.length === 0) return NextResponse.json({ error: 'ids (array) is required for postMany' }, { status: 400 })
    const { data: rows } = await admin
      .from('bank_transactions' as any)
      .select('id, journal_entry_id')
      .eq('fund_id', gate.fundId)
      .eq('vehicle_id', vehicleId)
      .in('id', list)
      .eq('status', 'drafted')
    const txnIds = ((rows as any[]) ?? []).map(r => r.id)
    const entryIds = ((rows as any[]) ?? []).map(r => r.journal_entry_id).filter(Boolean)

    const problem = await guardEntry(entryIds, ['draft'])
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    if (entryIds.length) {
      const { error } = await admin.from('journal_entries' as any).update({ status: 'posted', posted_at: new Date().toISOString() }).in('id', entryIds).eq('fund_id', gate.fundId)
      if (error) return dbError(error, 'bank-post-many')
    }
    if (txnIds.length) await admin.from('bank_transactions' as any).update({ status: 'reconciled' }).in('id', txnIds).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, posted: txnIds.length })
  }

  if (!id || !['post', 'ignore', 'setAccount', 'unpost', 'restore'].includes(action)) {
    return NextResponse.json({ error: 'action (post|ignore|setAccount|unpost|restore) and id are required' }, { status: 400 })
  }

  const { data: txn } = await admin
    .from('bank_transactions' as any)
    .select('id, journal_entry_id, status')
    .eq('id', id)
    .eq('fund_id', gate.fundId)
    .eq('vehicle_id', vehicleId)
    .maybeSingle()
  if (!txn) return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
  const entryId = (txn as any).journal_entry_id

  // Override the suggested account before posting: re-point the draft entry's
  // single non-cash posting to the chosen chart account.
  if (action === 'setAccount') {
    if ((txn as any).status !== 'drafted') return NextResponse.json({ error: 'Only a drafted transaction can be re-categorized' }, { status: 400 })
    const code = String(accountCode ?? '').trim()
    if (!code) return NextResponse.json({ error: 'accountCode is required' }, { status: 400 })
    const codes = await accountIdByCode(admin, gate.fundId, group)
    const newAccountId = codes.get(code)
    if (!newAccountId) return NextResponse.json({ error: 'Unknown account for this vehicle' }, { status: 400 })
    if (!entryId) return NextResponse.json({ error: 'No draft entry to update' }, { status: 400 })

    const cashId = codes.get('1000')
    const { data: postings } = await admin
      .from('journal_postings' as any)
      .select('id, account_id')
      .eq('journal_entry_id', entryId)
    const nonCash = ((postings as any[]) ?? []).filter(p => p.account_id !== cashId)
    if (nonCash.length !== 1) return NextResponse.json({ error: 'This entry has a custom allocation — edit it in the Journal.' }, { status: 400 })

    await admin.from('journal_postings' as any).update({ account_id: newAccountId }).eq('id', nonCash[0].id)
    await admin.from('bank_transactions' as any).update({ suggested_account_code: code }).eq('id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, suggested_account_code: code })
  }

  if (action === 'post') {
    if ((txn as any).status !== 'drafted') {
      return NextResponse.json({ error: 'Only a drafted transaction can be posted.' }, { status: 400 })
    }
    if (entryId) {
      const problem = await guardEntry([entryId], ['draft'])
      if (problem) return NextResponse.json({ error: problem }, { status: 400 })

      const { error } = await admin.from('journal_entries' as any).update({ status: 'posted', posted_at: new Date().toISOString() }).eq('id', entryId).eq('fund_id', gate.fundId)
      if (error) return dbError(error, 'bank-post-entry')
    }
    await admin.from('bank_transactions' as any).update({ status: 'reconciled' }).eq('id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, status: 'reconciled' })
  }

  // Unpost: revert a posted transaction to draft so it can be edited, then
  // re-posted. Refused if the entry falls in a closed period (reopen it first).
  if (action === 'unpost') {
    if ((txn as any).status !== 'reconciled') return NextResponse.json({ error: 'Only a posted transaction can be unposted' }, { status: 400 })
    if (entryId) {
      const { data: entry } = await admin.from('journal_entries' as any).select('entry_date').eq('id', entryId).eq('fund_id', gate.fundId).maybeSingle()
      const date = (entry as any)?.entry_date
      if (date) {
        const closed = await closedPeriodRanges(admin, gate.fundId, group)
        if (dateInAnyClosedPeriod(closed, date)) return NextResponse.json({ error: 'That entry is in a closed period — reopen it to edit.' }, { status: 400 })
      }
      const { error } = await admin.from('journal_entries' as any).update({ status: 'draft', posted_at: null }).eq('id', entryId).eq('fund_id', gate.fundId)
      if (error) return dbError(error, 'bank-unpost-entry')
    }
    await admin.from('bank_transactions' as any).update({ status: 'drafted' }).eq('id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, status: 'drafted' })
  }

  // Restore: bring an ignored transaction back to draft (un-void its entry) so it
  // can be edited/posted again. Refused if the entry is in a closed period.
  if (action === 'restore') {
    if ((txn as any).status !== 'ignored') return NextResponse.json({ error: 'Only an ignored transaction can be restored' }, { status: 400 })
    if (entryId) {
      const { data: entry } = await admin.from('journal_entries' as any).select('entry_date').eq('id', entryId).eq('fund_id', gate.fundId).maybeSingle()
      const date = (entry as any)?.entry_date
      if (date) {
        const closed = await closedPeriodRanges(admin, gate.fundId, group)
        if (dateInAnyClosedPeriod(closed, date)) return NextResponse.json({ error: 'That entry is in a closed period — reopen it to edit.' }, { status: 400 })
      }
      const { error } = await admin.from('journal_entries' as any).update({ status: 'draft', posted_at: null }).eq('id', entryId).eq('fund_id', gate.fundId)
      if (error) return dbError(error, 'bank-restore-entry')
    }
    await admin.from('bank_transactions' as any).update({ status: 'drafted' }).eq('id', id).eq('fund_id', gate.fundId)
    return NextResponse.json({ ok: true, status: 'drafted' })
  }

  // Ignore. Voiding the entry is a real ledger change, so it gets the same guards as any
  // other: an already-ignored transaction has nothing to do, and an entry sitting inside a
  // closed period cannot be voided without reopening it — that used to silently change
  // already-closed financials.
  if ((txn as any).status === 'ignored') {
    return NextResponse.json({ error: 'That transaction is already ignored.' }, { status: 400 })
  }
  if (entryId) {
    const problem = await guardEntry([entryId], ['draft', 'posted'])
    if (problem) return NextResponse.json({ error: problem }, { status: 400 })

    const { error } = await admin.from('journal_entries' as any).update({ status: 'void', posted_at: null }).eq('id', entryId).eq('fund_id', gate.fundId)
    if (error) return dbError(error, 'bank-ignore-entry')
  }
  await admin.from('bank_transactions' as any).update({ status: 'ignored' }).eq('id', id).eq('fund_id', gate.fundId)
  return NextResponse.json({ ok: true, status: 'ignored' })
}
