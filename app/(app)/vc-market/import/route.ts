import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import * as XLSX from 'xlsx'
import type { ImportResult } from '@/lib/vc-market/types'
 
// Expected Excel columns (case-insensitive header matching)
const COL_MAP: Record<string, string> = {
  'company name': 'company_name',
  company:        'company_name',
  empresa:        'company_name',
  'amount usd':   'amount_usd',
  amount:         'amount_usd',
  valor:          'amount_usd',
  'amount (usd)': 'amount_usd',
  date:           'deal_date',
  data:           'deal_date',
  'deal date':    'deal_date',
  stage:          'stage',
  estagio:        'stage',
  estágio:        'stage',
  investors:      'investors',
  investidores:   'investors',
  investor:       'investors',
  segment:        'segment',
  segmento:       'segment',
  vertical:       'segment',
  country:        'country',
  pais:           'country',
  país:           'country',
  'source url':   'source_url',
  source:         'source_url',
  url:            'source_url',
  link:           'source_url',
}
 
function normalizeHeader(h: string): string {
  return h.toString().toLowerCase().trim()
}
 
function parseDate(raw: unknown): string | null {
  if (!raw) return null
  // Excel serial number
  if (typeof raw === 'number') {
    const d = XLSX.SSF.parse_date_code(raw)
    if (d) return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`
  }
  const s = String(raw).trim()
  const d = new Date(s)
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0]
  return null
}
 
function parseAmount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null
  const n = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^0-9.-]/g, ''))
  return isNaN(n) ? null : n
}
 
function parseInvestors(raw: unknown): string[] {
  if (!raw) return []
  return String(raw)
    .split(/[,;|\/]/)
    .map(s => s.trim())
    .filter(Boolean)
}
 
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
 
  // Get the user's fund_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: membership } = await (supabase as any)
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { fund_id: string } | null }
 
  if (!membership?.fund_id) {
    return NextResponse.json({ error: 'No fund membership found' }, { status: 403 })
  }
  const fundId = membership.fund_id
 
  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
 
  const buffer = Buffer.from(await file.arrayBuffer())
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return NextResponse.json({ error: 'Empty workbook' }, { status: 400 })
 
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
  if (rows.length < 2) return NextResponse.json({ error: 'No data rows found' }, { status: 400 })
 
  // Map header row to field names
  const headers = (rows[0] as unknown[]).map(h => normalizeHeader(String(h)))
  const fieldMap = headers.map(h => COL_MAP[h] ?? null)
 
  const result: ImportResult = { inserted: 0, skipped: 0, errors: [] }
 
  const toInsert: Record<string, unknown>[] = []
 
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] as unknown[]
    const record: Record<string, unknown> = {
      fund_id: fundId,
      investors: [],
      source: 'import',
    }
 
    for (let j = 0; j < fieldMap.length; j++) {
      const field = fieldMap[j]
      if (!field) continue
      const val = row[j]
 
      if (field === 'amount_usd')  record.amount_usd  = parseAmount(val)
      else if (field === 'deal_date')  record.deal_date  = parseDate(val)
      else if (field === 'investors')  record.investors  = parseInvestors(val)
      else if (val !== '' && val !== null && val !== undefined) record[field] = String(val).trim()
    }
 
    const companyName = record.company_name as string | undefined
    if (!companyName?.trim()) {
      result.skipped++
      continue
    }
 
    toInsert.push(record)
  }
 
  if (toInsert.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any).from('vc_deals').insert(toInsert)
    if (error) {
      result.errors.push(error.message)
    } else {
      result.inserted = toInsert.length
    }
  }
 
  return NextResponse.json(result)
}
