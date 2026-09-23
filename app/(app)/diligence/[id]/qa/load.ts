import type { ComponentProps } from 'react'
import type { PageContext } from '@/lib/pages/context'
import type { QAChat } from './qa-chat'

export type DiligenceQaPageData = Pick<ComponentProps<typeof QAChat>, 'dealId' | 'dealName'>

export async function loadDiligenceQaPage({ admin, page }: PageContext, params: { id: string }): Promise<DiligenceQaPageData | null> {
  const { data: deal } = await admin
    .from('diligence_deals')
    .select('id, name')
    .eq('id', params.id)
    .eq('fund_id', page.fundId)
    .maybeSingle()
  if (!deal) return null
  return { dealId: params.id, dealName: (deal as any).name }
}
