import type { ComponentProps } from 'react'
import type { PageContext } from '@/lib/pages/context'
import { DEFAULT_STATUSES } from '@/lib/deals/statuses'
import type { DealsContent } from './deals-content'

export type DealsPageData = Pick<ComponentProps<typeof DealsContent>, 'initialDeals'>

/** The deals list, server-rendered with the same default status filter the client starts on —
 *  otherwise the first paint shows every deal and then drops half of them once the client refetches. */
export async function loadDealsPage({ admin, page }: PageContext): Promise<DealsPageData> {
  const { data: deals } = await admin
    .from('inbound_deals')
    .select('id, email_id, company_name, company_url, company_domain, founder_name, founder_email, intro_source, referrer_name, thesis_fit_score, stage, industry, raise_amount, status, prior_deal_id, created_at')
    .eq('fund_id', page.fundId)
    .in('status', DEFAULT_STATUSES)
    .order('created_at', { ascending: false })
    .limit(500)
  return { initialDeals: (deals as any) ?? [] }
}
