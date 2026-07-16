import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { LpCapitalView } from './view'

export const metadata: Metadata = { title: 'LP capital accounts' }

/**
 * LP capital accounts, in the LPs section — the canonical home for them.
 *
 * Gated on `lp_tracking`, NOT on accounting: this works whether or not the fund keeps books.
 * When a vehicle is on the ledger, the accounts come from it; otherwise they come from the
 * pasted / manually-entered dated positions edited on this same page. Either way it is the
 * same capital-account statement — a tracking-only one just has fewer lines.
 */
export default async function LpCapitalPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  // Both axes, resolved by the same function the APIs on this page go through: the fund's
  // lp_tracking switch, and this user's lp_capital grant. Checking only the switch would render
  // a page whose every request 403s.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'lp_capital', 'lp_tracking')) redirect('/dashboard')

  return (
    <div className="px-4 md:pl-8 md:pr-4 pt-4 md:pt-6 pb-8 w-full">
      <LpCapitalView isAdmin={page.isAdmin} />
    </div>
  )
}
