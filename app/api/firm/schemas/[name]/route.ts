import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ensureDefaults, getActiveSchema, saveSchema } from '@/lib/memo-agent/firm-schemas'
import { SCHEMA_NAMES, type SchemaName } from '@/lib/memo-agent/validate'

export async function GET(_req: NextRequest, { params }: { params: { name: string } }) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId } = guard

  const name = params.name as SchemaName
  if (!SCHEMA_NAMES.includes(name)) {
    return NextResponse.json({ error: 'Unknown schema' }, { status: 400 })
  }

  await ensureDefaults(fundId, admin)
  const schema = await getActiveSchema(fundId, name, admin)
  if (!schema) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  return NextResponse.json({ schema })
}

export async function PUT(req: NextRequest, { params }: { params: { name: string } }) {
  const guard = await ensureAdmin()
  if ('error' in guard) return guard.error
  const { admin, fundId, userId } = guard

  const name = params.name as SchemaName
  if (!SCHEMA_NAMES.includes(name)) {
    return NextResponse.json({ error: 'Unknown schema' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const yamlContent = typeof body.yaml === 'string' ? body.yaml : ''
  const editNote = typeof body.editNote === 'string' ? body.editNote : null
  const acceptWarnings = req.nextUrl.searchParams.get('confirm_breaks') === 'true'

  if (!yamlContent.trim()) {
    return NextResponse.json({ error: 'yaml is required' }, { status: 400 })
  }

  const result = await saveSchema(
    fundId,
    name,
    yamlContent,
    userId,
    editNote,
    { acceptWarnings },
    admin,
  )

  if (!result.ok) {
    // 409 when warnings blocked the save, 400 when validation errors did.
    const status = result.errors.length > 0 ? 400 : 409
    return NextResponse.json({ ok: false, errors: result.errors, warnings: result.warnings }, { status })
  }

  return NextResponse.json({ ok: true, schema: result.schema, warnings: result.warnings })
}

// ---------------------------------------------------------------------------

interface AdminGuard {
  admin: ReturnType<typeof createAdminClient>
  fundId: string
  userId: string
}

async function ensureAdmin(): Promise<AdminGuard | { error: NextResponse }> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return { error: NextResponse.json({ error: 'No fund found' }, { status: 403 }) }
  if ((membership as any).role !== 'admin') return { error: NextResponse.json({ error: 'Admin required' }, { status: 403 }) }

  return { admin, fundId: (membership as any).fund_id as string, userId: user.id }
}
