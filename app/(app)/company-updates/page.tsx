import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { loadCompanyUpdatesPage } from './load'
import { CompanyUpdatesPageView } from './page-view'

export const metadata: Metadata = { title: 'Company updates' }

/**
 * Portfolio update search: the Company Updates corpus only — never deal flow, diligence, audit or
 * operational mail. The page is `portfolio`; the search itself runs through
 * /api/company-updates/search, which the middleware gates the same way.
 */
export default async function CompanyUpdatesPage() {
  const supabase = await createClient()
  const user = await getUser()
  if (!user) redirect('/auth')

  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'portfolio')) redirect('/dashboard')

  const admin = createAdminClient()
  const data = await loadCompanyUpdatesPage({ supabase, admin, user, page })
  return <CompanyUpdatesPageView {...data} />
}
