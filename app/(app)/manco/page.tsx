import type { Metadata } from 'next'
import { requireMancoAccess } from './guard'
import { MancoListView } from './view'
import { AccountingPageHeader, AccountingBody } from '@/components/accounting-chrome'

export const metadata: Metadata = { title: 'Management company' }

/**
 * The landing page for the Management company section.
 *
 * Deliberately NOT part of /funds. A management company is not an investment vehicle: it has no
 * commitments, no NAV and no partners, so on the fund overview every column is a dash, and in the
 * fund switcher it is an option leading to a page about a portfolio that does not exist. It is a
 * different kind of thing with a different set of questions, so it gets its own section — which is
 * also what lets its books be gated separately (see lib/access/domains.ts).
 *
 * The list is short by nature: most firms have one management entity, some have two or three. So
 * this is a list with the state on it, not a dashboard — the dashboard is one click in, on the
 * entity itself.
 */
export default async function MancoPage() {
  await requireMancoAccess()

  return (
    <div className="pt-4 md:pt-8 pb-8 w-full px-4 md:pl-8 md:pr-4">
      <AccountingPageHeader title="Management company">
        The firm&rsquo;s own operating entities &mdash; cash, the quarterly fee cycle, what it
        spends, and what it is owed by the funds.
      </AccountingPageHeader>

      <AccountingBody>
        <MancoListView />
      </AccountingBody>
    </div>
  )
}
