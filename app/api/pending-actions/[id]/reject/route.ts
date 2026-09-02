import { NextResponse } from 'next/server'
import { revalidateTag } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveBrowserPrincipal } from '@/lib/pending-actions/browser-principal'
import { PendingActionServiceError, rejectPendingAction } from '@/lib/pending-actions/service'

/**
 * Reject a staged action from the browser. Rejecting is a decision about a write, so it requires
 * the row's domain WRITE, mirroring approve — and it goes through the same service, which claims
 * the row conditionally rather than reading it and hoping it is still pending.
 */
export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const admin = createAdminClient()
  const principal = await resolveBrowserPrincipal(admin)
  if (principal instanceof NextResponse) return principal

  try {
    const result = await rejectPendingAction(admin, principal, params.id)
    revalidateTag('pending-actions-badge')
    return NextResponse.json({ ok: true, replayed: result.replayed })
  } catch (error) {
    if (error instanceof PendingActionServiceError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status })
    }
    console.error('[pending-actions] reject failed', error)
    return NextResponse.json({ ok: false, error: 'The action could not be rejected.' }, { status: 500 })
  }
}
