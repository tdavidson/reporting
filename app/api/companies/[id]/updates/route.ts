import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFund } from '@/lib/api-helpers'
import { SearchParamsError, listCompanyUpdates } from '@/lib/company-updates/search'

/**
 * A company's reporting timeline: reverse-chronological Company Updates, cursor-paginated.
 * Metadata and previews only — full bodies come from /api/company-updates/[id], artifact text from
 * /api/company-updates/[id]/artifacts/[artifactId]. Gated `portfolio` by the middleware; the fund
 * is resolved from membership and the company is checked against it before anything is read.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const fund = await resolveFund(admin, user.id)
  if (fund instanceof NextResponse) return fund

  const { data: company } = await admin
    .from('companies')
    .select('id')
    .eq('id', params.id)
    .eq('fund_id', fund.fundId)
    .eq('holding_type', 'company') // reporting email attaches to companies; fund holdings have their own surfaces
    .maybeSingle()
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = limitParam ? Number(limitParam) : 20
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    return NextResponse.json({ error: 'limit must be an integer between 1 and 50' }, { status: 400 })
  }

  try {
    const page = await listCompanyUpdates(admin as any, {
      fundId: fund.fundId,
      companyId: params.id,
      cursor: req.nextUrl.searchParams.get('cursor'),
      limit,
    })
    return NextResponse.json(page)
  } catch (err) {
    if (err instanceof SearchParamsError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[companies/updates] failed:', err)
    return NextResponse.json({ error: 'Could not load updates' }, { status: 500 })
  }
}
