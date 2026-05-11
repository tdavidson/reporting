import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DiligenceIndex } from './diligence-index'

export const metadata: Metadata = { title: 'Diligence' }

export default async function DiligencePage() {
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
    .from('diligence_deals')
    .select('id, name, sector, stage_at_consideration, deal_status, current_memo_stage, lead_partner_id, promoted_company_id, created_at, updated_at')
    .eq('fund_id', (membership as any).fund_id)
    .order('updated_at', { ascending: false })
    .limit(200)

  return <DiligenceIndex initialDeals={(deals as any) ?? []} />
}
