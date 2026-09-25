import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { DealsContent } from './deals-content'
import { loadDealsPage } from './load'

export const metadata: Metadata = { title: 'Deals' }

export default async function DealsPage() {
  const supabase = await createClient()
  const user = await getUser()
  if (!user) redirect('/auth')
  const admin = createAdminClient()

  // A SERVER COMPONENT FETCHES ITS OWN DATA — with the ADMIN client, so neither the middleware nor
  // RLS is in the path. Membership alone used to be the whole test, which meant every member saw
  // every founder pitch server-rendered even in a fund where the Deals product is off (its
  // default). The domain is the test.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'dealflow')) redirect('/dashboard')

  const data = await loadDealsPage({ supabase, admin, user, page })
  return <DealsContent {...data} />
}
