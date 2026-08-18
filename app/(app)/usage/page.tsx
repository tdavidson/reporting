import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { UsageDashboard } from './usage-dashboard'

export const metadata: Metadata = { title: 'Usage' }

export default async function UsagePage() {
  const user = await getUser()
  if (!user) redirect('/auth')

  // Same answer as the hand-rolled role check this replaces — the `admin` domain is adminOnly —
  // but expressed through the one resolver, so the page states its domain like every other.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'admin')) redirect('/dashboard')

  return <UsageDashboard />
}
