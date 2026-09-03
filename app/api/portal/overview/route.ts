import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'
import { overviewFromLive, type LiveOverviewRow } from '@/lib/lp-overview'
import { lastDataDates } from '@/lib/accounting/lp-positions'
import { generateLiveReport } from '@/lib/accounting/live-report'

/**
 * LP portal — the signed-in LP's portfolio overview: headline totals and a
 * per-vehicle breakdown, taken from the most recent snapshot that carries their
 * data. Scoped strictly to the investors resolveLpAccess grants, and only for
 * funds whose LP portal is switched on.
 */
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds, lpAccountId } = access

  const { data: account } = await (admin as any)
    .from('lp_accounts').select('display_name').eq('id', lpAccountId).maybeSingle()
  const investorName = (account?.display_name as string | null) ?? null

  const empty = { investorName, currency: 'USD', hasData: false }
  if (investorIds.length === 0) return NextResponse.json(empty)

  // The LP's entities and the funds behind them.
  const { data: entities } = await (admin as any)
    .from('lp_entities').select('id, fund_id').in('investor_id', investorIds)
  const entityRows = (entities ?? []) as any[]
  const entityIds = new Set(entityRows.map(e => e.id as string))
  const fundIds = Array.from(new Set(entityRows.map(e => e.fund_id as string)))
  if (entityIds.size === 0 || fundIds.length === 0) return NextResponse.json(empty)

  // Only funds with the portal enabled expose figures; use the first one's currency.
  const { data: settings } = await (admin as any)
    .from('fund_settings').select('fund_id, lp_portal_enabled, currency').in('fund_id', fundIds)
  const enabledFundIds = ((settings ?? []) as any[]).filter(s => s.lp_portal_enabled).map(s => s.fund_id as string)
  if (enabledFundIds.length === 0) return NextResponse.json(empty)
  const currency = ((settings ?? []) as any[]).find(s => s.lp_portal_enabled)?.currency ?? 'USD'

  // The GP publishes the LIVE report to chosen LPs (lp_live_report_shares) — no frozen snapshot.
  // Only funds where THIS LP's investor is published show figures.
  const { data: shares } = await (admin as any)
    .from('lp_live_report_shares').select('fund_id').in('fund_id', enabledFundIds).in('lp_investor_id', investorIds)
  const sharedFundIds = Array.from(new Set(((shares ?? []) as any[]).map(s => s.fund_id as string)))
  if (sharedFundIds.length === 0) return NextResponse.json({ investorName, currency, hasData: false })

  // Derive the live report for each shared fund and keep only THIS LP's rows (the same data /lps
  // shows, sliced to this LP). Look-through member rows carry the member's own entity_id, so the
  // entity filter captures them too.
  const liveRows: LiveOverviewRow[] = []
  const vehicleDates = new Map<string, string | null>()
  for (const fid of sharedFundIds) {
    const report = await generateLiveReport(admin, fid)
    const mine = report.rows.filter(r => entityIds.has(r.entity_id))
    for (const r of mine) {
      liveRows.push({ portfolio_group: r.portfolio_group, commitment: r.commitment, paid_in_capital: r.paid_in_capital, distributions: r.distributions, nav: r.nav })
    }
    const groups = Array.from(new Set(mine.map(r => r.portfolio_group)))
    const m = await lastDataDates(admin, fid, groups)
    for (const [name, date] of Array.from(m.entries())) {
      const prev = vehicleDates.get(name) ?? null
      if (date && (!prev || date > prev)) vehicleDates.set(name, date)
      else if (!vehicleDates.has(name)) vehicleDates.set(name, prev)
    }
  }

  const overview = overviewFromLive(liveRows, vehicleDates)
  if (!overview) return NextResponse.json({ investorName, currency, hasData: false })

  return NextResponse.json({ investorName, currency, hasData: true, ...overview })
}
