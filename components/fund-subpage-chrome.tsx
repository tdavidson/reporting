'use client'

import { useEffect } from 'react'
import { useVehicle, FundSwitcher } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AccountingBody } from '@/components/accounting-chrome'

/**
 * Pins the section's vehicle context to the URL and renders nothing. The fund pages route
 * on the vehicle id, but the views read the vehicle from context (and the Analyst scopes to
 * it), so every fund page syncs the URL's vehicle into the context on mount.
 */
export function FundScopeSync({ vehicle, vehicleId }: { vehicle: string; vehicleId: string | null }) {
  const { setVehicle } = useVehicle()
  useEffect(() => { setVehicle(vehicle, vehicleId) }, [vehicle, vehicleId, setVehicle])
  return null
}

/**
 * The shared chrome for a fund subpage (/funds/[id]/journal, …). It:
 *  - pins the section's vehicle context to the URL (so the views, which read the vehicle
 *    from context, and the Analyst scope to the fund the URL names),
 *  - renders the full-width header — title/description on the left, the fund switcher and
 *    Analyst toggle in a lowered group on the right (matching the fund detail page),
 *  - wraps the page body in <AccountingBody>, so the Analyst panel slides in UNDERNEATH the
 *    header rather than squeezing it.
 */
export function FundSubpageChrome({
  title, description, vehicle, vehicleId, children,
}: {
  title: string
  description?: string
  vehicle: string
  vehicleId: string | null
  children: React.ReactNode
}) {
  return (
    <>
      <FundScopeSync vehicle={vehicle} vehicleId={vehicleId} />
      <div className="flex flex-wrap items-end justify-between gap-3 mb-6">
        <div className="space-y-1 min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <div className="flex items-center gap-2">
          <FundSwitcher />
          <AnalystToggleButton />
        </div>
      </div>
      <AccountingBody>{children}</AccountingBody>
    </>
  )
}
