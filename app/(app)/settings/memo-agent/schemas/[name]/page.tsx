import type { Metadata } from 'next'
import { redirect, notFound } from 'next/navigation'
import { createClient, getUser } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolvePageAccess, canViewPage } from '@/lib/access/page-gate'
import { ensureDefaults, getActiveSchema } from '@/lib/memo-agent/firm-schemas'
import { SCHEMA_NAMES, type SchemaName } from '@/lib/memo-agent/validate'
import { SchemaEditor } from './schema-editor'

export const metadata: Metadata = { title: 'Schema editor' }

export default async function SchemaEditorPage(props: { params: Promise<{ name: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getUser()
  if (!user) redirect('/auth')

  const name = params.name as SchemaName
  if (!SCHEMA_NAMES.includes(name)) notFound()

  const admin = createAdminClient()
  // These pages configure the diligence agent and render its schemas server-side, so the domain
  // has to be checked here — the middleware only sees the API calls the editors make later.
  // Member-level, not admin-only: the fund decides who gets diligence, and the grant decides who
  // gets to tune it.
  const page = await resolvePageAccess(user.id)
  if (!page || !canViewPage(page, 'diligence')) redirect('/dashboard')

  await ensureDefaults(page.fundId, admin)
  const schema = await getActiveSchema(page.fundId, name, admin)
  if (!schema) notFound()

  return <SchemaEditor schemaName={name} initialContent={schema.yaml_content} initialVersion={schema.schema_version} />
}
