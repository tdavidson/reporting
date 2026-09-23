import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { loadDashboardPage } from './load'
import { DashboardPageView } from './page-view'

export const metadata: Metadata = { title: 'Portfolio' }

export default async function DashboardPage() {
  const supabase = await createClient()
  const user = await getUser()
  if (!user) redirect('/auth')
  const admin = createAdminClient()

  // Server-rendered portfolio data. The sidebar already hides this entry from a member without
  // `portfolio` (app-sidebar's canSee), which is exactly the state where the URL still worked.
  //
  // Denied users go to /settings, not /dashboard: this IS /dashboard, and every other page's
  // denial redirect points here, so sending them back would spin.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'portfolio')) redirect('/settings')

  const data = await loadDashboardPage({ supabase, admin, user, page })
  return <DashboardPageView {...data} />
}
