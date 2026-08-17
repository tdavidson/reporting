import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { getActiveAnchors, getSynthesisConfidence } from '@/lib/memo-agent/style-anchors'
import { StyleAnchorsLibrary } from './library'

export const metadata: Metadata = { title: 'Example memos' }

export default async function StyleAnchorsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  // These pages configure the diligence agent and render its schemas server-side, so the domain
  // has to be checked here — the middleware only sees the API calls the editors make later.
  // Member-level, not admin-only: the fund decides who gets diligence, and the grant decides who
  // gets to tune it.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'diligence')) redirect('/dashboard')

  const anchors = await getActiveAnchors(page.fundId, admin)
  const confidence = getSynthesisConfidence(anchors.length)

  // Strip extracted_text from the initial payload — the UI only needs metadata.
  const stripped = anchors.map(a => ({
    ...a,
    extracted_text: a.extracted_text ? `${a.extracted_text.slice(0, 200)}…` : null,
    extracted_text_length: a.extracted_text?.length ?? 0,
  })) as any

  return <StyleAnchorsLibrary initialAnchors={stripped} initialConfidence={confidence} />
}
