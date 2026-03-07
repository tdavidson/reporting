import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { InteractionsContent } from './interactions-content'

export const metadata: Metadata = { title: 'Interactions' }

export default async function InteractionsPage() {
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

  const { data: interactions } = await admin
    .from('interactions')
    .select('id, fund_id, company_id, email_id, user_id, tags, subject, summary, intro_contacts, body_preview, interaction_date, created_at')
    .eq('fund_id', membership.fund_id)
    .order('interaction_date', { ascending: false })
    .limit(100)

  // Batch-load company names
  const companyIds = Array.from(new Set((interactions ?? []).map((i: any) => i.company_id).filter(Boolean))) as string[]
  const companyNameMap: Record<string, string> = {}
  if (companyIds.length > 0) {
    const { data: companies } = await admin
      .from('companies')
      .select('id, name')
      .in('id', companyIds) as { data: { id: string; name: string }[] | null }
    for (const c of companies ?? []) {
      companyNameMap[c.id] = c.name
    }
  }

  const enriched = (interactions ?? []).map((i: any) => ({
    ...i,
    company_name: i.company_id ? companyNameMap[i.company_id] ?? null : null,
  }))

  return <InteractionsContent interactions={enriched} />
}
