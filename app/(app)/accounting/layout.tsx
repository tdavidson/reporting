import { VehicleProvider, VehicleBar } from '@/components/accounting-vehicle'

// Wraps every Accounting page with the vehicle selector + context so the whole
// section operates on one portfolio_group at a time.
export default function AccountingLayout({ children }: { children: React.ReactNode }) {
  return (
    <VehicleProvider>
      <div className="w-full">
        {/* The vehicle bar and the page title sit close together on purpose — pages
            add only a small top pad below this, so the header reads as one block. */}
        <div className="px-4 md:pl-8 md:pr-4 pt-4 md:pt-6">
          <VehicleBar />
        </div>
        {children}
      </div>
    </VehicleProvider>
  )
}
