import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { InboundEmail, Company } from '@/lib/types/database'

const PAGE_SIZE = 50

type EmailListRow = Pick<
  InboundEmail,
  'id' | 'from_address' | 'subject' | 'received_at' | 'processing_status' | 'metrics_extracted' | 'company_id'
> & { companies: Pick<Company, 'id' | 'name'> | null }

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sp = req.nextUrl.searchParams
  const status = sp.get('status')
  const companyId = sp.get('company_id')
  const dateFrom = sp.get('date_from')
  const dateTo = sp.get('date_to')
  const page = Math.max(1, parseInt(sp.get('page') ?? '1', 10))

  let query = supabase
    .from('inbound_emails')
    .select(
      'id, from_address, subject, received_at, processing_status, metrics_extracted, company_id, companies(id, name)',
      { count: 'exact' }
    )
    .order('received_at', { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)

  if (status) query = query.eq('processing_status', status)
  if (companyId) query = query.eq('company_id', companyId)
  if (dateFrom) query = query.gte('received_at', dateFrom)
  if (dateTo) query = query.lte('received_at', dateTo)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []) as unknown as EmailListRow[]

  const items = rows.map(e => ({
    id: e.id,
    from_address: e.from_address,
    subject: e.subject,
    received_at: e.received_at,
    processing_status: e.processing_status,
    metrics_extracted: e.metrics_extracted,
    company: e.companies ?? null,
  }))

  return NextResponse.json({
    total: count ?? 0,
    page,
    page_size: PAGE_SIZE,
    items,
  })
}
