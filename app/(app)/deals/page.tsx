import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { DealsContent } from './deals-content'
import { DEFAULT_STATUSES } from '@/lib/deals/statuses'

export const metadata: Metadata = { title: 'Deals' }

export default async function DealsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  // A SERVER COMPONENT FETCHES ITS OWN DATA — with the ADMIN client, so neither the middleware nor
  // RLS is in the path. Membership alone used to be the whole test, which meant every member saw
  // every founder pitch server-rendered even in a fund where the Deals product is off (its
  // default). The domain is the test.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'dealflow')) redirect('/dashboard')

  // Same default the client's status filter starts on — otherwise the first paint
  // shows every deal and then drops half of them once the client refetches.
  const { data: deals } = await admin
    .from('inbound_deals')
    .select('id, email_id, company_name, company_url, company_domain, founder_name, founder_email, intro_source, referrer_name, thesis_fit_score, stage, industry, raise_amount, status, prior_deal_id, created_at')
    .eq('fund_id', page.fundId)
    .in('status', DEFAULT_STATUSES)
    .order('created_at', { ascending: false })
    .limit(500)

  return <DealsContent initialDeals={(deals as any) ?? []} />
}
