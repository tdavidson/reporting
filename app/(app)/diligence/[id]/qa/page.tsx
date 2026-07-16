import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { QAChat } from './qa-chat'

export const metadata: Metadata = { title: 'Q&A' }

export default async function QAPage({ params }: { params: { id: string } }) {
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
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')

  const fundId = (membership as any).fund_id as string

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, name')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) notFound()

  return <QAChat dealId={params.id} dealName={(deal as any).name} />
}
