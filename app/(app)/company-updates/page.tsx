import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getUser } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { UpdatesSearch } from './updates-search'

export const metadata: Metadata = { title: 'Company updates' }

/**
 * Portfolio update search: the Company Updates corpus only — never deal flow, diligence, audit or
 * operational mail. The page is `portfolio`; the search itself runs through
 * /api/company-updates/search, which the middleware gates the same way.
 */
export default async function CompanyUpdatesPage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'portfolio')) redirect('/dashboard')

  const admin = createAdminClient()
  const { data: companies } = await admin
    .from('companies')
    .select('id, name')
    .eq('fund_id', page.fundId)
    .eq('holding_type', 'company')
    .order('name') as { data: Array<{ id: string; name: string }> | null }

  return (
    <div className="p-4 md:p-8">
      <div className="mb-6 max-w-page">
        <h1 className="text-2xl font-semibold tracking-tight">Company updates</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search what portfolio companies have reported — the message, its attachments, and where each passage came from.
        </p>
      </div>
      <UpdatesSearch companies={companies ?? []} />
    </div>
  )
}
