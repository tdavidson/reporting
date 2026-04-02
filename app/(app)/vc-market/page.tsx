import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { VcMarketClient } from './vc-market-client'

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

  return <VcMarketClient isAdmin={isAdmin} />
}
