import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Promote a diligence deal to a portfolio company. Either creates a new
 * `companies` row from the deal name (the common case) or links to an existing
 * company (when the partner picks one). Sets diligence_deals.promoted_company_id
 * and flips deal_status to 'won'.
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const fundId = (membership as any).fund_id as string

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, fund_id, name, sector, promoted_company_id')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if ((deal as any).promoted_company_id) {
    return NextResponse.json({ error: 'Already promoted', company_id: (deal as any).promoted_company_id }, { status: 409 })
  }

  const body = await req.json().catch(() => ({}))
  const existingCompanyId = typeof body.company_id === 'string' ? body.company_id : null

  let companyId: string
  if (existingCompanyId) {
    // Verify the company belongs to the same fund.
    const { data: company } = await admin
      .from('companies')
      .select('id, fund_id')
      .eq('id', existingCompanyId)
      .maybeSingle()
    if (!company || (company as any).fund_id !== fundId) {
      return NextResponse.json({ error: 'Invalid company_id' }, { status: 400 })
    }
    companyId = existingCompanyId
  } else {
    // Create a new company row from the deal.
    const { data: created, error: createErr } = await admin
      .from('companies')
      .insert({
        fund_id: fundId,
        name: (deal as any).name,
      } as any)
      .select('id')
      .single()
    if (createErr || !created) {
      return NextResponse.json({ error: createErr?.message ?? 'Failed to create company' }, { status: 500 })
    }
    companyId = (created as { id: string }).id
  }

  await admin
    .from('diligence_deals')
    .update({ promoted_company_id: companyId, deal_status: 'won' })
    .eq('id', params.id)
    .eq('fund_id', fundId)

  return NextResponse.json({ ok: true, company_id: companyId })
}
