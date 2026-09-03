import { notFound } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagementCompany } from '@/lib/vehicle-kinds'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve a `/manco/[id]` route param to a management company.
 *
 * `[id]` is the stable `fund_vehicles.id`, the same way companies, LPs and funds are addressed —
 * routing on the id survives a rename and sidesteps names with slashes.
 *
 * A vehicle that is NOT a management company is a 404 here rather than a redirect to its fund page.
 * The id came from somewhere — a stale bookmark, or a URL typed by someone probing — and quietly
 * showing them the fund instead would mean this route could be used to confirm which vehicles a
 * fund holds. Same for an id from another fund, which the `fund_id` filter turns into the same 404.
 */
export async function resolveMancoParam(
  fundId: string,
  rawParam: string,
): Promise<{ vehicle: string; vehicleId: string; active: boolean }> {
  const id = decodeURIComponent(rawParam)
  // Checked before the query, not after: `fund_vehicles.id` is a uuid column, and PostgREST answers
  // a non-uuid filter with a 400 rather than an empty result — so `/manco/anything` would surface a
  // database error page instead of a 404.
  if (!UUID.test(id)) notFound()

  const { data } = await createAdminClient()
    .from('fund_vehicles' as any)
    .select('id, name, kind, active')
    .eq('fund_id', fundId)
    .eq('id', id)
    .maybeSingle()

  const row = data as any
  if (!row || !isManagementCompany(row.kind)) notFound()
  return { vehicle: row.name as string, vehicleId: row.id as string, active: !!row.active }
}
