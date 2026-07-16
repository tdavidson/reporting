import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { DiligenceIndex } from './diligence-index'

export const metadata: Metadata = { title: 'Diligence' }

export default async function DiligencePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // A SERVER COMPONENT FETCHES ITS OWN DATA — the middleware never sees it, so being in the route
  // registry does nothing here. Diligence is IC-grade material (memo drafts, call transcripts,
  // evidence) and defaults to off; without this gate a member denied it still got the page
  // server-rendered in full.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'diligence')) redirect('/dashboard')


  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')

  const { data: deals } = await admin
    .from('diligence_deals')
    .select('id, name, sector, stage_at_consideration, deal_status, current_memo_stage, lead_partner_id, promoted_company_id, created_at, updated_at')
    .eq('fund_id', (membership as any).fund_id)
    .order('updated_at', { ascending: false })
    .limit(200)

  const isAdmin = (membership as any).role === 'admin'
  return <DiligenceIndex initialDeals={(deals as any) ?? []} isAdmin={isAdmin} />
}
