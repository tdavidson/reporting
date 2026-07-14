import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Server-side gate for the Accounting section. The sidebar visibility flag is
 * cosmetic — hidden features are still reachable by URL — so every accounting page
 * enforces access here. Resolves the caller's fund or redirects away.
 *
 * `viewer` is admitted alongside `admin`: that's the read-only demo role, and the
 * demo needs to SHOW the books. It cannot change them — every accounting write still
 * goes through `assertAdminAccess`, which rejects `viewer`. A plain `member` is still
 * turned away, matching the section's admin-only posture for real funds.
 */
export async function requireAccountingAccess(): Promise<{ fundId: string; role: string }> {
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
  const role = (membership as { role: string }).role
  if (role !== 'admin' && role !== 'viewer') redirect('/dashboard')

  return { fundId: (membership as { fund_id: string }).fund_id, role }
}
