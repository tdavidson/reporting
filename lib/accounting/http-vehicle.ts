import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveVehicle } from './vehicle-resolver'

/**
 * Resolve the vehicle (portfolio_group) for a request: the explicit value, or the
 * fund's sole vehicle. Returns a 400 NextResponse when it's ambiguous/missing.
 */
export async function resolveGroupOr400(
  admin: SupabaseClient,
  fundId: string,
  requested?: string | null
): Promise<string | NextResponse> {
  try {
    return await resolveVehicle(admin, fundId, requested ?? undefined)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 })
  }
}
