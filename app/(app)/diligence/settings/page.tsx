import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { DiligenceSettingsEditor } from './settings-editor'

export const metadata: Metadata = { title: 'Diligence Settings' }

/**
 * Diligence settings — open to any fund member (not admin-only). Hosts the
 * editable per-stage prompt guidance and links to the schema / style / model
 * settings.
 */
export default async function DiligenceSettingsPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')

  return <DiligenceSettingsEditor />
}
