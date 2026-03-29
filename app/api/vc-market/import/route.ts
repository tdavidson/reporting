import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import * as XLSX from 'xlsx'

function parseDate(raw: unknown): string | null {
  if (!raw) return null
  if (typeof raw === 'number') {
    const date = XLSX.SSF.parse_date_code(raw)
    if (date) return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`
  }
  const s = String(raw).trim()
  if (!s) return null
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return null
}

function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.]/g, ''))
  return isNaN(n) ? null : n
}

function parseInvestors(raw: unknown): string[] {
  if (!raw) return []
  return String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean)
}

export async function POST(req: NextRequest) {
  try {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' })

    const deals: Record<string, unknown>[] = []
    const errors: string[] = []

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const company = String(row['Company Name'] ?? row['company_name'] ?? '').trim()
      if (!company) { errors.push(`Row ${i + 2}: missing Company Name`); continue }

      deals.push({
        user_id:      user.id,
        company_name: company,
        amount_usd:   parseAmount(row['Amount USD'] ?? row['amount_usd']),
        deal_date:    parseDate(row['Date'] ?? row['deal_date']),
        stage:        String(row['Stage'] ?? row['stage'] ?? '').trim() || null,
        investors:    parseInvestors(row['Investors'] ?? row['investors']),
        segment:      String(row['Segment'] ?? row['segment'] ?? '').trim() || null,
        country:      String(row['Country'] ?? row['country'] ?? '').trim() || null,
        source_url:   String(row['Source URL'] ?? row['source_url'] ?? '').trim() || null,
        source:       'import',
      })
    }

    if (deals.length === 0) {
      return NextResponse.json({ inserted: 0, skipped: 0, errors })
    }

    const admin = createAdminClient()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: inserted, error } = await (admin as any)
      .from('vc_deals')
      .upsert(deals, { onConflict: 'user_id,company_name,deal_date', ignoreDuplicates: true })
      .select('id')

    if (error) throw error

    return NextResponse.json({
      inserted: inserted?.length ?? deals.length,
      skipped:  deals.length - (inserted?.length ?? deals.length),
      errors,
    })
  } catch (err) {
    console.error('[vc-market/import]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
