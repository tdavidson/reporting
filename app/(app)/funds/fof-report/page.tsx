import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { FofReportView } from './view'

export const metadata: Metadata = { title: 'Fund-of-funds report' }

export default async function FofReportPage() {
  await requireAccountingAccess()
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <FofReportView />
    </div>
  )
}
