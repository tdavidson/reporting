import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DealsContent } from './deals-content'

export const metadata: Metadata = { title: 'Deals' }

export default async function DealsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')

  const { data: deals } = await admin
    .from('inbound_deals')
    .select('id, email_id, company_name, company_url, company_domain, founder_name, founder_email, intro_source, referrer_name, thesis_fit_score, stage, industry, raise_amount, status, prior_deal_id, created_at')
    .eq('fund_id', membership.fund_id)
    .neq('status', 'archived')
    .order('created_at', { ascending: false })
    .limit(200)

  return <DealsContent initialDeals={(deals as any) ?? []} />
}
