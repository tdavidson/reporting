import type { SupabaseClient } from '@supabase/supabase-js'
import { listVehicles } from './load'

export class VehicleResolutionError extends Error {
  readonly code = 'INVALID_VEHICLE'
}

/**
 * Resolve a vehicle name against the fund's canonical vehicle list. An explicit name is matched
 * case-insensitively (while returning the stored spelling); an omitted name is only valid for a
 * single-vehicle fund.
 */
export async function resolveVehicle(
  admin: SupabaseClient,
  fundId: string,
  requested?: string,
): Promise<string> {
  const vehicles = await listVehicles(admin, fundId)

  if (requested) {
    const match = vehicles.find(vehicle => vehicle === requested)
      ?? vehicles.find(vehicle => vehicle.trim().toLowerCase() === requested.trim().toLowerCase())
    if (!match) {
      throw new VehicleResolutionError(
        vehicles.length > 0
          ? `Unknown vehicle "${requested}". This fund has: ${vehicles.join(', ')}`
          : `Unknown vehicle "${requested}" — this fund has no vehicles yet.`,
      )
    }
    return match
  }

  if (vehicles.length === 1) return vehicles[0]
  if (vehicles.length === 0) throw new VehicleResolutionError('No vehicles found for this fund')
  throw new VehicleResolutionError(`Specify a vehicle — this fund has several: ${vehicles.join(', ')}`)
}
