import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveFund } from '@/lib/api-helpers'
import { SearchParamsError, parseSearchParams, searchCompanyUpdates } from '@/lib/company-updates/search'

/**
 * Portfolio update search — the Company Updates corpus only, never the mailbox. Query params:
 *   q, company_ids (csv), since, until (inclusive ISO dates), order (relevance|newest),
 *   match (auto|lexical|exact), latest_per_company (true), limit (1-100), cursor, excerpts (0-10).
 * Counting, ranking, latest-per-company selection and pagination all happen in SQL, scoped to the
 * caller's fund. Invalid input is a 400, not an empty page.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const fund = await resolveFund(admin, user.id)
  if (fund instanceof NextResponse) return fund

  try {
    const params = parseSearchParams(fund.fundId, Object.fromEntries(req.nextUrl.searchParams.entries()))
    const started = Date.now()
    const response = await searchCompanyUpdates(admin as any, params)
    return NextResponse.json({ ...response, latency_ms: Date.now() - started })
  } catch (err) {
    if (err instanceof SearchParamsError) return NextResponse.json({ error: err.message }, { status: 400 })
    console.error('[company-updates/search] failed:', err)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
