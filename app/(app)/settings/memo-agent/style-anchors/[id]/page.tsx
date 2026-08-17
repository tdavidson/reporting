import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { AnchorEditor } from './editor'

export const metadata: Metadata = { title: 'Reference memo' }

export default async function StyleAnchorEditorPage({ params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  // These pages configure the diligence agent and render its schemas server-side, so the domain
  // has to be checked here — the middleware only sees the API calls the editors make later.
  // Member-level, not admin-only: the fund decides who gets diligence, and the grant decides who
  // gets to tune it.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'diligence')) redirect('/dashboard')

  const { data: anchor } = await admin
    .from('style_anchor_memos')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', page.fundId)
    .maybeSingle()
  if (!anchor) notFound()

  return <AnchorEditor anchor={anchor as any} />
}
