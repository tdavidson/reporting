import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MemoEditor } from './memo-editor'

export const metadata: Metadata = { title: 'Memo draft' }

export default async function DraftPage({ params }: { params: { id: string; draftId: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

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

  const { data: attention } = await admin
    .from('diligence_attention_items')
    .select('id, deal_id, draft_id, kind, urgency, body, links, status, created_at')
    .eq('deal_id', params.id)
    .eq('fund_id', fundId)
    .order('created_at', { ascending: false })

  return (
    <MemoEditor
      dealId={params.id}
      dealName={(deal as any).name}
      draft={draft as any}
      initialAttention={(attention as any) ?? []}
      isAdmin={isAdmin}
    />
  )
}
