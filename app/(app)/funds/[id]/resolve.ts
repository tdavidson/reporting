import { createAdminClient } from '@/lib/supabase/admin'
import { vehicleNameById } from '@/lib/accounting/vehicle-id'

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
  const name = await vehicleNameById(createAdminClient(), fundId, raw)
  if (name) return { vehicle: name, vehicleId: raw }
  return { vehicle: raw, vehicleId: null }
}
