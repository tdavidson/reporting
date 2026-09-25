import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { DealDetail } from './deal-detail'
import { loadDealPage } from './load'

export const metadata: Metadata = { title: 'Deal' }

export default async function DealPage(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getUser()
  if (!user) redirect('/auth')
  const admin = createAdminClient()

  // Server-rendered with the admin client: the middleware and RLS are both out of the path, so the
  // domain check has to happen here or the pitch is readable by any member with the URL.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'dealflow')) redirect('/dashboard')

  const data = await loadDealPage({ supabase, admin, user, page }, params)
  if (!data) notFound()
  return <DealDetail {...data} />
}
