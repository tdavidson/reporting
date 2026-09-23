import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { loadDiligencePage } from './load'
import { DiligenceIndex } from './diligence-index'

export const metadata: Metadata = { title: 'Diligence' }

export default async function DiligencePage() {
  const supabase = await createClient()
  const user = await getUser()
  if (!user) redirect('/auth')

  // A SERVER COMPONENT FETCHES ITS OWN DATA — the middleware never sees it, so being in the route
  // registry does nothing here. Diligence is IC-grade material (memo drafts, call transcripts,
  // evidence) and defaults to off; without this gate a member denied it still got the page
  // server-rendered in full.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'diligence')) redirect('/dashboard')

  const admin = createAdminClient()
  const data = await loadDiligencePage({ supabase, admin, user, page })
  return <DiligenceIndex {...data} />
}
