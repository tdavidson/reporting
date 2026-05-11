import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveAnchors, getSynthesisConfidence } from '@/lib/memo-agent/style-anchors'
import { StyleAnchorsLibrary } from './library'

export const metadata: Metadata = { title: 'Style anchors' }

export default async function StyleAnchorsPage() {
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
  if ((membership as any).role !== 'admin') redirect('/settings')

  const anchors = await getActiveAnchors((membership as any).fund_id, admin)
  const confidence = getSynthesisConfidence(anchors.length)

  // Strip extracted_text from the initial payload — the UI only needs metadata.
  const stripped = anchors.map(a => ({
    ...a,
    extracted_text: a.extracted_text ? `${a.extracted_text.slice(0, 200)}…` : null,
    extracted_text_length: a.extracted_text?.length ?? 0,
  })) as any

  return <StyleAnchorsLibrary initialAnchors={stripped} initialConfidence={confidence} />
}
