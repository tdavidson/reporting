import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts).
import { assertWriteAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { vehicleIdByName } from '@/lib/accounting/vehicle-id'
import { accountIdByCode, persistEntry } from '@/lib/accounting/persist'
import { BULK_BATCH } from '@/lib/accounting/journal-bulk'
import { parseQbJournal } from '@/lib/accounting/quickbooks/parse-journal'
import { buildEntries } from '@/lib/accounting/quickbooks/build-entries'
import { ACTUAL_BOOK } from '@/lib/accounting/books'

/**
 * Step 3: import the Journal export as DRAFT journal entries.
 *
 * NOTHING POSTS. Every entry is reviewed on the journal page and posted through the existing
 * bulk-post surface — an import that posted directly would need REVERSING when a mapping turns
 * out wrong, instead of simply being re-run.
 *
 * Idempotent by `source_ref = qb:<hash>`: re-importing after fixing one mapping updates the
 * count of matched entries rather than duplicating the ledger.
 *
 * POST — { text, group?, dryRun?, sourceLabel? }
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const body = await req.json().catch(() => ({}))
  if (typeof body?.text !== 'string' || !body.text.trim()) {
    return NextResponse.json({ error: 'Nothing to import.' }, { status: 400 })
  }
  const dryRun = !!body?.dryRun

  const group = await resolveGroupOr400(admin, gate.fundId, body?.group ?? null)
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { transactions, errors: parseErrors } = parseQbJournal(body.text)

  const { data: mappingRows } = await (admin as any).from('qb_account_mappings')
    .select('qb_account, account_code, excluded')
    .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)

  const mapping = new Map<string, string>()
  const excluded = new Set<string>()
  for (const r of ((mappingRows as any[]) ?? [])) {
    if (r.excluded) { excluded.add(r.qb_account); continue }
    if (r.account_code) mapping.set(r.qb_account, r.account_code)
  }

  // A transaction touching an excluded account is dropped whole — importing half of a
  // double-entry transaction would post something that does not balance.
  const skippedForExclusion: string[] = []
  const importable = transactions.filter(t => {
    const hit = t.lines.find(l => excluded.has(l.account))
    if (!hit) return true
    skippedForExclusion.push(`${t.type ?? 'Transaction'} ${t.num ?? t.date}: touches excluded account "${hit.account}".`)
    return false
  })

  const accountIds = await accountIdByCode(admin, gate.fundId, group)
  const { entries, skipped } = buildEntries(importable, mapping, accountIds, gate.fundId)

  // Which of these have we already imported? Batched: a decade of history is thousands of
  // refs, and one .in() of that size fails.
  const refs = entries.map(e => e.sourceRef!).filter(Boolean)
  const present = new Set<string>()
  for (let i = 0; i < refs.length; i += BULK_BATCH) {
    const chunk = refs.slice(i, i + BULK_BATCH)
    const { data } = await admin.from('journal_entries' as any)
      .select('source_ref')
      .eq('book', ACTUAL_BOOK)
      .eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
      .in('source_ref', chunk)
    for (const r of ((data as any[]) ?? [])) present.add(r.source_ref)
  }

  const toCreate = entries.filter(e => !present.has(e.sourceRef!))
  const writeErrors: string[] = [...parseErrors, ...skippedForExclusion, ...skipped.map(s => s.reason)]

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      transactionsParsed: transactions.length,
      wouldCreate: toCreate.length,
      alreadyPresent: entries.length - toCreate.length,
      skipped: skipped.length + skippedForExclusion.length,
      errors: writeErrors,
    })
  }

  let created = 0
  for (const entry of toCreate) {
    const result = await persistEntry(admin, gate.fundId, group, user.id, entry, 'draft')
    if ('error' in result) {
      // persistEntry refuses to write into a closed period. During a migration that is a real
      // possibility, so surface it as a named skip rather than a failed run.
      writeErrors.push(`${entry.entryDate} ${entry.memo ?? ''}: ${result.error}`)
      continue
    }
    created += 1
  }

  await (admin as any).from('qb_import_runs').insert({
    fund_id: gate.fundId,
    vehicle_id: vehicleId,
    source_label: body?.sourceLabel ?? null,
    transactions_parsed: transactions.length,
    entries_created: created,
    entries_matched: entries.length - toCreate.length,
    transactions_skipped: skipped.length + skippedForExclusion.length,
    errors: writeErrors.length ? writeErrors : null,
    created_by: user.id,
  })

  return NextResponse.json({
    transactionsParsed: transactions.length,
    created,
    alreadyPresent: entries.length - toCreate.length,
    skipped: skipped.length + skippedForExclusion.length,
    errors: writeErrors,
  })
}

// GET — the import history for this vehicle, so a third pass can see what the second did.
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertWriteAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  const group = await resolveGroupOr400(admin, gate.fundId, req.nextUrl.searchParams.get('group'))
  if (group instanceof NextResponse) return group
  const vehicleId = await vehicleIdByName(admin, gate.fundId, group)

  const { data } = await (admin as any).from('qb_import_runs')
    .select('*').eq('fund_id', gate.fundId).eq('vehicle_id', vehicleId)
    .order('created_at', { ascending: false }).limit(20)
  return NextResponse.json({ runs: data ?? [] })
}
