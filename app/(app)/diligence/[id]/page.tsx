import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { DealDetail } from './deal-detail'

export const metadata: Metadata = { title: 'Deal' }

export default async function DiligenceDealPage({ params }: { params: { id: string } }) {
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

  const fundId = (membership as any).fund_id as string

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) notFound()

  const [{ data: documents }, { data: latestDraft }] = await Promise.all([
    admin
      .from('diligence_documents')
      .select('id, deal_id, file_name, file_format, file_size_bytes, detected_type, type_confidence, parse_status, drive_source_url, uploaded_at')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .order('uploaded_at', { ascending: false }),
    admin
      .from('diligence_memo_drafts')
      .select('id, draft_version, agent_version, is_draft, created_at, finalized_at')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  return (
    <DealDetail
      deal={deal as any}
      initialDocuments={(documents as any) ?? []}
      latestDraft={latestDraft as any}
      isAdmin={(membership as any).role === 'admin'}
      currentUserId={user.id}
    />
  )
}
