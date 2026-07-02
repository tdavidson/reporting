import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Server-side gate for the Accounting section. The sidebar visibility flag is
 * cosmetic — hidden features are still reachable by URL — so every accounting
 * page and /api/accounting route must enforce admin access here. Resolves the
 * caller's fund or redirects away for non-admins.
 */
export async function requireAccountingAdmin(): Promise<{ fundId: string }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()

  if (!membership) redirect('/dashboard')
  if ((membership as { role: string }).role !== 'admin') redirect('/dashboard')

  return { fundId: (membership as { fund_id: string }).fund_id }
}
