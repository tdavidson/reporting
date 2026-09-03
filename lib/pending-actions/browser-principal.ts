import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { assertReadAccess } from '@/lib/api-helpers'
import { loadAccessContext } from '@/lib/access/effective'
import type { AnalystPrincipal } from '@/lib/ai/analyst/types'

/**
 * Resolve the cookie-authenticated caller into the same `AnalystPrincipal` the OAuth boundary
 * builds, so the browser routes and `/api/v1` can share one pending-action service instead of
 * keeping two implementations that drift.
 *
 * Returns a NextResponse when the caller has no business here, which the route returns as-is.
 */
export async function resolveBrowserPrincipal(
  admin: SupabaseClient,
): Promise<AnalystPrincipal | NextResponse> {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const gate = await assertReadAccess(admin, user.id)
  if (gate instanceof NextResponse) return gate

  return {
    userId: user.id,
    fundId: gate.fundId,
    role: gate.role,
    access: await loadAccessContext(admin, gate.fundId, user.id, gate.role),
    credentialKind: 'cookie',
  }
}
