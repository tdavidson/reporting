import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveLpAccess } from '@/lib/api-helpers'

/**
 * LP portal — documents visible to the signed-in LP: fund-wide docs for funds
 * they belong to, plus investor-scoped docs shared with their investors. Both
 * gated by lp_portal_enabled. Scoped strictly via resolveLpAccess.
 */
export async function GET() {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const access = await resolveLpAccess(admin, user.id)
  if (access instanceof NextResponse) return access
  const { investorIds } = access
  if (investorIds.length === 0) return NextResponse.json({ documents: [] })

  // The LP's funds, then which of those have the portal switched on.
  const { data: invRows } = await (admin as any).from('lp_investors').select('fund_id').in('id', investorIds)
  const fundIds = Array.from(new Set((invRows ?? []).map((r: any) => r.fund_id as string)))
  if (fundIds.length === 0) return NextResponse.json({ documents: [] })
  const { data: ef } = await (admin as any).from('fund_settings').select('fund_id').eq('lp_portal_enabled', true).in('fund_id', fundIds)
  const enabledFunds = new Set((ef ?? []).map((f: any) => f.fund_id as string))
  if (enabledFunds.size === 0) return NextResponse.json({ documents: [] })
  const enabledFundIds = Array.from(enabledFunds)

  const byId = new Map<string, any>()
  const add = (d: any, scope: string) => { if (d && !byId.has(d.id)) byId.set(d.id, { id: d.id, title: d.title, file_name: d.file_name, mime_type: d.mime_type, size_bytes: d.size_bytes, uploaded_at: d.uploaded_at, category: d.category ?? null, doc_date: d.doc_date ?? null, scope }) }

  // Fund-wide docs for the LP's enabled funds.
  const { data: fundDocs } = await (admin as any)
    .from('lp_documents')
    .select('id, title, file_name, mime_type, size_bytes, uploaded_at, category, doc_date')
    .eq('scope', 'fund')
    .in('fund_id', enabledFundIds)
  for (const d of (fundDocs ?? [])) add(d, 'fund')

  // Investor-scoped docs shared with the LP's investors.
  const { data: shares } = await (admin as any)
    .from('lp_document_shares')
    .select('lp_documents(id, title, file_name, mime_type, size_bytes, uploaded_at, scope, fund_id, category, doc_date)')
    .in('lp_investor_id', investorIds)
  for (const s of (shares ?? [])) {
    const d = (s as any).lp_documents
    if (d && d.scope === 'investor' && enabledFunds.has(d.fund_id)) add(d, 'investor')
  }

  const documents = Array.from(byId.values()).sort((a, b) => (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''))
  return NextResponse.json({ documents })
}
