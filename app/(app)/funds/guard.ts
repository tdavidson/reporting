import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'

/**
 * Server-side gate for the Accounting section. The sidebar visibility flag is cosmetic — hidden
 * features are still reachable by URL — so every accounting page enforces access here. Resolves
 * the caller's fund or redirects away.
 *
 * It asks the ONE resolver, and that is the whole point. This used to admit `admin|viewer` by role
 * and never look at the `accounting` grant, which made the grant a lie in one direction: a fund
 * that set Fund accounting to "Members" and granted someone write watched every accounting API
 * serve them while every accounting PAGE redirected them to the dashboard. That is the exact
 * contradiction tests/route-gates-honour-grants.test.ts was written to end on the route side —
 * "a second, coarser, contradictory policy is not defence in depth."
 *
 * What the resolver answers, and why each case is right:
 *   - admin, accounting on   → write. Unchanged.
 *   - admin, accounting off  → NONE, and now redirected. Previously the pages rendered and every
 *                              API on them 403'd, because the middleware already resolved this way.
 *   - viewer (the read-only demo) → read, so the demo still SHOWS the books. Writes are refused
 *                              downstream by assertAdminAccess, which rejects viewer.
 *   - member with the grant  → admitted, which is what granting it meant.
 *   - member without         → redirected, as before.
 */
export async function requireAccountingAccess(): Promise<{ fundId: string; role: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'accounting')) redirect('/dashboard')

  return { fundId: page.fundId, role: page.role }
}
