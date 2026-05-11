import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { AnchorEditor } from './editor'

export const metadata: Metadata = { title: 'Reference memo' }

export default async function StyleAnchorEditorPage({ params }: { params: { id: string } }) {
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
  if ((membership as any).role !== 'admin') redirect('/settings')

  const { data: anchor } = await admin
    .from('style_anchor_memos')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', (membership as any).fund_id)
    .maybeSingle()
  if (!anchor) notFound()

  return <AnchorEditor anchor={anchor as any} />
}
