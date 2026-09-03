import { NextResponse } from 'next/server'
import { expireTag } from '@/lib/cache/tags'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveBrowserPrincipal } from '@/lib/pending-actions/browser-principal'
import { approvePendingAction, PendingActionServiceError } from '@/lib/pending-actions/service'

/**
 * Approve a staged action from the browser.
 *
 * SEC-007: this route used to read the row, check `status === 'pending'`, run the write, and only
 * then flip the status. Two clicks — or one click and a retry — could both pass the check before
 * either had written anything, and both would execute. For a capital call or an investment that is
 * a duplicated financial entry, not a duplicated request.
 *
 * `approvePendingAction` claims the row first with a conditional update (`.eq('status','pending')`)
 * and executes only if the claim came back, so concurrency is resolved by Postgres rather than by
 * hoping the two requests do not overlap. It also re-resolves the row's domain and re-checks the
 * caller's CURRENT write access, which is why approving is not merely "you could see the queue".
 *
 * The HTTP shape is unchanged — `{ ok: true, result }`, or a status with `{ error }` — because the
 * pending-actions page and the Analyst cards read exactly that.
 */
export async function POST(_req: Request, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const admin = createAdminClient()
  const principal = await resolveBrowserPrincipal(admin)
  if (principal instanceof NextResponse) return principal

  try {
    const result = await approvePendingAction(admin, principal, params.id)
    expireTag('pending-actions-badge')
    return NextResponse.json({ ok: true, result: result.result, replayed: result.replayed })
  } catch (error) {
    if (error instanceof PendingActionServiceError) {
      // The service marks the row 'failed' before throwing ACTION_FAILED, so the queue is already
      // consistent by the time the browser sees this.
      expireTag('pending-actions-badge')
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    console.error('[pending-actions] approve failed', error)
    return NextResponse.json({ ok: false, error: 'The action could not be approved.' }, { status: 500 })
  }
}
