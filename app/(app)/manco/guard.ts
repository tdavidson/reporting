import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'

/**
 * Server-side gate for the Management company section — the twin of app/(app)/funds/guard.ts, and
 * for the same reason: a server component queries Postgres itself, usually with the admin client,
 * so the only gate on it is the one it calls.
 *
 * It resolves through `canViewPage` like every other page gate, which is what makes the
 * `management_company` grant mean the same thing on a page as it does on a route.
 */
export async function requireMancoAccess(): Promise<{ fundId: string; role: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'management_company')) redirect('/dashboard')

  return { fundId: page.fundId, role: page.role }
}

/**
 * The gate for a management company's LEDGER pages — the journal, the bank feed, the statements,
 * the period close, the QuickBooks import.
 *
 * BOTH grants, and the conjunction is the point in both directions:
 *
 *   - `management_company`, because the ledger being read is the firm's, and its payroll is the
 *     reason that domain exists.
 *   - `accounting`, because these pages render the SHARED accounting views, which call
 *     `/api/accounting/*`. The middleware gates those on `accounting` before any of this runs, so
 *     a page that admitted someone without it would render an interface whose every request 403s —
 *     the "link to a page that doesn't work" failure the nav rules elsewhere in this codebase are
 *     written to avoid.
 *
 * The practical effect is that a manco-only bookkeeper gets the dashboard, the chart, the
 * statements and intercompany (all `/api/manco/*`, this section's own routes) but has to be granted
 * fund accounting as well to hand-author journal entries. That is a real limitation and the safe
 * direction to be wrong in; widening it means giving the manco module its own copy of the journal
 * and bank stack, which is a lot of duplicated ledger code to save one grant.
 */
export async function requireMancoLedgerAccess(): Promise<{ fundId: string; role: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'management_company')) redirect('/dashboard')
  if (!canViewPage(page, 'accounting')) redirect('/manco')

  return { fundId: page.fundId, role: page.role }
}
