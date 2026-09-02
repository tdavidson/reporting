import type { SupabaseClient } from '@supabase/supabase-js'
import { loadAccessContext } from '@/lib/access/effective'
import type { AnalystPrincipal } from './types'

/** Resolve a session/token user to a live fund principal; never accepts fund or role from input. */
export async function resolveAnalystPrincipal(
  admin: SupabaseClient,
  userId: string,
): Promise<AnalystPrincipal | null> {
  const { data: membership, error } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!membership) return null

  const access = await loadAccessContext(admin, membership.fund_id, userId, membership.role)
  return {
    userId,
    fundId: membership.fund_id,
    role: membership.role,
    access,
  }
}
