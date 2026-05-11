import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { rollbackSchema } from '@/lib/memo-agent/firm-schemas'
import { SCHEMA_NAMES, type SchemaName } from '@/lib/memo-agent/validate'

export async function POST(req: NextRequest, { params }: { params: { name: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!membership) return NextResponse.json({ error: 'No fund found' }, { status: 403 })
  if ((membership as any).role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 })

  const name = params.name as SchemaName
  if (!SCHEMA_NAMES.includes(name)) {
    return NextResponse.json({ error: 'Unknown schema' }, { status: 400 })
  }

  const body = await req.json().catch(() => ({}))
  const targetVersionId = typeof body.versionId === 'string' ? body.versionId : ''
  if (!targetVersionId) {
    return NextResponse.json({ error: 'versionId is required' }, { status: 400 })
  }

  const result = await rollbackSchema((membership as any).fund_id, name, targetVersionId, user.id, admin)
  if (!result.ok) {
    return NextResponse.json({ ok: false, errors: result.errors }, { status: 400 })
  }
  return NextResponse.json({ ok: true, schema: result.schema })
}
