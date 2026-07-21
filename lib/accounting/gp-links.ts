// GP-of-vehicle links: which GP/associate entity is the GP of which vehicle (many-to-many).
//
// Backed by `vehicle_gp_links`. Falls back to the legacy `fund_vehicles.serves_vehicle_id` /
// `lp_entity_id` columns only when the table doesn't exist yet (migration unapplied) — once the
// table is present it is authoritative, so a deliberately-empty set means "no GP links", not
// "look at the old columns".

import type { SupabaseClient } from '@supabase/supabase-js'

export interface GpLink {
  /** The GP/associate entity (its own fund_vehicle). */
  gpVehicleId: string
  /** The vehicle it is the GP of. */
  servedVehicleId: string
  /** As which partner the GP appears in the served vehicle. */
  lpEntityId: string | null
}

/** All GP links for a fund. */
export async function loadVehicleGpLinks(admin: SupabaseClient, fundId: string): Promise<GpLink[]> {
  const { data, error } = await admin
    .from('vehicle_gp_links' as any)
    .select('gp_vehicle_id, served_vehicle_id, lp_entity_id')
    .eq('fund_id', fundId)

  if (!error) {
    return ((data as any[]) ?? []).map(r => ({
      gpVehicleId: r.gp_vehicle_id,
      servedVehicleId: r.served_vehicle_id,
      lpEntityId: r.lp_entity_id ?? null,
    }))
  }

  // Table absent (unapplied migration) → legacy single columns on fund_vehicles.
  const { data: veh } = await admin
    .from('fund_vehicles' as any)
    .select('id, serves_vehicle_id, lp_entity_id')
    .eq('fund_id', fundId)
  return ((veh as any[]) ?? [])
    .filter(v => v.serves_vehicle_id)
    .map(v => ({ gpVehicleId: v.id, servedVehicleId: v.serves_vehicle_id, lpEntityId: v.lp_entity_id ?? null }))
}

/** The GP entities of one served vehicle. */
export function gpsOfVehicle(links: GpLink[], servedVehicleId: string): GpLink[] {
  return links.filter(l => l.servedVehicleId === servedVehicleId)
}

/** The vehicles a GP/associate entity serves. */
export function vehiclesServedBy(links: GpLink[], gpVehicleId: string): GpLink[] {
  return links.filter(l => l.gpVehicleId === gpVehicleId)
}
