import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './load'
import { vehicleIdByName } from './vehicle-id'
import { ACTUAL_BOOK, type LedgerBook } from './books'
import type { ExportEntry } from './journal-export'
import type { ChartExportAccount } from './journal-export'
import type { AccountType } from './types'

// The database side of the exports — kept out of journal-export.ts so that module stays pure.

/**
 * Every entry in the window with its postings and account codes, straight from the tables
 * rather than the paginated journal search: an export is the whole thing or it is not an export.
 * Posted only by default; `statuses` widens it.
 */
export async function loadJournalForExport(
  admin: SupabaseClient,
  fundId: string,
  group: string,
  opts: { start?: string | null; end?: string | null; statuses?: string[]; adjusting?: boolean; book?: LedgerBook } = {},
): Promise<ExportEntry[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const statuses = opts.statuses?.length ? opts.statuses : ['posted']
  const rows = await fetchAllRows<any>((f, t) => {
    let q = admin
      .from('journal_entries' as any)
      .select('id, entry_date, memo, source_type, source_ref, status, adjusting, journal_postings(id, account_id, amount, currency, chart_of_accounts(code, name))')
      .eq('book', opts.book ?? ACTUAL_BOOK)
      .eq('fund_id', fundId)
      .eq('vehicle_id', vehicleId)
      .in('status', statuses)
      .order('entry_date', { ascending: true })
      .order('id', { ascending: true })
    if (opts.start) q = q.gte('entry_date', opts.start)
    if (opts.end) q = q.lte('entry_date', opts.end)
    if (opts.adjusting !== undefined) q = q.eq('adjusting', opts.adjusting)
    return q.range(f, t)
  })
  return rows.map(r => ({
    id: r.id,
    entryDate: r.entry_date,
    memo: r.memo ?? null,
    sourceType: r.source_type ?? null,
    sourceRef: r.source_ref ?? null,
    status: r.status,
    adjusting: r.adjusting === true,
    postings: ((r.journal_postings as any[]) ?? [])
      .slice()
      .sort((a, b) => String(a.id).localeCompare(String(b.id)))
      .map(p => ({
        accountCode: p.chart_of_accounts?.code ?? '',
        accountName: p.chart_of_accounts?.name ?? '',
        amount: Number(p.amount),
        currency: p.currency ?? 'USD',
      })),
  }))
}

/** The vehicle's chart with its active flag — the posted-ledger loader drops it. */
export async function loadChartForExport(admin: SupabaseClient, fundId: string, group: string): Promise<ChartExportAccount[]> {
  const vehicleId = await vehicleIdByName(admin, fundId, group)
  const rows = await fetchAllRows<any>((f, t) => admin
    .from('chart_of_accounts' as any)
    .select('id, code, name, type, subtype, lp_entity_id, company_id, is_active')
    .eq('fund_id', fundId)
    .eq('vehicle_id', vehicleId)
    .order('code', { ascending: true })
    .range(f, t))
  return rows.map(a => ({
    id: a.id, fundId, code: a.code, name: a.name, type: a.type as AccountType, subtype: a.subtype ?? null,
    lpEntityId: a.lp_entity_id ?? null, companyId: a.company_id ?? null, isActive: a.is_active ?? true,
  }))
}
