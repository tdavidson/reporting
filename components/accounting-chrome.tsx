'use client'

import { AnalystToggleButton } from '@/components/analyst-button'
import { AnalystPanel } from '@/components/analyst-panel'

/**
 * Page header in the /dashboard shape: title all the way up, actions inline at the right.
 * Used by the /funds overview (which spans every vehicle, so it has no fund switcher).
 *
 * Must be rendered ABOVE <AccountingBody>, never inside it: the body shares its row with
 * the Analyst panel, so a header inside it would be squeezed left when the panel opens.
 */
export function AccountingPageHeader({ title, children }: { title: string; children: React.ReactNode }) {
  // items-end lowers the Analyst toggle to sit near the subtitle row, matching the fund
  // detail/subpage headers, rather than aligning it to the title.
  return (
    <div className="flex items-end justify-between gap-3 mb-6">
      <div className="space-y-1 min-w-0 flex-1">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">{children}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <AnalystToggleButton />
      </div>
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
