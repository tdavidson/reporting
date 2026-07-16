import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { InboxView } from './inbox-view'

export const metadata: Metadata = { title: 'Memo Inbox' }

export default async function InboxPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // A server component fetches its own data — the middleware never sees it. See the sibling
  // diligence pages: this needs the domain gate of its own.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'diligence')) redirect('/dashboard')


  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')

  return <InboxView />
}
