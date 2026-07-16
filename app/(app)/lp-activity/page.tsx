import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { LpActivityDashboard } from './lp-activity-dashboard'

export const metadata: Metadata = { title: 'LP Activity' }

export default async function LpActivityPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const page = await resolvePageAccess(user.id)
  if (!page) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: fundSettings } = await (admin as any)
    .from('fund_settings')
    .select('lp_portal_enabled')
    .eq('fund_id', page.fundId)
    .maybeSingle()

  // Master switch off → the LP portal (and its activity log) is unavailable.
  if (!fundSettings?.lp_portal_enabled) redirect('/dashboard')

  // The fund's lp_activity switch AND this user's lp_relations grant.
  if (!canViewPage(page, 'lp_relations', 'lp_activity')) redirect('/dashboard')

  return <LpActivityDashboard />
}
