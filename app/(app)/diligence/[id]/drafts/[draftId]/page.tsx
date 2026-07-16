import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { MemoEditor } from './memo-editor'
import { buildSourceLabels } from '@/lib/memo-agent/render/source-labels'

export const metadata: Metadata = { title: 'Memo draft' }

export default async function DraftPage({ params }: { params: { id: string; draftId: string } }) {
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
  const isAdmin = (membership as any).role === 'admin'

  const { data: draft } = await admin
    .from('diligence_memo_drafts')
    .select('*')
    .eq('id', params.draftId)
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!draft) notFound()

  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, name')
    .eq('id', params.id)
    .eq('fund_id', fundId)
    .maybeSingle()
  if (!deal) notFound()

  const [{ data: attention }, { data: docs }] = await Promise.all([
    admin
      .from('diligence_attention_items')
      .select('id, deal_id, draft_id, kind, urgency, body, links, status, created_at')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId)
      .order('created_at', { ascending: false }),
    // Citations point at claims, and claims live under documents in the ingestion
    // output. Pull the file names here so a citation can name the document it came
    // from rather than printing a bare claim id.
    admin
      .from('diligence_documents')
      .select('id, file_name')
      .eq('deal_id', params.id)
      .eq('fund_id', fundId),
  ])

  const documentNames = Object.fromEntries(
    ((docs as any[]) ?? []).map(d => [d.id as string, (d.file_name ?? '') as string])
  )
  const sourceLabels = Object.fromEntries(
    buildSourceLabels({
      ingestion: (draft as any).ingestion_output ?? null,
      research: (draft as any).research_output ?? null,
      qa: (draft as any).qa_answers ?? null,
      documentNames,
    })
  )

  return (
    <MemoEditor
      dealId={params.id}
      dealName={(deal as any).name}
      draft={draft as any}
      initialAttention={(attention as any) ?? []}
      sourceLabels={sourceLabels}
      isAdmin={isAdmin}
    />
  )
}
