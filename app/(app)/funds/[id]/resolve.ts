import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { isManagementCompany } from '@/lib/vehicle-kinds'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Resolve a `/funds/[id]` route param to a vehicle. `[id]` is normally the stable
 * `fund_vehicles` UUID; a legacy vehicle with no registry row is addressed by its name
 * directly (the ledger keys on the name either way). Returns the name the views scope on
 * and the id (null for legacy) the switcher/sidebar route on.
 */
export async function resolveVehicleParam(
  fundId: string,
  rawParam: string,
): Promise<{ vehicle: string; vehicleId: string | null }> {
  const raw = decodeURIComponent(rawParam)
  // Legacy vehicles are addressed by NAME, and `fund_vehicles.id` is a uuid column — PostgREST
  // answers a non-uuid filter with an error rather than an empty result, so the shape is checked
  // before the query rather than the result after it.
  if (!UUID.test(raw)) return { vehicle: raw, vehicleId: null }

  const { data: veh } = await (createAdminClient() as any)
    .from('fund_vehicles')
    .select('name, kind')
    .eq('fund_id', fundId)
    .eq('id', raw)
    .maybeSingle()

  // A management company reached through a fund URL — a bookmark from before it had a section of
  // its own, or a link built by hand. Send it there rather than rendering the fund detail page,
  // which would ask fund-economics for a vehicle that view deliberately excludes and then report
  // "not found" for an entity that plainly exists. `/manco/[id]` re-gates on `management_company`,
  // so this hands nothing to someone holding only `accounting`.
  if (veh && isManagementCompany(veh.kind)) redirect(`/manco/${raw}`)
  if (veh) return { vehicle: veh.name as string, vehicleId: raw }

  // A uuid that is not a vehicle in this fund. Treated as a name, exactly as before — the detail
  // view reports "not found" for it, which is the right answer either way.
  return { vehicle: raw, vehicleId: null }
}
