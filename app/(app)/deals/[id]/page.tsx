import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { DealDetail } from './deal-detail'

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

  const { data: deal } = await admin
    .from('inbound_deals')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', page.fundId)
    .maybeSingle()
  if (!deal) notFound()

  const { data: email } = await admin
    .from('inbound_emails')
    .select('id, from_address, subject, received_at, raw_payload, routing_label, routing_confidence, routing_reasoning')
    .eq('id', (deal as any).email_id)
    .maybeSingle()

  let priorDeal: { id: string; company_name: string | null; created_at: string | null } | null = null
  if ((deal as any).prior_deal_id) {
    const { data } = await admin
      .from('inbound_deals')
      .select('id, company_name, created_at')
      .eq('id', (deal as any).prior_deal_id)
      .maybeSingle()
    priorDeal = data as typeof priorDeal
  }

  return <DealDetail deal={deal as any} email={email as any} priorDeal={priorDeal} />
}
