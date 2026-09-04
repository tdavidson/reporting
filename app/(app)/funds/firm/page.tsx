import type { Metadata } from 'next'
import { requireAccountingAccess } from '../guard'
import { FirmView } from './view'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'

export const metadata: Metadata = { title: 'Firm' }

/**
 * The firm overview: every entity's books on one page — closed through, drafts waiting, bank rows
 * open, trial balance tied. The /funds overview answers "how are the funds doing"; this answers
 * "are the books done", across funds, SPVs, GP entities, individuals and the management company.
 */
export default async function FirmPage() {
  await requireAccountingAccess()
  return (
    <div className="pt-4 md:pt-8 pb-8 w-full">
      <AccountingPageHeader title="Firm">
        The state of every entity&rsquo;s books, in one place.
      </AccountingPageHeader>
      <AccountingBody>
        <FirmView />
      </AccountingBody>
    </div>
  )
}
