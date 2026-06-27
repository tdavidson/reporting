import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Admin-only "view as LP" preview (read-only). Given an investor in the admin's
 * own fund, returns exactly what that LP would see in their portal — snapshots,
 * finalized letters, and documents (fund-wide + investor-scoped) — scoped to the
 * admin's fund. This is NOT impersonation: the admin stays themselves; their own
 * fund-admin role authorizes previewing their fund's LP view. The portal's
 * lp_portal_enabled gate is deliberately ignored here so admins can preview
 * before turning the portal on; the live state is returned as `portal_enabled`.
 */
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Any fund member may preview the LP portal (read-only); the demo viewer uses this.
  const { data: membership } = await admin.from('fund_members').select('fund_id').eq('user_id', user.id).maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  const fundId = membership.fund_id

  const investorId = new URL(req.url).searchParams.get('investor_id') ?? ''
  if (!investorId) return NextResponse.json({ error: 'investor_id is required' }, { status: 400 })

  const { data: investor } = await (admin as any)
    .from('lp_investors').select('id, name').eq('id', investorId).eq('fund_id', fundId).maybeSingle()
  if (!investor) return NextResponse.json({ error: 'Investor not found in your fund' }, { status: 404 })

  const { data: ef } = await (admin as any).from('fund_settings').select('lp_portal_enabled').eq('fund_id', fundId).maybeSingle()

  const [{ data: snapShares }, { data: letterShares }, { data: fundDocs }, { data: invDocShares }] = await Promise.all([
    (admin as any).from('lp_snapshot_shares').select('lp_snapshots(id, name, as_of_date)').eq('lp_investor_id', investorId).eq('fund_id', fundId),
    (admin as any).from('lp_letter_shares').select('lp_letters(id, period_label, period_year, period_quarter, status)').eq('lp_investor_id', investorId).eq('fund_id', fundId),
    (admin as any).from('lp_documents').select('id, title, file_name, size_bytes, category, doc_date, uploaded_at, scope, storage_path').eq('fund_id', fundId).eq('scope', 'fund'),
    (admin as any).from('lp_document_shares').select('lp_documents(id, title, file_name, size_bytes, category, doc_date, uploaded_at, scope, storage_path)').eq('lp_investor_id', investorId),
  ])

  const snapshots = (snapShares ?? [])
    .map((s: any) => s.lp_snapshots)
    .filter(Boolean)
    .sort((a: any, b: any) => (b.as_of_date ?? '').localeCompare(a.as_of_date ?? ''))

  const letters = (letterShares ?? [])
    .map((s: any) => s.lp_letters)
    .filter((l: any) => l && l.status !== 'generating')
    .sort((a: any, b: any) => b.period_year - a.period_year || b.period_quarter - a.period_quarter)

  const documents = [
    ...(fundDocs ?? []),
    ...(invDocShares ?? []).map((s: any) => s.lp_documents).filter((d: any) => d && d.scope === 'investor'),
  ].map((d: any) => ({ ...d, sample: String(d.storage_path ?? '').startsWith('sample/'), storage_path: undefined }))

  return NextResponse.json({
    investor: { id: investor.id, name: investor.name },
    portal_enabled: !!ef?.lp_portal_enabled,
    snapshots,
    letters,
    documents,
  })
}
