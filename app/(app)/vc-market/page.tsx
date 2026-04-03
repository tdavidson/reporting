import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { VCMarketClient } from './vc-market-client'

export const metadata: Metadata = { title: 'VC Market' }

export default async function VCMarketPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const { data: membership } = await supabase
    .from('fund_members')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle() as { data: { role: string } | null }

  const isAdmin = membership?.role === 'admin'

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAdminClient() as any
  const [pendingRes, dealsRes] = await Promise.all([
    admin.from('vc_deals_pending')
      .select('created_at')
      .eq('source', 'scrape')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from('vc_deals')
      .select('created_at')
      .eq('source', 'scrape')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const candidates = [
    (pendingRes.data as { created_at: string } | null)?.created_at,
    (dealsRes.data as { created_at: string } | null)?.created_at,
  ].filter(Boolean) as string[]

  const lastScrapedAt = candidates.length > 0
    ? candidates.reduce((a, b) => (a > b ? a : b))
    : null

  return <VCMarketClient isAdmin={isAdmin} lastScrapedAt={lastScrapedAt} />
}
