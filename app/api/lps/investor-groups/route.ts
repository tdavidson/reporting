import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'

/**
 * Admin-only: the fund's portfolio groups (vehicles / SPVs) mapped to the
 * investors who hold a position in each — derived from investment data across
 * all snapshots. Powers "select all investors in a fund/SPV" in the Share modal.
 */
export async function GET() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin') return NextResponse.json({ error: 'Admin access required' }, { status: 403 })

  const { data: investors } = await (admin as any).from('lp_investors').select('id').eq('fund_id', writeCheck.fundId)
  const investorIds = (investors ?? []).map((i: any) => i.id as string)
  if (investorIds.length === 0) return NextResponse.json({ groups: [] })

  const { data: entities } = await (admin as any).from('lp_entities').select('id, investor_id').in('investor_id', investorIds)
  const entityToInvestor = new Map<string, string>((entities ?? []).map((e: any) => [e.id, e.investor_id]))
  const entityIds = Array.from(entityToInvestor.keys())
  if (entityIds.length === 0) return NextResponse.json({ groups: [] })

  const { data: investments } = await (admin as any)
    .from('lp_investments').select('portfolio_group, entity_id').in('entity_id', entityIds)

  const groupMap = new Map<string, Set<string>>()
  for (const inv of (investments ?? [])) {
    const investorId = entityToInvestor.get((inv as any).entity_id)
    const group = (inv as any).portfolio_group
    if (!investorId || !group) continue
    if (!groupMap.has(group)) groupMap.set(group, new Set())
    groupMap.get(group)!.add(investorId)
  }

  const groups = Array.from(groupMap.entries())
    .map(([name, ids]) => ({ name, investor_ids: Array.from(ids) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return NextResponse.json({ groups })
}
