import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { loadAccessContext, hasAccess } from '@/lib/access/effective'
import { getWriteAction } from '@/lib/pending-actions/registry'
import { revalidateTag } from 'next/cache'

/**
 * Reject a staged action. Rejecting is a decision about a write, so it requires the row's domain
 * WRITE, mirroring approve. Ungated in the registry; the check is enforced here.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const admin = createAdminClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate
  const access = await loadAccessContext(admin, gate.fundId, user.id, gate.role)

  const { data: row } = await admin
    .from('pending_actions' as any)
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', gate.fundId)
    .maybeSingle()
  const typedRow = row as { id: string; action_type: string; status: string } | null
  if (!typedRow || typedRow.status !== 'pending') {
    return NextResponse.json({ error: 'Not found or not pending' }, { status: 404 })
  }

  const action = getWriteAction(typedRow.action_type)
  if (!action) return NextResponse.json({ error: 'Unknown action type' }, { status: 400 })
  if (!hasAccess(access, action.domain, 'write', action.accessFeature)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await admin
    .from('pending_actions' as any)
    .update({ status: 'rejected', approved_by: user.id, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', typedRow.id)

  revalidateTag('pending-actions-badge')
  return NextResponse.json({ ok: true })
}
