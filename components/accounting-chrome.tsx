'use client'

import { usePathname } from 'next/navigation'
import { VehicleBar, isFundDetailPath } from '@/components/accounting-vehicle'
import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

/**
 * The chrome around an Accounting page: the vehicle bar, the Analyst toggle, and the Analyst panel.
 *
 * Two shapes, because /funds is genuinely a different page from its subpages.
 *
 * SUBPAGES (journal, capital accounts, statements, …) operate on one vehicle at a time, so a vehicle
 * bar runs across the top and the Analyst toggle rides at its right — top right, as everywhere.
 *
 * /funds — the overview — spans every vehicle, so there is no vehicle bar and nothing to put across
 * the top. It therefore owns its own header and renders exactly like /dashboard: the title all the
 * way up with the toggle inline at its right, and the panel BELOW that header rather than beside it.
 *
 * Why the split is real and not laziness: this component puts `children` in the same flex row as the
 * panel, so the page's <h1> and the panel's top edge are on the same line. The toggle has to clear
 * the panel, so whatever sits above it must occupy real height — which pushes the title down. The
 * only way to get the title to the top is for the header to leave that row, which is what
 * /dashboard does and what `<AccountingPageHeader>` below gives /funds.
 */
export function AccountingChrome({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  // /funds and the fund detail page (/funds/[id]) own their whole layout — title all the way up,
  // Analyst panel below (see AccountingPageHeader + AccountingBody in their pages). No vehicle bar:
  // the overview spans every vehicle, and the detail page is pinned to one by its URL.
  if (pathname === '/funds' || isFundDetailPath(pathname)) return <>{children}</>

  return (
    <>
      {/* The Analyst toggle sits TOP RIGHT — the same place on every page in the app, whatever else
          is on the page. It shares this row with the vehicle bar only because that is what happens
          to be at the top here; it is not anchored to it.

            ml-auto     — hard right independent of its siblings. `justify-between` was the original
                          bug: with one child it aligns to the START.
            items-start — top, however tall the row's other content grows. With items-center, opening
                          "New vehicle" (a 2-row bar) dragged the toggle down to the middle.
            md:pt-8     — matches /dashboard's `md:py-8`, so the toggle lands at the same 32px as
                          everywhere else. At pt-6 it rendered 8px high on every accounting page.
            pb-6        — matches /dashboard's header `mb-6`. The panel opens directly beneath this
                          row, and at pb-4 it crowded the toggle. */}
      <div className="pt-4 md:pt-8 pb-6 flex items-start gap-2">
        <VehicleBar />
        <div className="ml-auto shrink-0"><AnalystToggleButton /></div>
      </div>
      <AccountingBody>{children}</AccountingBody>
    </>
  )
}

/**
 * Page header in the /dashboard shape: title all the way up, actions inline at the right.
 *
 * Must be rendered ABOVE <AccountingBody>, never inside it — that is the whole point.
 */
export function AccountingPageHeader({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 space-y-1">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <AnalystToggleButton />
      </div>
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  )
}

/** Content beside the Analyst panel — the panel shifts the page rather than covering it. */
export function AccountingBody({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col lg:flex-row gap-4 items-start">
      <div className="flex-1 min-w-0 w-full">{children}</div>
      <AnalystPanel />
    </div>
  )
}
