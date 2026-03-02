import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Returns the user's fund membership, or a 403 response if the user
 * has a read-only (viewer) role and cannot perform mutations.
 */
export async function assertWriteAccess(
  admin: SupabaseClient,
  userId: string
): Promise<{ fundId: string; role: string } | NextResponse> {
  const { data: membership } = await admin
    .from('fund_members')
    .select('fund_id, role')
    .eq('user_id', userId)
    .maybeSingle()

  if (!membership)
    return NextResponse.json({ error: 'No fund found' }, { status: 403 })

  if (membership.role === 'viewer')
    return NextResponse.json(
      { error: 'This is a read-only demo. Changes are not allowed.' },
      { status: 403 }
    )

  return { fundId: membership.fund_id, role: membership.role }
}
