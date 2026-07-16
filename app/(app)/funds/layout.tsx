import { VehicleProvider, VehicleBar } from '@/components/accounting-vehicle'
import { AccountingAnalystProvider, AccountingAnalystButton, AccountingAnalystPanel } from '@/components/accounting-analyst'

// Wraps every Accounting page with the vehicle selector + context so the whole
// section operates on one portfolio_group at a time.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <AccountingAnalystProvider>
        <div className="w-full">
          {/* Header row: vehicle bar on the left, the Analyst toggle pinned to the right (ml-auto,
              so it stays right even on pages where the vehicle bar renders nothing, e.g. /funds). */}
          <div className="px-4 md:pl-8 md:pr-4 pt-4 md:pt-6 flex items-center gap-2">
            <VehicleBar />
            <div className="ml-auto shrink-0"><AccountingAnalystButton /></div>
          </div>
          {/* Body: the page content, with the Analyst panel as a flex sibling so it shifts the
              page and sits alongside the content — the same pattern as /dashboard and /import. */}
          <div className="flex flex-col lg:flex-row gap-4 items-start">
            <div className="flex-1 min-w-0 w-full">{children}</div>
            <AccountingAnalystPanel />
          </div>
        </div>
      </AccountingAnalystProvider>
    </VehicleProvider>
  )
}
