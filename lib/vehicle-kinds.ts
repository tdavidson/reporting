/**
 * The `fund_vehicles.kind` vocabulary, in one place.
 *
 * It was in four: the API's validation list, the create modal, the edit modal, and the investments
 * filter bar — each with its own copy of the values and its own copy of the labels. Adding `manco`
 * to three of them and forgetting the fourth is not a hypothetical: whichever one was missed would
 * have kept accepting the kind while refusing to show it, or shown it while refusing to save it.
 *
 * Deliberately dependency-free so a client component can import it. The SERVER-side half — which
 * access domain a kind implies, and the check that enforces it — lives in
 * lib/accounting/vehicle-domain.ts, which imports `next/server` and must not reach the browser
 * bundle. That module re-exports these values so the two can't drift.
 */

export const VEHICLE_KINDS = ['fund', 'spv', 'direct', 'associate', 'manco', 'other'] as const

export type VehicleKind = (typeof VEHICLE_KINDS)[number]

/** The management company kind. Named, because a bare `'manco'` in a comparison reads as a typo. */
export const MANCO_KIND: VehicleKind = 'manco'

/** Singular, for a picker: "what is this one thing?" */
export const VEHICLE_KIND_LABELS: Record<VehicleKind, string> = {
  fund: 'Fund',
  spv: 'SPV',
  direct: 'Direct deal',
  associate: 'GP / associate entity',
  manco: 'Management company',
  other: 'Other',
}

/** Plural, for a filter: "show me all of these." */
export const VEHICLE_KIND_LABELS_PLURAL: Record<VehicleKind, string> = {
  fund: 'Funds',
  spv: 'SPVs',
  direct: 'Direct deals',
  associate: 'GP / associate entities',
  manco: 'Management companies',
  other: 'Other',
}

/** Options for a `<select>`, in the order they should appear. */
export const VEHICLE_KIND_OPTIONS: { value: VehicleKind; label: string }[] =
  VEHICLE_KINDS.map(value => ({ value, label: VEHICLE_KIND_LABELS[value] }))

export function isVehicleKind(v: unknown): v is VehicleKind {
  return typeof v === 'string' && (VEHICLE_KINDS as readonly string[]).includes(v)
}

/**
 * A management company is the firm's own operating entity, not an investment vehicle.
 *
 * Everywhere that enumerates "the fund's vehicles" for an LP-facing or performance purpose has to
 * exclude it: it has no commitments, no NAV, no TVPI and no partners, so it would render as a row
 * of dashes on the fund overview and as a meaningless option in the fund switcher. It lives under
 * its own section instead. See lib/accounting/load.ts.
 */
export function isManagementCompany(kind: string | null | undefined): boolean {
  return kind === 'manco'
}
