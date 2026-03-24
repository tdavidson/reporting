import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertWriteAccess } from '@/lib/api-helpers'
import { dbError } from '@/lib/api-error'

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string; metricId: string } }
) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()

  const writeCheck = await assertWriteAccess(admin, user.id)
  if (writeCheck instanceof NextResponse) return writeCheck
  if (writeCheck.role !== 'admin')
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })

  const { data: metric } = await admin
    .from('metrics')
    .select('id')
    .eq('id', params.metricId)
    .eq('company_id', params.id)
    .maybeSingle()

  if (!metric) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active
  if (typeof body.display_order === 'number') updates.display_order = body.display_order

  if (Object.keys(updates).length === 0)
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })

  const { data, error } = await admin
    .from('metrics')
    .update(updates)
    .eq('id', params.metricId)
    .select()
    .maybeSingle()

  if (error) return dbError(error, 'metrics')
  return NextResponse.json(data)
}
