import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DealDetail } from './deal-detail'

export const metadata: Metadata = { title: 'Deal' }

export default async function DealPage({ params }: { params: { id: string } }) {
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

  const { data: deal } = await admin
    .from('inbound_deals')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', membership.fund_id)
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
