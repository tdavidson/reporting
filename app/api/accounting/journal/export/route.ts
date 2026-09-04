import { NextRequest, NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
// accounting domain (lib/access/route-domains.ts).
import { assertReadAccess } from '@/lib/api-helpers'
import { resolveGroupOr400 } from '@/lib/accounting/http-vehicle'
import { rateLimit } from '@/lib/rate-limit'
import { resolvePeriod, customPeriod, type PeriodPreset } from '@/lib/accounting/statement-period'
import { loadJournalForExport } from '@/lib/accounting/journal-export-load'
import { journalRows, quickbooksJournalRows } from '@/lib/accounting/journal-export'
import { toCsv } from '@/lib/accounting/csv'

// GET — the journal as a file.
//   ?format=csv (default) | xlsx | quickbooks
//   ?preset=… or ?start=&end=    the same window the journal page shows (default YTD)
//   ?status=posted (default) | all (draft + posted) | draft
//
// `quickbooks` is the layout of QuickBooks' Journal report — the one lib/accounting/quickbooks
// reads — so the file loads into QuickBooks or back into a fresh vehicle here.
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const sp = req.nextUrl.searchParams
  const group = await resolveGroupOr400(admin, gate, sp.get('group'))
  if (group instanceof NextResponse) return group

  const limited = await rateLimit({ key: `journal-export:${user.id}`, limit: 30, windowSeconds: 300 })
  if (limited) return limited

  const preset = (sp.get('preset') as PeriodPreset | null) ?? 'ytd'
  const period = preset === 'custom' ? customPeriod(sp.get('start'), sp.get('end')) : resolvePeriod(preset)
  const statusParam = sp.get('status') ?? 'posted'
  const statuses = statusParam === 'all' ? ['draft', 'posted'] : ['draft', 'posted', 'void'].includes(statusParam) ? [statusParam] : ['posted']
  const format = sp.get('format') ?? 'csv'

  const entries = await loadJournalForExport(admin, gate.fundId, group, { start: period.start, end: period.end, statuses })
  const stem = `journal-${group}-${period.start ?? 'inception'}-${period.end ?? 'today'}`.replace(/[^a-zA-Z0-9\-]/g, '-')

  if (format === 'xlsx') {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(journalRows(entries)), 'Journal')
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
    return new NextResponse(buf, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${stem}.xlsx"`,
      },
    })
  }

  const quickbooks = format === 'quickbooks'
  const csv = toCsv(quickbooks ? quickbooksJournalRows(entries) : journalRows(entries))
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${stem}${quickbooks ? '-quickbooks' : ''}.csv"`,
    },
  })
}
