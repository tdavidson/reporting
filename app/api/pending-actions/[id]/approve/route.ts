import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertReadAccess } from '@/lib/api-helpers'
import { loadAccessContext, hasAccess } from '@/lib/access/effective'
import { getWriteAction } from '@/lib/pending-actions/registry'
import { revalidateTag } from 'next/cache'

/**
 * Approve a staged action: the domain is resolved from the ROW and WRITE is required (drafting
 * only needed read). On success the real `execute` runs — the same write path the direct API uses —
 * and the row flips to 'applied'; on failure it flips to 'failed' with the error (no partial-
 * success claim). Route is ungated in the registry; the write check is enforced here.
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
  const typedRow = row as { id: string; action_type: string; args: Record<string, unknown>; status: string } | null
  if (!typedRow || typedRow.status !== 'pending') {
    return NextResponse.json({ error: 'Not found or not pending' }, { status: 404 })
  }

  const action = getWriteAction(typedRow.action_type)
  if (!action) return NextResponse.json({ error: 'Unknown action type' }, { status: 400 })
  if (!hasAccess(access, action.domain, 'write', action.accessFeature)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const result = await action.execute({ admin, fundId: gate.fundId, userId: user.id, access }, typedRow.args)
    await admin
      .from('pending_actions' as any)
      .update({
        status: 'applied',
        applied_result: result,
        approved_by: user.id,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', typedRow.id)
    revalidateTag('pending-actions-badge')
    return NextResponse.json({ ok: true, result })
  } catch (e) {
    const message = (e as Error).message
    await admin
      .from('pending_actions' as any)
      .update({ status: 'failed', error: message, updated_at: new Date().toISOString() })
      .eq('id', typedRow.id)
    revalidateTag('pending-actions-badge')
    return NextResponse.json({ ok: false, error: message })
  }
}
