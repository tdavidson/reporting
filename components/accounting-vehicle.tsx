'use client'

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { ChevronsUpDown } from 'lucide-react'

/** One selectable vehicle: its name (the portfolio_group the ledger keys on) and its
 *  stable registry id. `id` is null for legacy vehicles that exist only as a name. */
export interface VehicleOption { name: string; id: string | null; kind?: string | null }

interface VehicleCtx {
  /** The selected vehicle's name (portfolio_group). */
  group: string | null
  /** The selected vehicle's registry id (UUID), or null for a legacy name-only vehicle. */
  vehicleId: string | null
  /** The selected vehicle's kind (fund, spv, individual, …), or null until known / for a legacy
   *  vehicle. Read from the vehicle index; the nav hides pages a kind has no use for. */
  kind: string | null
  /** Set both name and id — used by the URL-scoped fund pages and the switcher. */
  setVehicle: (name: string, id: string | null) => void
  /** Set the name only, leaving the id untouched — back-compat for name-only callers. */
  setGroup: (name: string) => void
}
const VehicleContext = createContext<VehicleCtx>({
  group: null, vehicleId: null, kind: null, setVehicle: () => {}, setGroup: () => {},
})

const NAME_KEY = 'acct_vehicle'
const ID_KEY = 'acct_vehicle_id'

// FUND_SUBPAGE_SLUGS lives in a plain module (see ./fund-subpages) so the server-side fund
// detail page can call `.has()` on it — a Set exported from this 'use client' module becomes a
// client-reference proxy on the server. Re-exported here for existing client-side importers.
export { FUND_SUBPAGE_SLUGS } from './fund-subpages'

/**
 * Holds the selected vehicle for the whole app (name + id), persisted to localStorage so
 * it survives navigation and reloads. Lives in AppShell — above the sidebar as well as the
 * page — so the Funds subnav can build fund-first hrefs from the current vehicle's id.
 */
export function VehicleProvider({ children }: { children: React.ReactNode }) {
  const [group, setGroupState] = useState<string | null>(null)
  const [vehicleId, setVehicleIdState] = useState<string | null>(null)
  // The fund's vehicles with their kinds, loaded once; the current kind is looked up from it.
  const [index, setIndex] = useState<VehicleOption[]>([])

  const setVehicle = useCallback((name: string, id: string | null) => {
    setGroupState(name)
    setVehicleIdState(id)
    try {
      localStorage.setItem(NAME_KEY, name)
      if (id) localStorage.setItem(ID_KEY, id)
      else localStorage.removeItem(ID_KEY)
    } catch { /* ignore */ }
  }, [])

  // Back-compat: set the name, leave the id as-is.
  const setGroup = useCallback((name: string) => {
    setGroupState(name)
    try { localStorage.setItem(NAME_KEY, name) } catch { /* ignore */ }
  }, [])

  // Hydrate from localStorage; if nothing is saved, default to the fund's first vehicle so
  // the sidebar always has an id to build Funds links from.
  useEffect(() => {
    let name: string | null = null
    let id: string | null = null
    try {
      name = localStorage.getItem(NAME_KEY)
      id = localStorage.getItem(ID_KEY)
    } catch { /* ignore */ }
    if (name) { setGroupState(name); setVehicleIdState(id) }
    // Always fetched, even when a vehicle is saved: the kind of the saved one comes from here.
    fetch('/api/accounting/vehicle-index')
      .then(r => (r.ok ? r.json() : []))
      .then((vs: VehicleOption[]) => {
        if (!Array.isArray(vs)) return
        setIndex(vs)
        const first = vs[0]
        if (!name && first) setVehicle(first.name, first.id ?? null)
      })
      .catch(() => { /* non-accounting user or no vehicles — leave unset */ })
  }, [setVehicle])

  const kind = index.find(v => (vehicleId && v.id === vehicleId) || (!vehicleId && v.name === group))?.kind ?? null

  return (
    <VehicleContext.Provider value={{ group, vehicleId, kind, setVehicle, setGroup }}>
      {children}
    </VehicleContext.Provider>
  )
}

export function useVehicle() {
  return useContext(VehicleContext)
}

/**
 * The current fund's URL segment for building fund-first links — its registry id, or its
 * URL-encoded name for a legacy vehicle (the `/funds/[id]` route resolves either). Null
 * when no vehicle is selected yet.
 */
export function useFundSeg(): string | null {
  const { vehicleId, group } = useVehicle()
  return vehicleId ?? (group ? encodeURIComponent(group) : null)
}

/**
 * The base path of the current entity's ledger pages, so a shared view can link to a sibling page
 * (the register, the journal) and land on the entity it is already showing.
 *
 * It used to branch: `/manco/<id>` for a management company, `/funds/<seg>` for everything else,
 * because the manco had a parallel set of pages. There is one set now — a management company is
 * an entity in the Entities section like any other — so there is one shape of URL.
 */
export function useVehicleBase(): string | null {
  const seg = useFundSeg()
  return seg ? `/funds/${seg}` : null
}

/**
 * A fetch wrapper that scopes every ledger request to the selected vehicle:
 * appends `?group=` to the URL and injects `group` into JSON POST bodies.
 */
export function useLedgerFetch() {
  const { group } = useVehicle()
  return useCallback(
    (path: string, opts?: RequestInit) => {
      let url = path
      if (group) url += (path.includes('?') ? '&' : '?') + 'group=' + encodeURIComponent(group)
      let init = opts
      if (opts?.body && typeof opts.body === 'string' && group) {
        try {
          const b = JSON.parse(opts.body)
          if (b && typeof b === 'object' && b.group === undefined) init = { ...opts, body: JSON.stringify({ ...b, group }) }
        } catch { /* leave non-JSON bodies alone */ }
      }
      return fetch(url, init)
    },
    [group]
  )
}

/**
 * The fund switcher — a compact select that JUMPS to the same page of another fund by
 * swapping the `[id]` segment of the current path. Styled to sit beside the Analyst button.
 * Hidden when there's nothing to switch to (one vehicle or none).
 */
export function FundSwitcher() {
  const pathname = usePathname()
  const router = useRouter()
  const { group, setVehicle } = useVehicle()
  const [vehicles, setVehicles] = useState<VehicleOption[]>([])

  useEffect(() => {
    fetch('/api/accounting/vehicle-index')
      .then(r => (r.ok ? r.json() : []))
      .then(v => setVehicles(Array.isArray(v) ? v : []))
      .catch(() => setVehicles([]))
  }, [])

  if (vehicles.length <= 1) return null

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const opt = vehicles.find(v => v.name === e.target.value)
    if (!opt) return
    setVehicle(opt.name, opt.id ?? null)
    const target = opt.id ?? encodeURIComponent(opt.name)
    // Keep only the section (first subpage segment) — a deeper param like an LP id belongs
    // to the fund we're leaving, so jumping funds lands on that section's root.
    const section = pathname.split('/').filter(Boolean)[2]
    router.push(`/funds/${target}${section ? '/' + section : ''}`)
  }

  return (
    <div className="relative inline-flex">
      <select
        value={group ?? ''}
        onChange={onChange}
        aria-label="Jump to fund"
        className="h-8 appearance-none rounded-md border bg-transparent pl-3 pr-8 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors max-w-[16rem] truncate"
      >
        {vehicles.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}
      </select>
      <ChevronsUpDown className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
    </div>
  )
}
