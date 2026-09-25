import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { loadDiligenceDealPage } from './load'
import { DealDetail } from './deal-detail'

export const metadata: Metadata = { title: 'Deal' }

export default async function DiligenceDealPage(
  props: { params: Promise<{ id: string }>; searchParams?: Promise<{ tab?: string }> }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
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
  const data = await loadDiligenceDealPage({ supabase, admin, user, page }, params)
  if (!data) notFound()
  return <DealDetail {...data} initialTab={searchParams?.tab === 'data-room' ? 'Data Room' : 'Checklist'} />
}
