import type { ComponentProps } from 'react'
import type { PageContext } from '@/lib/pages/context'
import type { DealDetail } from './deal-detail'

export type DealPageData = Pick<ComponentProps<typeof DealDetail>, 'deal' | 'email' | 'priorDeal'>

/** One inbound deal with the email it came from and the earlier submission it follows up, or
 *  null when the id is not one of this fund's deals. */
export async function loadDealPage({ admin, page }: PageContext, params: { id: string }): Promise<DealPageData | null> {
  const { data: deal } = await admin
    .from('inbound_deals')
    .select('*')
    .eq('id', params.id)
    .eq('fund_id', page.fundId)
    .maybeSingle()
  if (!deal) return null

  const { data: email } = await admin
    .from('inbound_emails')
    .select('id, from_address, subject, received_at, raw_payload, routing_label, routing_confidence, routing_reasoning')
    .eq('id', (deal as any).email_id)
    .maybeSingle()

  let priorDeal: DealPageData['priorDeal'] = null
  if ((deal as any).prior_deal_id) {
    const { data } = await admin
      .from('inbound_deals')
      .select('id, company_name, created_at')
      .eq('id', (deal as any).prior_deal_id)
      .maybeSingle()
    priorDeal = data as typeof priorDeal
  }

  return { deal: deal as any, email: email as any, priorDeal }
}
