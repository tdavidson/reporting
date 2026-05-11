import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureDefaults, getActiveSchema } from '@/lib/memo-agent/firm-schemas'
import { SCHEMA_NAMES, type SchemaName } from '@/lib/memo-agent/validate'
import { SchemaEditor } from './schema-editor'

export const metadata: Metadata = { title: 'Schema editor' }

export default async function SchemaEditorPage({ params }: { params: { name: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/auth')

  const name = params.name as SchemaName
  if (!SCHEMA_NAMES.includes(name)) notFound()

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) redirect('/dashboard')
  if ((membership as any).role !== 'admin') redirect('/settings')

  await ensureDefaults((membership as any).fund_id, admin)
  const schema = await getActiveSchema((membership as any).fund_id, name, admin)
  if (!schema) notFound()

  return <SchemaEditor schemaName={name} initialContent={schema.yaml_content} initialVersion={schema.schema_version} />
}
