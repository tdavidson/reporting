import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { LpPortalDashboard } from './lp-portal-dashboard'

export const metadata: Metadata = { title: 'LP Documents' }

export default async function LpPortalPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const page = await resolvePageAccess(user.id)
  if (!page) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: fs } = await (admin as any)
    .from('fund_settings')
    .select('lp_portal_enabled')
    .eq('fund_id', page.fundId)
    .maybeSingle()

  // Master switch off → page unavailable to everyone.
  if (!fs?.lp_portal_enabled) redirect('/dashboard')

  // The fund's lp_portal switch AND this user's lp_relations grant.
  if (!canViewPage(page, 'lp_relations', 'lp_portal')) redirect('/dashboard')

  return <LpPortalDashboard />
}
