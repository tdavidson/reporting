/**
 * Vehicle filter for the portfolio dashboard. A company's vehicle membership is its
 * `portfolio_group` text[] (see lib/vehicles.ts) — a company can sit in several vehicles,
 * so the filter is "belongs to", not "equals".
 */

/** Sentinel select value for companies with no vehicle. Not a valid vehicle name. */
export const UNASSIGNED_VEHICLE = '__unassigned__'

export interface VehicleScoped { portfolioGroup: string[] | null }

/** `''` = no filter. */
export function matchesVehicle(c: VehicleScoped, vehicle: string): boolean {
  if (!vehicle) return true
  const groups = c.portfolioGroup ?? []
  if (vehicle === UNASSIGNED_VEHICLE) return groups.length === 0
  return groups.includes(vehicle)
}

export function vehicleFilterOptions(
  allGroups: string[],
  companies: VehicleScoped[],
): { value: string; label: string }[] {
  const opts = allGroups.map(g => ({ value: g, label: g }))
  if (companies.some(c => (c.portfolioGroup ?? []).length === 0)) {
    opts.push({ value: UNASSIGNED_VEHICLE, label: 'Unassigned' })
  }
  return opts
}
